-- Propuesta incremental: revisar y ejecutar primero en staging.
-- Cierra una cuenta sin saldo servido, cancela atomicamente lo no entregado,
-- conserva las notas anteriores y libera la mesa.

alter table public.table_sessions
  add column if not exists close_idempotency_key uuid unique,
  add column if not exists close_fingerprint text;

create or replace function public.close_session_and_cancel_unserved_orders(
  p_table_session_id uuid,
  p_cancellations jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_table_id uuid;
  v_session_status public.session_status;
  v_existing_key uuid;
  v_existing_fingerprint text;
  v_fingerprint text;
  v_due numeric(12,2);
  v_paid numeric(12,2);
  v_expected_count integer;
  v_cancelled_ids uuid[] := array[]::uuid[];
  v_cancellation record;
  v_order_status public.order_status;
  v_disposition text;
  v_move record;
  v_note text;
begin
  if not public.has_any_role(array['admin','cashier','waiter']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_table_session_id is null or p_idempotency_key is null
     or p_cancellations is null or jsonb_typeof(p_cancellations) <> 'array'
     or jsonb_array_length(p_cancellations) < 1 or jsonb_array_length(p_cancellations) > 200 then
    raise exception 'INVALID_SESSION_CANCELLATIONS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_cancellations) value
    where jsonb_typeof(value) <> 'object'
       or not (value ? 'order_id')
       or not (value ? 'prepared_disposition')
       or (value ->> 'order_id') is null
       or (value ->> 'order_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'INVALID_SESSION_CANCELLATIONS' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_cancellations)) <>
     (select count(distinct value ->> 'order_id') from jsonb_array_elements(p_cancellations)) then
    raise exception 'INVALID_SESSION_CANCELLATIONS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_cancellations) value
    where value ->> 'prepared_disposition' not in ('waste', 'reusable')
      and value -> 'prepared_disposition' <> 'null'::jsonb
  ) then
    raise exception 'INVALID_CANCEL_DISPOSITION' using errcode = '22023';
  end if;

  v_fingerprint := (
    select jsonb_agg(jsonb_build_object(
      'order_id', (value ->> 'order_id')::uuid,
      'prepared_disposition', value ->> 'prepared_disposition'
    ) order by (value ->> 'order_id')::uuid)::text
    from jsonb_array_elements(p_cancellations)
  );
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  select table_id, status, close_idempotency_key, close_fingerprint
    into v_table_id, v_session_status, v_existing_key, v_existing_fingerprint
    from public.table_sessions
    where id = p_table_session_id
    for update;
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_session_status = 'closed' then
    if v_existing_key = p_idempotency_key then
      if v_existing_fingerprint <> v_fingerprint then
        raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
      end if;
      select coalesce(array_agg((value ->> 'order_id')::uuid order by (value ->> 'order_id')::uuid), array[]::uuid[])
        into v_cancelled_ids
        from jsonb_array_elements(p_cancellations);
      return jsonb_build_object(
        'table_session_id', p_table_session_id, 'status', 'closed',
        'cancelled_order_ids', to_jsonb(v_cancelled_ids), 'idempotent_replay', true
      );
    end if;
    raise exception 'SESSION_NOT_OPEN' using errcode = 'P0001';
  end if;
  if v_session_status <> 'open' then raise exception 'SESSION_NOT_OPEN' using errcode = 'P0001'; end if;

  if exists (
    select 1 from public.table_sessions
    where close_idempotency_key = p_idempotency_key and id <> p_table_session_id
  ) then
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
  end if;

  perform 1 from public.cafe_tables where id = v_table_id for update;
  perform 1 from public.orders
    where table_session_id = p_table_session_id
    order by id for update;

  select coalesce(sum(oi.subtotal), 0) into v_due
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.table_session_id = p_table_session_id and o.status = 'served';
  select coalesce(sum(pa.amount), 0) into v_paid
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.payment_allocations pa on pa.order_item_id = oi.id
    where o.table_session_id = p_table_session_id and o.status = 'served';
  if v_paid <> v_due then
    raise exception 'SESSION_HAS_UNPAID_SERVED_ORDERS' using errcode = 'P0001';
  end if;

  select count(*) into v_expected_count
    from public.orders
    where table_session_id = p_table_session_id
      and status in ('pending', 'confirmed', 'preparing', 'ready');
  if v_expected_count <> jsonb_array_length(p_cancellations) or v_expected_count = 0 then
    raise exception 'INVALID_SESSION_CANCELLATIONS' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_cancellations) value
      left join public.orders o on o.id = (value ->> 'order_id')::uuid
        and o.table_session_id = p_table_session_id
        and o.status in ('pending', 'confirmed', 'preparing', 'ready')
      where o.id is null
  ) then
    raise exception 'INVALID_SESSION_CANCELLATIONS' using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_cancellations) value
      join public.orders o on o.id = (value ->> 'order_id')::uuid
        and o.table_session_id = p_table_session_id
      where (o.status in ('pending', 'confirmed')
             and value -> 'prepared_disposition' <> 'null'::jsonb)
         or (o.status in ('preparing', 'ready')
             and value ->> 'prepared_disposition' not in ('waste', 'reusable'))
  ) then
    raise exception 'INVALID_CANCEL_DISPOSITION' using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_cancellations) value
      join public.order_items oi on oi.order_id = (value ->> 'order_id')::uuid
      join public.payment_allocations pa on pa.order_item_id = oi.id
  ) then
    raise exception 'ORDER_HAS_PAYMENT' using errcode = 'P0001';
  end if;

  -- Pending/confirmed orders can return their recorded consumption. Preparing
  -- or ready orders remain consumed; disposition is recorded in the order note.
  perform 1 from public.products p
    where p.id in (
      select distinct im.product_id from public.inventory_movements im
      join public.orders o on o.id = im.order_id
      where o.table_session_id = p_table_session_id and o.status = 'confirmed'
        and im.type = 'order_consumption' and im.product_id is not null
    )
    order by p.id for update;
  perform 1 from public.ingredients i
    where i.id in (
      select distinct im.ingredient_id from public.inventory_movements im
      join public.orders o on o.id = im.order_id
      where o.table_session_id = p_table_session_id and o.status = 'confirmed'
        and im.type = 'order_consumption' and im.ingredient_id is not null
    )
    order by i.id for update;

  for v_cancellation in
    select (value ->> 'order_id')::uuid as order_id,
           value ->> 'prepared_disposition' as prepared_disposition
    from jsonb_array_elements(p_cancellations)
    order by (value ->> 'order_id')::uuid
  loop
    select status into v_order_status
      from public.orders
      where id = v_cancellation.order_id and table_session_id = p_table_session_id
      for update;
    v_disposition := v_cancellation.prepared_disposition;

    if v_order_status = 'confirmed' then
      for v_move in
        select * from public.inventory_movements
        where order_id = v_cancellation.order_id and type = 'order_consumption'
        order by id
      loop
        if v_move.ingredient_id is not null then
          update public.ingredients set stock = stock - v_move.quantity_delta, updated_at = now()
            where id = v_move.ingredient_id;
          insert into public.inventory_movements(
            ingredient_id, order_id, order_item_id, type, quantity_delta, reason, created_by
          ) values (
            v_move.ingredient_id, v_cancellation.order_id, v_move.order_item_id, 'order_reversal',
            -v_move.quantity_delta, 'Cancelación al cerrar cuenta', auth.uid()
          );
        else
          update public.products set stock = stock - v_move.quantity_delta, updated_at = now()
            where id = v_move.product_id;
          insert into public.inventory_movements(
            product_id, order_id, order_item_id, type, quantity_delta, reason, created_by
          ) values (
            v_move.product_id, v_cancellation.order_id, v_move.order_item_id, 'order_reversal',
            -v_move.quantity_delta, 'Cancelación al cerrar cuenta', auth.uid()
          );
        end if;
      end loop;
    end if;

    v_note := 'Cuenta cerrada; orden no entregada cancelada.';
    if v_order_status in ('preparing', 'ready') then
      v_note := v_note || case v_disposition
        when 'waste' then ' Destino de preparación: merma.'
        when 'reusable' then ' Destino de preparación: reutilizable/reasignable.'
      end;
    end if;
    update public.orders
      set status = 'cancelled',
          notes = concat_ws(E'\n', nullif(btrim(notes), ''), v_note),
          updated_at = now()
      where id = v_cancellation.order_id;
    v_cancelled_ids := array_append(v_cancelled_ids, v_cancellation.order_id);
  end loop;

  update public.table_sessions
    set status = 'closed', closed_at = now(),
        close_idempotency_key = p_idempotency_key,
        close_fingerprint = v_fingerprint
    where id = p_table_session_id;
  update public.cafe_tables set status = 'available', updated_at = now()
    where id = v_table_id;

  return jsonb_build_object(
    'table_session_id', p_table_session_id, 'status', 'closed',
    'cancelled_order_ids', to_jsonb(v_cancelled_ids), 'idempotent_replay', false
  );
end;
$$;

revoke all on function public.close_session_and_cancel_unserved_orders(uuid, jsonb, uuid) from public, anon;
grant execute on function public.close_session_and_cancel_unserved_orders(uuid, jsonb, uuid) to authenticated;

comment on function public.close_session_and_cancel_unserved_orders(uuid, jsonb, uuid) is
  'Cancela de forma transaccional las órdenes no entregadas y cierra/libera una sesión solo con saldo servido en cero; requiere idempotencia.';
