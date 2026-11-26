-- Coffee Connect: closed measurement catalog and ingredient-specific pack sizes.
-- Apply after 001_supabase_schema.sql. This migration does not rewrite existing
-- inventory balances, movements, recipes, or order snapshots.
begin;

create table if not exists public.measurement_units (
  code text primary key,
  name text not null,
  abbreviation text not null,
  category text not null,
  base_unit public.inventory_unit,
  conversion_factor numeric(18,9),
  active boolean not null default true,
  sort_order integer not null
);

-- Older manual installations used `presentation` and these constraint names.
-- Remove constraints before normalizing rows so both old and fresh databases work.
alter table public.measurement_units drop constraint if exists valid_measurement_category;
alter table public.measurement_units drop constraint if exists valid_conversion;
alter table public.measurement_units drop constraint if exists measurement_units_category_check;
alter table public.measurement_units drop constraint if exists measurement_units_conversion_valid;
update public.measurement_units set category='purchase' where category='presentation';
alter table public.measurement_units add constraint valid_measurement_category
  check (category in ('weight','volume','preparation','count','purchase'));
alter table public.measurement_units add constraint valid_conversion check (
  (category='purchase' and base_unit is null and conversion_factor is null)
  or (category<>'purchase' and base_unit is not null
    and conversion_factor is not null
    and conversion_factor>0
    and conversion_factor::text not in ('NaN','Infinity','-Infinity'))
);

insert into public.measurement_units
  (code,name,abbreviation,category,base_unit,conversion_factor,sort_order)
values
  ('g','Gramo','g','weight','g',1,10), ('kg','Kilogramo','kg','weight','g',1000,20),
  ('lb','Libra','lb','weight','g',453.592370000,30), ('oz','Onza','oz','weight','g',28.349523125,40),
  ('ml','Mililitro','ml','volume','ml',1,50), ('l','Litro','l','volume','ml',1000,60),
  ('fl_oz','Onza líquida','fl oz','volume','ml',29.573529563,70), ('gal','Galón','gal','volume','ml',3785.411784000,80),
  ('cup','Taza','taza','preparation','ml',240,90), ('tbsp','Cucharada','cda','preparation','ml',15,100),
  ('tsp','Cucharadita','cdta','preparation','ml',5,110),
  ('unit','Unidad','unidad','count','unit',1,120), ('dozen','Docena','docena','count','unit',12,130),
  ('bag','Bolsa','bolsa','purchase',null,null,200), ('pack','Paquete','paquete','purchase',null,null,210),
  ('box','Caja','caja','purchase',null,null,220), ('bottle','Botella','botella','purchase',null,null,230),
  ('can','Lata','lata','purchase',null,null,240), ('sack','Saco','saco','purchase',null,null,250),
  ('jar','Bote','bote','purchase',null,null,260), ('carton','Cartón','cartón','purchase',null,null,270)
on conflict (code) do update set
  name=excluded.name, abbreviation=excluded.abbreviation, category=excluded.category,
  base_unit=excluded.base_unit, conversion_factor=excluded.conversion_factor, sort_order=excluded.sort_order;

-- Additional per-ingredient equivalence (e.g. one cup of flour = 120 g).
create table if not exists public.ingredient_unit_conversions (
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  unit_code text not null references public.measurement_units(code) on delete restrict,
  quantity_in_base numeric(18,9) not null check (
    quantity_in_base > 0 and quantity_in_base::text not in ('NaN','Infinity','-Infinity')
  ),
  primary key (ingredient_id, unit_code)
);

create table if not exists public.ingredient_presentations (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  unit_code text not null references public.measurement_units(code) on delete restrict,
  name text not null,
  quantity_in_base numeric(14,3) not null check (
    quantity_in_base > 0 and quantity_in_base::text not in ('NaN','Infinity','-Infinity')
  ),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingredient_presentations_name_not_blank check (length(btrim(name)) > 0),
  unique (ingredient_id, name)
);
create index if not exists ingredient_presentations_ingredient on public.ingredient_presentations(ingredient_id, active);

