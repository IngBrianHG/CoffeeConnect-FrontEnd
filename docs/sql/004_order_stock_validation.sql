-- Migración incremental para contrato 07.
-- Revisar y aplicar primero en staging; no ejecutar desde el frontend.
-- Añade pre-chequeo de stock para POS/kiosco en servidor y compara la carga
-- normalizada cuando se reutiliza una clave idempotente de orden.
--
-- La disponibilidad no reserva inventario. confirm_order continúa siendo la
-- autoridad transaccional final y descuenta stock una sola vez.

create or replace function public.get_orderable_products_availability(p_product_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_product_id uuid;
  v_product_stock numeric;
  v_product_active boolean;
  v_category_active boolean;
  v_uses_recipe boolean;
  v_inactive_ingredient boolean;
  v_available integer;
  v_orderable boolean;
  v_items jsonb := '[]'::jsonb;
begin
  if not public.has_any_role(array['admin','cashier','waiter']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_product_ids is null or cardinality(p_product_ids) < 1
     or cardinality(p_product_ids) > 100
     or array_position(p_product_ids, null) is not null
     or cardinality(p_product_ids) <> (
       select count(distinct requested.product_id)
       from unnest(p_product_ids) as requested(product_id)
     ) then
    raise exception 'INVALID_PRODUCT_SELECTION' using errcode = '22023';
  end if;

  foreach v_product_id in array p_product_ids loop
    select p.stock, p.active, coalesce(c.active, false),
           exists (
             select 1 from public.product_ingredients pi
             where pi.product_id = p.id
           ),
           exists (
             select 1
             from public.product_ingredients pi
             join public.ingredients i on i.id = pi.ingredient_id
             where pi.product_id = p.id and not i.active
           )
      into v_product_stock, v_product_active, v_category_active,
           v_uses_recipe, v_inactive_ingredient
      from public.products p
      left join public.categories c on c.id = p.category_id
      where p.id = v_product_id;

    if not found then
      v_orderable := false;
      v_uses_recipe := false;
      v_available := 0;
    else
      v_orderable := v_product_active and v_category_active and not v_inactive_ingredient;
      if not v_orderable then
        v_available := 0;
      elsif v_uses_recipe then
        select least(99, greatest(0, floor(coalesce(min(i.stock / pi.quantity_per_portion), 0))))::integer
          into v_available
          from public.product_ingredients pi
          join public.ingredients i on i.id = pi.ingredient_id
          where pi.product_id = v_product_id;
      else
        v_available := least(99, greatest(0, floor(v_product_stock)))::integer;
      end if;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'available_quantity', coalesce(v_available, 0),
      'orderable', coalesce(v_orderable, false),
      'uses_recipe', coalesce(v_uses_recipe, false)
    ));
  end loop;

  return jsonb_build_object('items', v_items);
end;
$$;

