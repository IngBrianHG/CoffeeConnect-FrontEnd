-- Coffee Connect — esquema inicial para Supabase/PostgreSQL
-- Ejecutar una sola vez en Supabase SQL Editor o mediante Supabase CLI.
-- Es un esquema nuevo: NO es una migración directa del MySQL actual.
-- El frontend usa la clave anon/publishable con RLS. Nunca usar service_role en el navegador.

-- Catálogos cerrados: cambiar estos valores requiere una migración versionada.
do $$ begin create type public.app_role as enum ('admin', 'cashier', 'waiter');
exception when duplicate_object then null; end $$;
do $$ begin create type public.table_status as enum ('available', 'assigned', 'occupied', 'unavailable');
exception when duplicate_object then null; end $$;
do $$ begin create type public.session_status as enum ('open', 'closed', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin create type public.order_status as enum ('pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_status as enum ('unpaid', 'partial', 'paid');
exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_method as enum ('cash', 'card', 'transfer', 'other');
exception when duplicate_object then null; end $$;
do $$ begin create type public.inventory_unit as enum ('g', 'ml', 'unit');
exception when duplicate_object then null; end $$;
do $$ begin create type public.inventory_adjustment_type as enum (
  'opening_balance', 'purchase', 'expiration', 'spill', 'damage',
  'count_correction', 'return_to_stock', 'manual_adjustment',
  'order_consumption', 'order_reversal'
);
exception when duplicate_object then null; end $$;
do $$ begin create type public.promotion_type as enum ('nxm', 'percent');
exception when duplicate_object then null; end $$;
do $$ begin create type public.promotion_scope as enum ('product', 'category', 'all_menu');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role public.app_role not null default 'waiter',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(btrim(name)) > 0)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  description text,
  price numeric(12,2) not null check (
    price > 0 and price::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  -- Solo se utiliza para artículos terminados que NO tengan receta.
  stock numeric(14,3) not null default 0 check (
    stock >= 0 and stock::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_not_blank check (length(btrim(name)) > 0),
  constraint products_name_category_unique unique (name, category_id)
);

create table if not exists public.cafe_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status public.table_status not null default 'available',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cafe_tables_name_not_blank check (length(btrim(name)) > 0)
);

-- Una sesión representa una visita/ocupación de mesa. Los pedidos y pagos se agrupan aquí.
create table if not exists public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.cafe_tables(id) on delete restrict,
  idempotency_key uuid not null unique,
  status public.session_status not null default 'open',
  opened_by uuid references public.profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint table_sessions_close_time check (
    (status = 'open' and closed_at is null) or (status <> 'open' and closed_at is not null)
  )
);
create unique index if not exists table_sessions_one_open_per_table
  on public.table_sessions(table_id) where status = 'open';

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit public.inventory_unit not null,
  stock numeric(14,3) not null default 0 check (
    stock >= 0 and stock::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  min_stock numeric(14,3) not null default 0 check (
    min_stock >= 0 and min_stock::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingredients_name_not_blank check (length(btrim(name)) > 0)
);

-- Una fila por ingrediente usado por porción. La cantidad usa la unidad base del ingrediente.
create table if not exists public.product_ingredients (
  product_id uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity_per_portion numeric(14,3) not null check (
    quantity_per_portion > 0 and quantity_per_portion::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  primary key (product_id, ingredient_id)
);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  type public.promotion_type not null,
  scope public.promotion_scope not null,
  buy_quantity integer,
  pay_quantity integer,
  percent numeric(5,2) check (
    percent is null or percent::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  product_id uuid references public.products(id) on delete restrict,
  category_id uuid references public.categories(id) on delete restrict,
  starts_on date,
  ends_on date,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_scope_target check (
    (scope = 'product' and product_id is not null and category_id is null) or
    (scope = 'category' and category_id is not null and product_id is null) or
    (scope = 'all_menu' and product_id is null and category_id is null)
  ),
  constraint promotions_dates check (starts_on is null or ends_on is null or starts_on <= ends_on),
  constraint promotions_rule check (
    (type = 'nxm' and buy_quantity is not null and pay_quantity is not null
      and buy_quantity >= 2 and pay_quantity >= 1
      and pay_quantity < buy_quantity and percent is null) or
    (type = 'percent' and percent is not null and percent > 0 and percent <= 100
      and percent::text not in ('NaN', 'Infinity', '-Infinity')
      and buy_quantity is null and pay_quantity is null)
  )
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  table_session_id uuid not null references public.table_sessions(id) on delete restrict,
  table_id uuid not null references public.cafe_tables(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  idempotency_key uuid not null unique,
  status public.order_status not null default 'pending',
  payment_status public.payment_status not null default 'unpaid',
  subtotal numeric(12,2) not null default 0 check (
    subtotal >= 0 and subtotal::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  discount_total numeric(12,2) not null default 0 check (
    discount_total >= 0 and discount_total::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  total numeric(12,2) not null default 0 check (
    total >= 0 and total::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  notes text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint orders_amounts_match check (total = subtotal - discount_total),
  constraint orders_discount_not_over_subtotal check (discount_total <= subtotal)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price numeric(12,2) not null check (
    unit_price > 0 and unit_price::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  discount_amount numeric(12,2) not null default 0 check (
    discount_amount >= 0 and discount_amount::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  subtotal numeric(12,2) not null check (
    subtotal >= 0 and subtotal::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  promotion_name text,
  notes varchar(200),
  uses_recipe boolean not null default false,
  created_at timestamptz not null default now(),
  constraint order_items_amounts_match check (
    subtotal = (unit_price * quantity) - discount_amount
  )
);

-- Copia de receta tomada al crear el pedido. Cambios posteriores de receta no alteran
-- el consumo ni la devolución de pedidos ya creados.
create table if not exists public.order_item_recipe_lines (
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  ingredient_name_snapshot text not null,
  unit public.inventory_unit not null,
  quantity_per_portion numeric(14,3) not null check (
    quantity_per_portion > 0 and quantity_per_portion::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  primary key (order_item_id, ingredient_id)
);

-- Libro de movimientos inmutable desde la API. Un solo tipo de existencia por movimiento.
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid references public.ingredients(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  order_item_id uuid references public.order_items(id) on delete restrict,
  type public.inventory_adjustment_type not null,
  quantity_delta numeric(14,3) not null check (
    quantity_delta <> 0 and quantity_delta::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  idempotency_key uuid unique,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_movement_one_target check (
    (ingredient_id is not null and product_id is null) or
    (ingredient_id is null and product_id is not null)
  ),
  constraint inventory_movement_order_link check (
    (type in ('order_consumption', 'order_reversal') and order_id is not null and order_item_id is not null)
    or (type not in ('order_consumption', 'order_reversal'))
  )
);
create index if not exists inventory_movements_ingredient_date
  on public.inventory_movements(ingredient_id, created_at desc);
create index if not exists inventory_movements_product_date
  on public.inventory_movements(product_id, created_at desc);
create index if not exists inventory_movements_order
  on public.inventory_movements(order_id, type);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  table_session_id uuid not null references public.table_sessions(id) on delete restrict,
  idempotency_key uuid not null unique,
  method public.payment_method not null,
  amount numeric(12,2) not null check (
    amount > 0 and amount::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  payer_label varchar(80),
  reference varchar(120),
  received_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Un pago se asigna a una o más líneas. Permite dividir por persona, importe y método
-- sin sobrepagar una línea ni perder la trazabilidad de caja.
create table if not exists public.payment_allocations (
  payment_id uuid not null references public.payments(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  amount numeric(12,2) not null check (
    amount > 0 and amount::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  primary key (payment_id, order_item_id)
);

create index if not exists orders_session_status_created
  on public.orders(table_session_id, status, created_at desc);
create index if not exists order_items_order on public.order_items(order_id);
create index if not exists product_ingredients_ingredient on public.product_ingredients(ingredient_id);
create index if not exists promotions_active_dates on public.promotions(active, starts_on, ends_on);

-- Proyección pública del menú: nunca expone stock real ni campos operativos.
create or replace view public.public_menu
with (security_barrier = true)
as
  select p.id, p.category_id, c.name as category_name, p.name, p.description,
         p.price, p.image_url
  from public.products p
  join public.categories c on c.id = p.category_id
  where p.active and c.active;

-- Perfiles Auth: todo usuario nuevo empieza con el rol menos privilegiado.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''), 'waiter')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- No permitir dejar el sistema sin un administrador activo.
create or replace function public.guard_last_active_admin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform pg_advisory_xact_lock(74103, 1);
  if tg_op = 'DELETE' then
    if old.role = 'admin' and old.active
       and (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
      raise exception 'CANNOT_REMOVE_LAST_ACTIVE_ADMIN' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.role = 'admin' and old.active
     and (new.role <> 'admin' or not new.active)
     and (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
    raise exception 'CANNOT_REMOVE_LAST_ACTIVE_ADMIN' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_last_active_admin on public.profiles;
create trigger protect_last_active_admin
  before update of role, active on public.profiles
  for each row execute procedure public.guard_last_active_admin();
drop trigger if exists protect_last_active_admin_delete on public.profiles;
create trigger protect_last_active_admin_delete
  before delete on public.profiles
  for each row execute procedure public.guard_last_active_admin();

create or replace function public.has_any_role(p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and role = any(p_roles)
  );
$$;

-- Abrir una visita/mesa. Es una operación atómica, no un UPDATE directo desde React.
create or replace function public.open_table_session(p_table_id uuid, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session_id uuid;
  v_status public.table_status;
begin
  if not public.has_any_role(array['admin','cashier','waiter']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select id into v_session_id from public.table_sessions where idempotency_key = p_idempotency_key;
  if found then
    if (select table_id from public.table_sessions where id = v_session_id) <> p_table_id then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return v_session_id;
  end if;
  select status into v_status from public.cafe_tables where id = p_table_id and active for update;
  if not found then raise exception 'TABLE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_status = 'unavailable' then raise exception 'TABLE_UNAVAILABLE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.table_sessions where table_id = p_table_id and status = 'open') then
    raise exception 'TABLE_ALREADY_OPEN' using errcode = 'P0001';
  end if;
  insert into public.table_sessions(table_id, idempotency_key, opened_by)
    values (p_table_id, p_idempotency_key, auth.uid())
    returning id into v_session_id;
  update public.cafe_tables set status = 'occupied', updated_at = now() where id = p_table_id;
  return v_session_id;
end;
$$;

-- El kiosco puede resolver el nombre visible de su QR sin consultar todas las mesas.
create or replace function public.get_public_table(p_table_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object('id', id, 'name', name)
  from public.cafe_tables
  where id = p_table_id and active;
$$;

create or replace function public.set_table_status(
  p_table_id uuid,
  p_status public.table_status
)
returns public.table_status
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_status public.table_status;
begin
  if not public.has_any_role(array['admin']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_status is null then raise exception 'TABLE_STATUS_REQUIRED' using errcode = '22023'; end if;
  perform 1 from public.cafe_tables where id = p_table_id for update;
  if not found then raise exception 'TABLE_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.table_sessions where table_id = p_table_id and status = 'open')
     and p_status <> 'occupied' then
    raise exception 'TABLE_HAS_OPEN_SESSION' using errcode = 'P0001';
  end if;
  if p_status = 'occupied' and not exists (
    select 1 from public.table_sessions where table_id = p_table_id and status = 'open'
  ) then raise exception 'OPEN_SESSION_REQUIRED' using errcode = 'P0001'; end if;
  update public.cafe_tables set status = p_status, updated_at = now()
    where id = p_table_id returning status into v_status;
  return v_status;
end;
$$;

-- Reemplazo de receta atómico y reservado a administración. Los snapshots de pedidos
-- existentes permanecen intactos aunque se edite esta relación.
create or replace function public.replace_product_recipe(p_product_id uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_line record;
  v_count integer := 0;
  v_product_exists boolean;
  v_ingredient_exists boolean;
begin
  if not public.has_any_role(array['admin']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 30 then
    raise exception 'INVALID_RECIPE' using errcode = '22023';
  end if;
  select exists(select 1 from public.products where id = p_product_id)
    into v_product_exists;
  if not v_product_exists then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <>
     (select count(distinct value ->> 'ingredient_id') from jsonb_array_elements(p_lines)) then
    raise exception 'DUPLICATE_RECIPE_INGREDIENT' using errcode = '22023';
  end if;
  perform 1 from public.products where id = p_product_id for update;
  for v_line in
    select (value ->> 'ingredient_id')::uuid as ingredient_id,
           (value ->> 'quantity_per_portion')::numeric(14,3) as quantity_per_portion
    from jsonb_array_elements(p_lines)
  loop
    if v_line.quantity_per_portion is null or v_line.quantity_per_portion <= 0 then
      raise exception 'INVALID_RECIPE_QUANTITY' using errcode = '22023';
    end if;
    select exists(select 1 from public.ingredients where id = v_line.ingredient_id and active)
      into v_ingredient_exists;
    if not v_ingredient_exists then raise exception 'INGREDIENT_NOT_FOUND_OR_INACTIVE' using errcode = 'P0002'; end if;
  end loop;
  delete from public.product_ingredients where product_id = p_product_id;
  insert into public.product_ingredients(product_id, ingredient_id, quantity_per_portion)
  select p_product_id, (value ->> 'ingredient_id')::uuid,
         (value ->> 'quantity_per_portion')::numeric(14,3)
    from jsonb_array_elements(p_lines);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Crear pedido desde el kiosco o POS. Los precios y recetas se leen en la BD;
-- el cliente no envía ni puede decidir el precio/stock. No descuenta stock todavía.
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
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_notes text;
  v_product public.products%rowtype;
  v_order_item_id uuid;
  v_line_total numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_count integer := 0;
begin
  if p_idempotency_key is null or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'INVALID_ORDER' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select id, table_id into v_order_id, v_existing_table
    from public.orders where idempotency_key = p_idempotency_key;
  if found then
    if v_existing_table <> p_table_id then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023'; end if;
    return v_order_id;
  end if;
  select id into v_session_id
    from public.table_sessions
    where table_id = p_table_id and status = 'open'
    for update;
  if not found then raise exception 'NO_OPEN_TABLE_SESSION' using errcode = 'P0001'; end if;

  insert into public.orders(table_session_id, table_id, created_by, idempotency_key)
  values (v_session_id, p_table_id, auth.uid(), p_idempotency_key)
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    v_notes := nullif(left(btrim(coalesce(v_item ->> 'notes', '')), 200), '');
    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then
      raise exception 'INVALID_QUANTITY' using errcode = '22023';
    end if;
    select p.* into v_product from public.products p
      where p.id = v_product_id and p.active
        and exists (
          select 1 from public.categories c
          where c.id = p.category_id and c.active
        )
      for share of p;
    if not found then raise exception 'PRODUCT_UNAVAILABLE' using errcode = 'P0001'; end if;
    if exists (
      select 1 from public.product_ingredients pi
      join public.ingredients i on i.id = pi.ingredient_id
      where pi.product_id = v_product.id and not i.active
    ) then raise exception 'PRODUCT_RECIPE_HAS_INACTIVE_INGREDIENT' using errcode = 'P0001'; end if;

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

  update public.orders set subtotal = v_subtotal, total = v_subtotal, updated_at = now()
    where id = v_order_id;
  return v_order_id;
end;
$$;

-- Confirmar pedido: valida y descuenta toda la receta/stock en una transacción.
create or replace function public.confirm_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session_id uuid;
  v_session_status public.session_status;
  v_status public.order_status;
  v_shortage record;
begin
  if not public.has_any_role(array['admin','cashier','waiter']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select table_session_id into v_session_id from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  select status into v_session_status from public.table_sessions where id = v_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002'; end if;
  select status into v_status from public.orders where id = p_order_id for update;
  if v_status in ('confirmed','preparing','ready','served') then
    return jsonb_build_object('order_id', p_order_id, 'status', v_status, 'idempotent_replay', true);
  end if;
  if v_session_status <> 'open' then raise exception 'SESSION_NOT_OPEN' using errcode = 'P0001'; end if;
  if v_status <> 'pending' then raise exception 'ORDER_NOT_PENDING' using errcode = 'P0001'; end if;

  perform p.id
    from public.products p
    join public.order_items oi on oi.product_id = p.id
    where oi.order_id = p_order_id and not oi.uses_recipe
    order by p.id for update of p;
  select p.name, p.stock, sum(oi.quantity) as quantity into v_shortage
    from public.order_items oi join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id and not oi.uses_recipe
    group by p.id, p.name, p.stock
    having p.stock < sum(oi.quantity)
    limit 1;
  if found then
    raise exception 'INSUFFICIENT_PRODUCT_STOCK: % (disponible %, solicitado %)',
      v_shortage.name, v_shortage.stock, v_shortage.quantity using errcode = 'P0001';
  end if;

  perform i.id
    from public.ingredients i
    where i.id in (
      select distinct ril.ingredient_id
      from public.order_items oi
      join public.order_item_recipe_lines ril on ril.order_item_id = oi.id
      where oi.order_id = p_order_id
    )
    order by i.id for update;
  select i.name, i.stock, sum(ril.quantity_per_portion * oi.quantity) as needed
    into v_shortage
    from public.order_items oi
    join public.order_item_recipe_lines ril on ril.order_item_id = oi.id
    join public.ingredients i on i.id = ril.ingredient_id
    where oi.order_id = p_order_id
    group by i.id, i.name, i.stock
    having i.stock < sum(ril.quantity_per_portion * oi.quantity)
    limit 1;
  if found then
    raise exception 'INSUFFICIENT_INGREDIENT_STOCK: % (disponible %, necesario %)',
      v_shortage.name, v_shortage.stock, v_shortage.needed using errcode = 'P0001';
  end if;

  update public.products p
    set stock = p.stock - req.quantity, updated_at = now()
    from (
      select product_id, sum(quantity)::numeric(14,3) as quantity
      from public.order_items
      where order_id = p_order_id and not uses_recipe
      group by product_id
    ) req
    where p.id = req.product_id;
  insert into public.inventory_movements(
    product_id, order_id, order_item_id, type, quantity_delta, created_by
  )
  select oi.product_id, oi.order_id, oi.id, 'order_consumption', -oi.quantity, auth.uid()
    from public.order_items oi
    where oi.order_id = p_order_id and not oi.uses_recipe;

  update public.ingredients i
    set stock = i.stock - req.quantity, updated_at = now()
    from (
      select ril.ingredient_id, sum(ril.quantity_per_portion * oi.quantity)::numeric(14,3) as quantity
      from public.order_items oi
      join public.order_item_recipe_lines ril on ril.order_item_id = oi.id
      where oi.order_id = p_order_id
      group by ril.ingredient_id
    ) req
    where i.id = req.ingredient_id;
  insert into public.inventory_movements(
    ingredient_id, order_id, order_item_id, type, quantity_delta, created_by
  )
  select ril.ingredient_id, oi.order_id, oi.id, 'order_consumption',
         -(ril.quantity_per_portion * oi.quantity), auth.uid()
    from public.order_items oi
    join public.order_item_recipe_lines ril on ril.order_item_id = oi.id
    where oi.order_id = p_order_id;

  update public.orders set status = 'confirmed', confirmed_at = now(), updated_at = now()
    where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'status', 'confirmed');
end;
$$;

create or replace function public.advance_order(p_order_id uuid, p_next_status public.order_status)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session_id uuid;
  v_current public.order_status;
  v_allowed boolean := false;
begin
  if not public.has_any_role(array['admin','cashier','waiter']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select table_session_id into v_session_id from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  perform 1 from public.table_sessions where id = v_session_id for update;
  select status into v_current from public.orders where id = p_order_id for update;
  if v_current = p_next_status then
    return jsonb_build_object('order_id', p_order_id, 'status', p_next_status, 'idempotent_replay', true);
  end if;
  v_allowed := (v_current = 'confirmed' and p_next_status = 'preparing')
    or (v_current = 'preparing' and p_next_status = 'ready')
    or (v_current = 'ready' and p_next_status = 'served');
  if v_allowed is distinct from true then raise exception 'INVALID_ORDER_TRANSITION' using errcode = 'P0001'; end if;
  update public.orders set status = p_next_status, updated_at = now() where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'status', p_next_status);
end;
$$;

create or replace function public.cancel_order(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session_id uuid;
  v_status public.order_status;
  v_move record;
begin
  if not public.has_any_role(array['admin','cashier','waiter']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select table_session_id into v_session_id from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  perform 1 from public.table_sessions where id = v_session_id for update;
  select status into v_status from public.orders where id = p_order_id for update;
  if v_status = 'cancelled' then
    return jsonb_build_object('order_id', p_order_id, 'status', 'cancelled', 'idempotent_replay', true);
  end if;
  if v_status in ('preparing','ready','served') then
    raise exception 'ORDER_TOO_LATE_TO_CANCEL' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.order_items oi
    join public.payment_allocations pa on pa.order_item_id = oi.id
    where oi.order_id = p_order_id
  ) then raise exception 'ORDER_HAS_PAYMENT' using errcode = 'P0001'; end if;

  -- Bloqueo determinista (productos primero, después ingredientes) para evitar
  -- deadlocks entre cancelaciones y confirmaciones con inventario compartido.
  perform 1 from public.products p
    where p.id in (
      select distinct product_id from public.inventory_movements
      where order_id = p_order_id and type = 'order_consumption' and product_id is not null
    )
    order by p.id for update;
  perform 1 from public.ingredients i
    where i.id in (
      select distinct ingredient_id from public.inventory_movements
      where order_id = p_order_id and type = 'order_consumption' and ingredient_id is not null
    )
    order by i.id for update;
  for v_move in
    select * from public.inventory_movements
    where order_id = p_order_id and type = 'order_consumption'
    order by id
  loop
    if v_move.ingredient_id is not null then
      update public.ingredients set stock = stock - v_move.quantity_delta, updated_at = now()
        where id = v_move.ingredient_id;
      insert into public.inventory_movements(
        ingredient_id, order_id, order_item_id, type, quantity_delta, reason, created_by
      ) values (
        v_move.ingredient_id, p_order_id, v_move.order_item_id, 'order_reversal',
        -v_move.quantity_delta, left(coalesce(p_reason, 'Cancelación de pedido'), 250), auth.uid()
      );
    else
      update public.products set stock = stock - v_move.quantity_delta, updated_at = now()
        where id = v_move.product_id;
      insert into public.inventory_movements(
        product_id, order_id, order_item_id, type, quantity_delta, reason, created_by
      ) values (
        v_move.product_id, p_order_id, v_move.order_item_id, 'order_reversal',
        -v_move.quantity_delta, left(coalesce(p_reason, 'Cancelación de pedido'), 250), auth.uid()
      );
    end if;
  end loop;
  update public.orders set status = 'cancelled', updated_at = now() where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'status', 'cancelled');
end;
$$;

create or replace function public.adjust_ingredient_stock(
  p_ingredient_id uuid,
  p_delta numeric,
  p_type public.inventory_adjustment_type,
  p_idempotency_key uuid,
  p_reason text default null
)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_stock numeric(14,3);
  v_existing public.inventory_movements%rowtype;
begin
  if not public.has_any_role(array['admin','cashier']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_existing from public.inventory_movements where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.ingredient_id is distinct from p_ingredient_id
       or v_existing.product_id is not null
       or v_existing.quantity_delta is distinct from p_delta
       or v_existing.type is distinct from p_type then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    select stock into v_stock from public.ingredients where id = p_ingredient_id;
    return v_stock;
  end if;
   if p_type is null or p_type not in ('opening_balance','purchase','expiration','spill','damage','count_correction','return_to_stock','manual_adjustment')
      or p_delta = 0 or p_delta is null
      or p_delta::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'INVALID_INVENTORY_ADJUSTMENT' using errcode = '22023';
  end if;
  if p_type in ('opening_balance','purchase','return_to_stock') and p_delta < 0 then
    raise exception 'ADJUSTMENT_DIRECTION_INVALID' using errcode = '22023';
  end if;
  if p_type in ('expiration','spill','damage') and p_delta > 0 then
    raise exception 'ADJUSTMENT_DIRECTION_INVALID' using errcode = '22023';
  end if;
  select stock into v_stock from public.ingredients where id = p_ingredient_id and active for update;
  if not found then raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_stock + p_delta < 0 then raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001'; end if;
  update public.ingredients set stock = stock + p_delta, updated_at = now() where id = p_ingredient_id
    returning stock into v_stock;
  insert into public.inventory_movements(
    ingredient_id, type, quantity_delta, idempotency_key, reason, created_by
  ) values (
    p_ingredient_id, p_type, p_delta, p_idempotency_key, left(p_reason, 250), auth.uid()
  );
  return v_stock;
end;
$$;

create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_delta numeric,
  p_type public.inventory_adjustment_type,
  p_idempotency_key uuid,
  p_reason text default null
)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_stock numeric(14,3);
  v_existing public.inventory_movements%rowtype;
begin
  if not public.has_any_role(array['admin','cashier']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_existing from public.inventory_movements where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.product_id is distinct from p_product_id
       or v_existing.ingredient_id is not null
       or v_existing.quantity_delta is distinct from p_delta
       or v_existing.type is distinct from p_type then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    select stock into v_stock from public.products where id = p_product_id;
    return v_stock;
  end if;
  if p_type is null or p_type not in ('opening_balance','purchase','expiration','spill','damage','count_correction','return_to_stock','manual_adjustment')
     or p_delta = 0 or p_delta is null
     or p_delta::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'INVALID_INVENTORY_ADJUSTMENT' using errcode = '22023';
  end if;
  if p_type in ('opening_balance','purchase','return_to_stock') and p_delta < 0 then
    raise exception 'ADJUSTMENT_DIRECTION_INVALID' using errcode = '22023';
  end if;
  if p_type in ('expiration','spill','damage') and p_delta > 0 then
    raise exception 'ADJUSTMENT_DIRECTION_INVALID' using errcode = '22023';
  end if;
  select stock into v_stock from public.products where id = p_product_id and active for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.product_ingredients where product_id = p_product_id) then
    raise exception 'RECIPE_PRODUCT_STOCK_IS_DERIVED' using errcode = 'P0001';
  end if;
  if v_stock + p_delta < 0 then raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001'; end if;
  update public.products set stock = stock + p_delta, updated_at = now() where id = p_product_id
    returning stock into v_stock;
  insert into public.inventory_movements(
    product_id, type, quantity_delta, idempotency_key, reason, created_by
  ) values (
    p_product_id, p_type, p_delta, p_idempotency_key, left(p_reason, 250), auth.uid()
  );
  return v_stock;
end;
$$;

create or replace function public.record_session_payment(
  p_table_session_id uuid,
  p_method public.payment_method,
  p_allocations jsonb,
  p_idempotency_key uuid,
  p_payer_label text default null,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_payment_id uuid;
  v_existing_session uuid;
  v_session_status public.session_status;
  v_allocation record;
  v_item_total numeric(12,2);
  v_already_paid numeric(12,2);
  v_amount numeric := 0;
  v_due numeric(12,2);
  v_paid numeric(12,2);
  v_can_close boolean;
begin
  if not public.has_any_role(array['admin','cashier']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select id, table_session_id into v_payment_id, v_existing_session
    from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if v_existing_session <> p_table_session_id then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023'; end if;
    return jsonb_build_object('payment_id', v_payment_id, 'idempotent_replay', true);
  end if;
  if p_method is null then raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023'; end if;
  if p_idempotency_key is null or p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) < 1 or jsonb_array_length(p_allocations) > 100 then
    raise exception 'INVALID_PAYMENT_ALLOCATIONS' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_allocations)) <>
     (select count(distinct value ->> 'order_item_id') from jsonb_array_elements(p_allocations)) then
    raise exception 'DUPLICATE_PAYMENT_ALLOCATION' using errcode = '22023';
  end if;

  select status into v_session_status from public.table_sessions
    where id = p_table_session_id for update;
  if not found or v_session_status <> 'open' then raise exception 'SESSION_NOT_OPEN' using errcode = 'P0001'; end if;

  for v_allocation in
    select (value ->> 'order_item_id')::uuid as order_item_id,
           (value ->> 'amount')::numeric as amount
    from jsonb_array_elements(p_allocations)
  loop
    if v_allocation.amount is null or v_allocation.amount <= 0
       or v_allocation.amount::text in ('NaN', 'Infinity', '-Infinity')
       or round(v_allocation.amount, 2) <> v_allocation.amount then
      raise exception 'INVALID_PAYMENT_AMOUNT' using errcode = '22023';
    end if;
    select oi.subtotal into v_item_total
      from public.order_items oi join public.orders o on o.id = oi.order_id
      where oi.id = v_allocation.order_item_id
        and o.table_session_id = p_table_session_id and o.status = 'served'
      for update of oi;
    if not found then raise exception 'PAYMENT_ITEM_NOT_PAYABLE' using errcode = 'P0001'; end if;
    select coalesce(sum(pa.amount), 0) into v_already_paid
      from public.payment_allocations pa where pa.order_item_id = v_allocation.order_item_id;
    if v_already_paid + v_allocation.amount > v_item_total then
      raise exception 'PAYMENT_EXCEEDS_ITEM_BALANCE' using errcode = 'P0001';
    end if;
    v_amount := v_amount + v_allocation.amount;
  end loop;
  if round(v_amount, 2) <> v_amount then raise exception 'INVALID_PAYMENT_PRECISION' using errcode = '22023'; end if;

  insert into public.payments(
    table_session_id, idempotency_key, method, amount, payer_label, reference, received_by
  ) values (
    p_table_session_id, p_idempotency_key, p_method, v_amount,
    nullif(left(btrim(coalesce(p_payer_label, '')), 80), ''),
    nullif(left(btrim(coalesce(p_reference, '')), 120), ''), auth.uid()
  ) returning id into v_payment_id;

  insert into public.payment_allocations(payment_id, order_item_id, amount)
  select v_payment_id, (value ->> 'order_item_id')::uuid, (value ->> 'amount')::numeric
    from jsonb_array_elements(p_allocations);

  update public.orders o
    set payment_status = case
      when coalesce((select sum(pa.amount) from public.payment_allocations pa
        join public.order_items oi on oi.id = pa.order_item_id where oi.order_id = o.id), 0)
        >= coalesce((select sum(oi.subtotal) from public.order_items oi where oi.order_id = o.id), 0)
        then 'paid'::public.payment_status
      when exists (select 1 from public.payment_allocations pa
        join public.order_items oi on oi.id = pa.order_item_id where oi.order_id = o.id)
        then 'partial'::public.payment_status
      else 'unpaid'::public.payment_status
    end,
    updated_at = now()
    where o.table_session_id = p_table_session_id and o.status = 'served';

  select coalesce(sum(oi.subtotal),0) into v_due
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.table_session_id = p_table_session_id and o.status = 'served';
  select coalesce(sum(pa.amount),0) into v_paid
    from public.payments p join public.payment_allocations pa on pa.payment_id = p.id
    where p.table_session_id = p_table_session_id;
  v_can_close := v_due = v_paid and not exists (
    select 1 from public.orders where table_session_id = p_table_session_id
      and status not in ('served','cancelled')
  );
  if v_can_close then
    perform 1 from public.cafe_tables
      where id = (select table_id from public.table_sessions where id = p_table_session_id)
      for update;
    update public.table_sessions set status = 'closed', closed_at = now()
      where id = p_table_session_id;
    update public.cafe_tables set status = 'available', updated_at = now()
      where id = (select table_id from public.table_sessions where id = p_table_session_id);
  end if;
  return jsonb_build_object(
    'payment_id', v_payment_id, 'amount', v_amount, 'method', p_method,
    'session_closed', v_can_close
  );
end;
$$;

create or replace function public.close_empty_table_session(p_table_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_table_id uuid;
  v_status public.session_status;
begin
  if not public.has_any_role(array['admin','cashier','waiter']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select table_id, status into v_table_id, v_status
    from public.table_sessions where id = p_table_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_status = 'closed' then
    return jsonb_build_object('table_session_id', p_table_session_id, 'status', 'closed', 'idempotent_replay', true);
  end if;
  if v_status <> 'open' then raise exception 'SESSION_NOT_OPEN' using errcode = 'P0001'; end if;
  if exists (
    select 1 from public.orders
    where table_session_id = p_table_session_id and status <> 'cancelled'
      and (status <> 'served' or payment_status <> 'paid')
  ) then raise exception 'SESSION_HAS_UNFINISHED_OR_UNPAID_ORDERS' using errcode = 'P0001'; end if;
  perform 1 from public.cafe_tables where id = v_table_id for update;
  update public.table_sessions set status = 'closed', closed_at = now()
    where id = p_table_session_id;
  update public.cafe_tables set status = 'available', updated_at = now() where id = v_table_id;
  return jsonb_build_object('table_session_id', p_table_session_id, 'status', 'closed');
end;
$$;

-- RLS: el menú es público; datos operativos requieren perfil de personal.
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.cafe_tables enable row level security;
alter table public.table_sessions enable row level security;
alter table public.ingredients enable row level security;
alter table public.product_ingredients enable row level security;
alter table public.promotions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_recipe_lines enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;

drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_any_role(array['admin']::public.app_role[]));
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.has_any_role(array['admin']::public.app_role[]))
  with check (public.has_any_role(array['admin']::public.app_role[]));

drop policy if exists categories_public_or_staff_read on public.categories;
create policy categories_public_or_staff_read on public.categories for select to anon, authenticated
  using (active or public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories for all to authenticated
  using (public.has_any_role(array['admin']::public.app_role[]))
  with check (public.has_any_role(array['admin']::public.app_role[]));

drop policy if exists products_public_or_staff_read on public.products;
create policy products_public_or_staff_read on public.products for select to anon, authenticated
  using (active or public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products for all to authenticated
  using (public.has_any_role(array['admin']::public.app_role[]))
  with check (public.has_any_role(array['admin']::public.app_role[]));

drop policy if exists tables_staff_read on public.cafe_tables;
create policy tables_staff_read on public.cafe_tables for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists tables_admin_write on public.cafe_tables;
create policy tables_admin_write on public.cafe_tables for all to authenticated
  using (public.has_any_role(array['admin']::public.app_role[]))
  with check (public.has_any_role(array['admin']::public.app_role[]));

drop policy if exists sessions_staff_read on public.table_sessions;
create policy sessions_staff_read on public.table_sessions for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists ingredients_staff_read on public.ingredients;
create policy ingredients_staff_read on public.ingredients for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists ingredients_admin_write on public.ingredients;
create policy ingredients_admin_write on public.ingredients for all to authenticated
  using (public.has_any_role(array['admin']::public.app_role[]))
  with check (public.has_any_role(array['admin']::public.app_role[]));

drop policy if exists recipes_staff_read on public.product_ingredients;
create policy recipes_staff_read on public.product_ingredients for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists recipes_admin_write on public.product_ingredients;
create policy recipes_admin_write on public.product_ingredients for all to authenticated
  using (public.has_any_role(array['admin']::public.app_role[]))
  with check (public.has_any_role(array['admin']::public.app_role[]));

drop policy if exists promotions_public_or_staff_read on public.promotions;
create policy promotions_public_or_staff_read on public.promotions for select to anon, authenticated
  using (
    (active and (starts_on is null or starts_on <= current_date)
      and (ends_on is null or ends_on >= current_date))
    or public.has_any_role(array['admin','cashier','waiter']::public.app_role[])
  );
drop policy if exists promotions_admin_write on public.promotions;
create policy promotions_admin_write on public.promotions for all to authenticated
  using (public.has_any_role(array['admin']::public.app_role[]))
  with check (public.has_any_role(array['admin']::public.app_role[]));

drop policy if exists orders_staff_read on public.orders;
create policy orders_staff_read on public.orders for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists order_items_staff_read on public.order_items;
create policy order_items_staff_read on public.order_items for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists recipe_snapshots_staff_read on public.order_item_recipe_lines;
create policy recipe_snapshots_staff_read on public.order_item_recipe_lines for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists inventory_movements_staff_read on public.inventory_movements;
create policy inventory_movements_staff_read on public.inventory_movements for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists payments_staff_read on public.payments;
create policy payments_staff_read on public.payments for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists allocations_staff_read on public.payment_allocations;
create policy allocations_staff_read on public.payment_allocations for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));

-- Permisos SQL base: RLS sigue decidiendo qué filas y operaciones están permitidas.
grant usage on schema public to anon, authenticated;
grant usage on type public.app_role, public.table_status, public.session_status,
  public.order_status, public.payment_status, public.payment_method, public.inventory_unit,
  public.inventory_adjustment_type, public.promotion_type, public.promotion_scope
  to anon, authenticated;
revoke all on all tables in schema public from public, anon, authenticated;
grant select on public.categories, public.promotions, public.public_menu to anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, delete on public.categories to authenticated;
grant update (name, description, active) on public.categories to authenticated;
grant insert (category_id, name, description, price, image_url, active) on public.products to authenticated;
grant delete on public.products to authenticated;
grant update (category_id, name, description, price, image_url, active) on public.products to authenticated;
grant insert (name, active) on public.cafe_tables to authenticated;
grant delete on public.cafe_tables to authenticated;
grant update (name, active) on public.cafe_tables to authenticated;
grant update (display_name, role, active) on public.profiles to authenticated;
grant insert (name, unit, min_stock, active) on public.ingredients to authenticated;
grant delete on public.ingredients to authenticated;
grant update (name, min_stock, active) on public.ingredients to authenticated;
grant insert, update, delete on public.promotions to authenticated;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.guard_last_active_admin() from public, anon, authenticated;
revoke all on function public.has_any_role(public.app_role[]) from public, anon;
grant execute on function public.has_any_role(public.app_role[]) to anon, authenticated;
revoke all on function public.open_table_session(uuid, uuid) from public, anon;
grant execute on function public.open_table_session(uuid, uuid) to authenticated;
revoke all on function public.get_public_table(uuid) from public;
grant execute on function public.get_public_table(uuid) to anon, authenticated;
revoke all on function public.set_table_status(uuid, public.table_status) from public, anon;
grant execute on function public.set_table_status(uuid, public.table_status) to authenticated;
revoke all on function public.replace_product_recipe(uuid, jsonb) from public, anon;
grant execute on function public.replace_product_recipe(uuid, jsonb) to authenticated;
revoke all on function public.create_public_order(uuid, jsonb, uuid) from public;
grant execute on function public.create_public_order(uuid, jsonb, uuid) to anon, authenticated;
revoke all on function public.confirm_order(uuid) from public, anon;
grant execute on function public.confirm_order(uuid) to authenticated;
revoke all on function public.advance_order(uuid, public.order_status) from public, anon;
grant execute on function public.advance_order(uuid, public.order_status) to authenticated;
revoke all on function public.cancel_order(uuid, text) from public, anon;
grant execute on function public.cancel_order(uuid, text) to authenticated;
revoke all on function public.adjust_ingredient_stock(uuid, numeric, public.inventory_adjustment_type, uuid, text) from public, anon;
grant execute on function public.adjust_ingredient_stock(uuid, numeric, public.inventory_adjustment_type, uuid, text) to authenticated;
revoke all on function public.adjust_product_stock(uuid, numeric, public.inventory_adjustment_type, uuid, text) from public, anon;
grant execute on function public.adjust_product_stock(uuid, numeric, public.inventory_adjustment_type, uuid, text) to authenticated;
revoke all on function public.record_session_payment(uuid, public.payment_method, jsonb, uuid, text, text) from public, anon;
grant execute on function public.record_session_payment(uuid, public.payment_method, jsonb, uuid, text, text) to authenticated;
revoke all on function public.close_empty_table_session(uuid) from public, anon;
grant execute on function public.close_empty_table_session(uuid) to authenticated;

comment on type public.inventory_unit is
  'Unidades base cerradas: g para sólidos, ml para líquidos, unit para piezas. Convertir kg→g y l→ml en UI antes de llamar a la API.';
comment on table public.inventory_movements is
  'Libro de movimientos append-only por RLS; los cambios de existencias pasan por RPC para conservar auditoría.';
comment on function public.create_public_order(uuid, jsonb, uuid) is
  'RPC REST para crear pedido con precio y receta consultados en BD. No consume stock hasta confirm_order.';
comment on function public.confirm_order(uuid) is
  'RPC atómica: bloquea stock, valida disponibilidad, registra consumos y confirma. Error cancela toda la transacción.';
comment on function public.record_session_payment(uuid, public.payment_method, jsonb, uuid, text, text) is
  'RPC para pagos parciales/divididos por línea, persona y método; asignaciones impiden sobrepagar y cierran la sesión al saldarla.';