alter table public.measurement_units enable row level security;
alter table public.ingredient_unit_conversions enable row level security;
alter table public.ingredient_presentations enable row level security;
drop policy if exists measurement_units_read on public.measurement_units;
drop policy if exists measurement_units_read_staff on public.measurement_units;
create policy measurement_units_read_staff on public.measurement_units for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists ingredient_conversions_staff_read on public.ingredient_unit_conversions;
create policy ingredient_conversions_staff_read on public.ingredient_unit_conversions for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists presentations_staff_read on public.ingredient_presentations;
create policy presentations_staff_read on public.ingredient_presentations for select to authenticated
  using (public.has_any_role(array['admin','cashier','waiter']::public.app_role[]));
drop policy if exists presentations_admin_write on public.ingredient_presentations;
create policy presentations_admin_write on public.ingredient_presentations for all to authenticated
  using (public.has_any_role(array['admin']::public.app_role[]))
  with check (public.has_any_role(array['admin']::public.app_role[]));
drop policy if exists conversions_admin_write on public.ingredient_unit_conversions;
create policy conversions_admin_write on public.ingredient_unit_conversions for all to authenticated
  using (public.has_any_role(array['admin']::public.app_role[]))
  with check (public.has_any_role(array['admin']::public.app_role[]));

grant select on public.measurement_units, public.ingredient_presentations, public.ingredient_unit_conversions to authenticated;
grant insert, update, delete on public.ingredient_presentations, public.ingredient_unit_conversions to authenticated;
revoke insert, update, delete on public.measurement_units from public, anon, authenticated;