create or replace function public.create_public_order(
  p_table_id uuid,
  p_items jsonb,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session_id uuid;
  v_order_id uuid;
  v_existing_table uuid;
  v_existing_items jsonb;
  v_normalized_items jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_notes text;
  v_product public.products%rowtype;
  v_order_item_id uuid;
  v_line_total numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_table_status public.table_status;
  v_shortage record;
begin
  if p_idempotency_key is null or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'INVALID_ORDER' using errcode = '22023';
  end if;

  -- Normalizar el contenido antes de consultar idempotencia. Notas con más de
  -- 200 caracteres se recortan igual que al persistir las líneas.
  if exists (
    select 1
    from jsonb_array_elements(p_items) as input(value)
    where jsonb_typeof(input.value) <> 'object'
       or not (input.value ? 'product_id')
       or not (input.value ? 'quantity')
       or jsonb_typeof(input.value -> 'product_id') <> 'string'
       or jsonb_typeof(input.value -> 'quantity') <> 'number'
       or (input.value ->> 'quantity') !~ '^[0-9]+$'
       or ((input.value ? 'notes') and jsonb_typeof(input.value -> 'notes') not in ('string', 'null'))
  ) then
    raise exception 'INVALID_ORDER' using errcode = '22023';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'product_id', normalized.product_id::text,
      'quantity', normalized.quantity,
      'notes', normalized.notes
    )
    order by normalized.product_id, normalized.quantity, coalesce(normalized.notes, '')
  )
    into v_normalized_items
    from (
      select (input.value ->> 'product_id')::uuid as product_id,
             (input.value ->> 'quantity')::integer as quantity,
             nullif(left(btrim(coalesce(input.value ->> 'notes', '')), 200), '') as notes
      from jsonb_array_elements(p_items) as input(value)
    ) as normalized;

  if exists (
    select 1 from jsonb_array_elements(v_normalized_items) as line(value)
    where (line.value ->> 'quantity')::integer < 1
       or (line.value ->> 'quantity')::integer > 99
  ) then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select id, table_id into v_order_id, v_existing_table
    from public.orders
    where idempotency_key = p_idempotency_key;
  if found then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'product_id', existing.product_id::text,
        'quantity', existing.quantity,
        'notes', existing.notes
      )
      order by existing.product_id, existing.quantity, coalesce(existing.notes, '')
    ), '[]'::jsonb)
      into v_existing_items
      from public.order_items existing
      where existing.order_id = v_order_id;

    if v_existing_table is distinct from p_table_id
       or v_existing_items is distinct from v_normalized_items then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return v_order_id;
  end if;

  select id into v_session_id
    from public.table_sessions
    where table_id = p_table_id and status = 'open'
    for update;
  if not found then raise exception 'NO_OPEN_TABLE_SESSION' using errcode = 'P0001'; end if;

  -- Cerrar sesión bloquea primero la sesión y luego la mesa; conservar el mismo
  -- orden evita deadlocks y protege la validación active/status hasta el commit.
  select status into v_table_status
    from public.cafe_tables
    where id = p_table_id and active
    for share;
  if not found then raise exception 'TABLE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_table_status = 'unavailable' then
    raise exception 'TABLE_UNAVAILABLE' using errcode = 'P0001';
  end if;

  -- Bloquear en orden determinista para que los valores consultados no cambien
  -- durante el pre-chequeo. No se descuenta ni reserva stock en esta RPC.
  perform p.id
    from public.products p
    where p.id in (
      select distinct (line.value ->> 'product_id')::uuid
      from jsonb_array_elements(v_normalized_items) as line(value)
    )
    order by p.id
    for share of p;

  perform i.id
    from public.ingredients i
    where i.id in (
      select distinct pi.ingredient_id
      from public.product_ingredients pi
      where pi.product_id in (
        select distinct (line.value ->> 'product_id')::uuid
        from jsonb_array_elements(v_normalized_items) as line(value)
      )
    )
    order by i.id
    for share of i;

  perform c.id
    from public.categories c
    where c.id in (
      select distinct p.category_id
      from public.products p
      where p.id in (
        select distinct (line.value ->> 'product_id')::uuid
        from jsonb_array_elements(v_normalized_items) as line(value)
      )
    )
    order by c.id
    for share of c;

  for v_product_id in
    select distinct (line.value ->> 'product_id')::uuid
    from jsonb_array_elements(v_normalized_items) as line(value)
    order by 1
  loop
    select p.* into v_product
      from public.products p
      where p.id = v_product_id and p.active
        and exists (
          select 1 from public.categories c
          where c.id = p.category_id and c.active
        );
    if not found then raise exception 'PRODUCT_UNAVAILABLE' using errcode = 'P0001'; end if;
    if exists (
      select 1
      from public.product_ingredients pi
      join public.ingredients i on i.id = pi.ingredient_id
      where pi.product_id = v_product.id and not i.active
    ) then
      raise exception 'PRODUCT_RECIPE_HAS_INACTIVE_INGREDIENT' using errcode = 'P0001';
    end if;
  end loop;

  select p.name, p.stock, requested.quantity
    into v_shortage
    from public.products p
    join (
      select (line.value ->> 'product_id')::uuid as product_id,
             sum((line.value ->> 'quantity')::integer)::numeric as quantity
      from jsonb_array_elements(v_normalized_items) as line(value)
      group by (line.value ->> 'product_id')::uuid
    ) requested on requested.product_id = p.id
    where not exists (
      select 1 from public.product_ingredients pi where pi.product_id = p.id
    )
      and p.stock < requested.quantity
    order by p.id
    limit 1;
  if found then
    raise exception 'INSUFFICIENT_PRODUCT_STOCK' using errcode = 'P0001';
  end if;

  with requested as (
    select (line.value ->> 'product_id')::uuid as product_id,
           sum((line.value ->> 'quantity')::integer)::numeric as quantity
    from jsonb_array_elements(v_normalized_items) as line(value)
    group by (line.value ->> 'product_id')::uuid
  ), required as (
    select pi.ingredient_id,
           sum(pi.quantity_per_portion * requested.quantity) as quantity
    from requested
    join public.product_ingredients pi on pi.product_id = requested.product_id
    group by pi.ingredient_id
  )
  select i.name, i.stock, required.quantity
    into v_shortage
    from required
    join public.ingredients i on i.id = required.ingredient_id
    where i.stock < required.quantity
    order by i.id
    limit 1;
  if found then
    raise exception 'INSUFFICIENT_INGREDIENT_STOCK' using errcode = 'P0001';
  end if;

  insert into public.orders(table_session_id, table_id, created_by, idempotency_key)
    values (v_session_id, p_table_id, auth.uid(), p_idempotency_key)
    returning id into v_order_id;

  for v_item in
    select value from jsonb_array_elements(v_normalized_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    v_notes := v_item ->> 'notes';
    select p.* into v_product from public.products p where p.id = v_product_id;
    v_line_total := round(v_product.price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;

    insert into public.order_items(
      order_id, product_id, product_name_snapshot, quantity, unit_price,
      discount_amount, subtotal, notes, uses_recipe
    )
    values (
      v_order_id, v_product.id, v_product.name, v_quantity, v_product.price,
      0, v_line_total, v_notes,
      exists (select 1 from public.product_ingredients where product_id = v_product.id)
    )
    returning id into v_order_item_id;

    insert into public.order_item_recipe_lines(
      order_item_id, ingredient_id, ingredient_name_snapshot, unit, quantity_per_portion
    )
    select v_order_item_id, i.id, i.name, i.unit, pi.quantity_per_portion
      from public.product_ingredients pi
      join public.ingredients i on i.id = pi.ingredient_id
      where pi.product_id = v_product.id;
  end loop;

  update public.orders
    set subtotal = v_subtotal, total = v_subtotal, updated_at = now()
    where id = v_order_id;
  return v_order_id;
end;
$$;

revoke all on function public.get_orderable_products_availability(uuid[]) from public, anon;
grant execute on function public.get_orderable_products_availability(uuid[]) to authenticated;

revoke all on function public.create_public_order(uuid, jsonb, uuid) from public;
grant execute on function public.create_public_order(uuid, jsonb, uuid) to anon, authenticated;

comment on function public.get_orderable_products_availability(uuid[]) is
  'Devuelve disponibilidad vendible por producto al personal activo. Es informativa y no reserva stock.';
comment on function public.create_public_order(uuid, jsonb, uuid) is
  'Crea una orden con snapshots autoritativos, comparación de payload idempotente y pre-chequeo de stock; confirm_order vuelve a validar y descuenta.';