create or replace function public.convert_ingredient_quantity(
  p_ingredient_id uuid, p_unit_code text, p_quantity numeric
) returns numeric
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare v_base public.inventory_unit; v_factor numeric; v_unit_base public.inventory_unit;
begin
  if auth.uid() is null
    or not public.has_any_role(array['admin','cashier','waiter']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity::text in ('NaN','Infinity','-Infinity') then
    raise exception 'INVALID_MEASUREMENT_QUANTITY' using errcode='22023';
  end if;
  select unit into v_base from public.ingredients where id=p_ingredient_id and active;
  if not found then raise exception 'INGREDIENT_NOT_FOUND_OR_INACTIVE' using errcode='P0002'; end if;
  select base_unit, conversion_factor into v_unit_base, v_factor
    from public.measurement_units where code=p_unit_code and active and category <> 'purchase';
  if not found then raise exception 'MEASUREMENT_UNIT_INVALID' using errcode='22023'; end if;
  if v_unit_base = v_base then
    return round(p_quantity * v_factor, 3);
  end if;
  select quantity_in_base into v_factor from public.ingredient_unit_conversions
    where ingredient_id=p_ingredient_id and unit_code=p_unit_code;
  if not found then raise exception 'INCOMPATIBLE_MEASUREMENT_DIMENSIONS' using errcode='22023'; end if;
  return round(p_quantity * v_factor, 3);
end;
$$;
revoke all on function public.convert_ingredient_quantity(uuid,text,numeric) from public, anon;
grant execute on function public.convert_ingredient_quantity(uuid,text,numeric) to authenticated;

create or replace function public.record_ingredient_presentation_purchase(
  p_ingredient_id uuid, p_presentation_id uuid, p_quantity numeric,
  p_idempotency_key uuid, p_reason text default null
) returns numeric
language plpgsql security definer set search_path = pg_catalog
as $$
declare v_delta numeric(14,3); v_presentation public.ingredient_presentations%rowtype;
begin
  if not public.has_any_role(array['admin','cashier']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity::text in ('NaN','Infinity','-Infinity')
    or p_idempotency_key is null then
    raise exception 'INVALID_INVENTORY_ADJUSTMENT' using errcode='22023';
  end if;
  select * into v_presentation from public.ingredient_presentations
   where id=p_presentation_id and ingredient_id=p_ingredient_id and active for share;
  if not found then raise exception 'PRESENTATION_NOT_FOUND' using errcode='P0002'; end if;
  v_delta := round(p_quantity * v_presentation.quantity_in_base,3);
  if v_delta <= 0 then raise exception 'INVALID_INVENTORY_ADJUSTMENT' using errcode='22023'; end if;
  return public.adjust_ingredient_stock(p_ingredient_id,v_delta,'purchase',p_idempotency_key,
    left(coalesce(p_reason, p_quantity::text||' '||v_presentation.name),250));
end;
$$;
revoke all on function public.record_ingredient_presentation_purchase(uuid,uuid,numeric,uuid,text) from public, anon;
grant execute on function public.record_ingredient_presentation_purchase(uuid,uuid,numeric,uuid,text) to authenticated;

create or replace function public.adjust_ingredient_stock_measurement(
  p_ingredient_id uuid, p_quantity numeric, p_unit_code text,
  p_type public.inventory_adjustment_type, p_idempotency_key uuid, p_reason text default null
) returns numeric
language plpgsql security definer set search_path = pg_catalog
as $$
declare v_delta numeric(14,3); v_direction integer;
begin
  if p_type in ('opening_balance','purchase','return_to_stock') then v_direction:=1;
  elsif p_type in ('expiration','spill','damage') then v_direction:=-1;
  elsif p_type in ('count_correction','manual_adjustment') then v_direction:=0;
  else raise exception 'INVALID_INVENTORY_ADJUSTMENT' using errcode='22023';
  end if;
  if p_quantity is null or p_quantity=0 or p_quantity::text in ('NaN','Infinity','-Infinity')
    or (v_direction <> 0 and p_quantity < 0) then
    raise exception 'INVALID_INVENTORY_ADJUSTMENT' using errcode='22023';
  end if;
  v_delta := public.convert_ingredient_quantity(
    p_ingredient_id,p_unit_code,abs(p_quantity)
  ) * case when v_direction=0 then sign(p_quantity) else v_direction end;
  return public.adjust_ingredient_stock(p_ingredient_id,v_delta,p_type,p_idempotency_key,p_reason);
end;
$$;
revoke all on function public.adjust_ingredient_stock_measurement(uuid,numeric,text,public.inventory_adjustment_type,uuid,text) from public, anon;
grant execute on function public.adjust_ingredient_stock_measurement(uuid,numeric,text,public.inventory_adjustment_type,uuid,text) to authenticated;

-- Preserve the existing RPC contract and transaction; input lines may now carry
-- amount/unit_code. Legacy clients without unit_code continue to send base units.
alter table public.product_ingredients add column if not exists preparation_quantity numeric(14,3);
alter table public.product_ingredients add column if not exists preparation_unit_code text references public.measurement_units(code);
create or replace function public.replace_product_recipe(p_product_id uuid, p_lines jsonb)
returns integer language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_line record;
  v_count integer:=0;
  v_quantity numeric(14,3);
  v_raw_quantity numeric;
  v_ingredient_id uuid;
  v_ingredient_exists boolean;
  v_code text;
begin
  if auth.uid() is null or not public.has_any_role(array['admin']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)>30 then
    raise exception 'INVALID_RECIPE' using errcode='22023';
  end if;
  if not exists(select 1 from public.products where id=p_product_id) then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002'; end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <>
     (select count(distinct value->>'ingredient_id') from jsonb_array_elements(p_lines)) then
    raise exception 'DUPLICATE_RECIPE_INGREDIENT' using errcode='22023';
  end if;
  perform 1 from public.products where id=p_product_id for update;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin
      v_ingredient_id := (v_line.value->>'ingredient_id')::uuid;
    exception when others then
      raise exception 'INGREDIENT_NOT_FOUND_OR_INACTIVE' using errcode='P0002';
    end;
    select exists(select 1 from public.ingredients where id=v_ingredient_id and active)
      into v_ingredient_exists;
    if not v_ingredient_exists then
      raise exception 'INGREDIENT_NOT_FOUND_OR_INACTIVE' using errcode='P0002';
    end if;
    v_code:=coalesce(v_line.value->>'unit_code', v_line.value->>'unit');
    if v_code is null then
      -- Legacy clients provide this quantity in the ingredient's base unit.
      v_raw_quantity:=(v_line.value->>'quantity_per_portion')::numeric;
      if v_raw_quantity is null or v_raw_quantity<=0
        or v_raw_quantity::text in ('NaN','Infinity','-Infinity') then
        raise exception 'INVALID_RECIPE_QUANTITY' using errcode='22023';
      end if;
      v_quantity:=v_raw_quantity::numeric(14,3);
    else
      v_raw_quantity:=(v_line.value->>'quantity')::numeric;
      if v_raw_quantity is null or v_raw_quantity<=0
        or v_raw_quantity::text in ('NaN','Infinity','-Infinity') then
        raise exception 'INVALID_RECIPE_QUANTITY' using errcode='22023';
      end if;
      v_quantity:=public.convert_ingredient_quantity(
        v_ingredient_id, v_code, v_raw_quantity
      )::numeric(14,3);
    end if;
    if v_quantity is null or v_quantity<=0
      or v_quantity::text in ('NaN','Infinity','-Infinity') then
      raise exception 'INVALID_RECIPE_QUANTITY' using errcode='22023';
    end if;
  end loop;
  -- All lines have been validated before replacing; any later failure still rolls
  -- back the whole RPC transaction.
  delete from public.product_ingredients where product_id=p_product_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_ingredient_id := (v_line.value->>'ingredient_id')::uuid;
    v_code:=coalesce(v_line.value->>'unit_code', v_line.value->>'unit');
    if v_code is null then
      v_quantity:=(v_line.value->>'quantity_per_portion')::numeric(14,3);
      v_raw_quantity:=null;
    else
      v_raw_quantity:=(v_line.value->>'quantity')::numeric;
      v_quantity:=public.convert_ingredient_quantity(v_ingredient_id,v_code,v_raw_quantity)::numeric(14,3);
    end if;
    insert into public.product_ingredients(product_id,ingredient_id,quantity_per_portion,preparation_quantity,preparation_unit_code)
    values(p_product_id,v_ingredient_id,v_quantity,
      case when v_code is null then null else v_raw_quantity::numeric(14,3) end, v_code);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.replace_product_recipe(uuid,jsonb) from public, anon;
grant execute on function public.replace_product_recipe(uuid,jsonb) to authenticated;

-- A base unit is immutable after any movement or recipe use.
create or replace function public.guard_ingredient_base_unit()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if new.unit is distinct from old.unit and (
    old.stock<>0 or
    exists(select 1 from public.inventory_movements where ingredient_id=old.id)
    or exists(select 1 from public.product_ingredients where ingredient_id=old.id)
    or exists(select 1 from public.order_item_recipe_lines where ingredient_id=old.id)
    or exists(select 1 from public.ingredient_presentations where ingredient_id=old.id)
    or exists(select 1 from public.ingredient_unit_conversions where ingredient_id=old.id)
  ) then raise exception 'INGREDIENT_BASE_UNIT_IN_USE' using errcode='23514'; end if;
  return new;
end;
$$;
drop trigger if exists ingredients_base_unit_immutable on public.ingredients;
create trigger ingredients_base_unit_immutable before update of unit on public.ingredients
for each row execute function public.guard_ingredient_base_unit();

-- Presentation units are commercial labels only; their content is ingredient-specific.
create or replace function public.guard_ingredient_measurement_configuration()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
declare v_category text; v_unit_base public.inventory_unit; v_ingredient_base public.inventory_unit;
begin
  if tg_table_name='ingredient_presentations' then
    select category into v_category from public.measurement_units
      where code=new.unit_code and active;
    if v_category is distinct from 'purchase' then
      raise exception 'PRESENTATION_UNIT_MUST_BE_PURCHASE' using errcode='23514';
    end if;
  else
    select category,base_unit into v_category,v_unit_base from public.measurement_units
      where code=new.unit_code and active;
    select unit into v_ingredient_base from public.ingredients where id=new.ingredient_id;
    if v_category is null or v_category='purchase' or v_unit_base=v_ingredient_base then
      raise exception 'INVALID_INGREDIENT_UNIT_CONVERSION' using errcode='23514';
    end if;
    if new.quantity_in_base<=0 or new.quantity_in_base::text in ('NaN','Infinity','-Infinity') then
      raise exception 'INVALID_INGREDIENT_UNIT_CONVERSION' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists ingredient_presentations_unit_guard on public.ingredient_presentations;
create trigger ingredient_presentations_unit_guard before insert or update of unit_code,ingredient_id
on public.ingredient_presentations for each row execute function public.guard_ingredient_measurement_configuration();
drop trigger if exists ingredient_conversions_unit_guard on public.ingredient_unit_conversions;
create trigger ingredient_conversions_unit_guard before insert or update of unit_code,ingredient_id,quantity_in_base
on public.ingredient_unit_conversions for each row execute function public.guard_ingredient_measurement_configuration();

commit;
