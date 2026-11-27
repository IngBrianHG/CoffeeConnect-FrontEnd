-- Catalogo cerrado para el kiosco + datos de demostracion.
-- Incremental e idempotente. Revisar y aplicar primero en desarrollo/staging.
-- No ejecutar en produccion: los productos incluidos son unicamente de prueba.
-- No modifica mesas, sesiones, ordenes, existencias existentes ni Supabase remoto.

begin;

-- Orden deliberado del catalogo. Los iconos se resuelven en frontend mediante
-- el nombre fijo de cada categoria; no se duplica esa configuracion en la BD.
alter table public.categories
  add column if not exists display_order smallint not null default 100;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.categories'::regclass
      and conname = 'categories_display_order_nonnegative'
  ) then
    alter table public.categories
      add constraint categories_display_order_nonnegative
      check (display_order >= 0);
  end if;
end;
$$;

insert into public.categories (name, description, display_order, active)
values
  ('Bebidas frías', 'Bebidas servidas frías y bebidas con hielo.', 10, true),
  ('Bebidas calientes', 'Café, té y otras bebidas calientes.', 20, true),
  ('Postres', 'Postres individuales para disfrutar en cualquier momento.', 30, true),
  ('Pasteles', 'Porciones y pasteles de la casa.', 40, true),
  ('Repostería', 'Repostería dulce y piezas horneadas.', 50, true),
  ('Pan', 'Panes y opciones saladas recién horneadas.', 60, true),
  ('Otros', 'Productos que no pertenecen a otra categoría.', 90, true)
on conflict (name) do update
set description = excluded.description,
    display_order = excluded.display_order,
    active = true,
    updated_at = now();

-- Cierra el catalogo publico a estas siete categorias. Las categorias fuera
-- de la lista quedan inactivas (no se borran); sus productos y referencias se
-- conservan para revision/reactivacion administrativa si fuera necesario.
update public.categories
set active = false,
    updated_at = now()
where name not in (
  'Bebidas frías', 'Bebidas calientes', 'Postres', 'Pasteles',
  'Repostería', 'Pan', 'Otros'
)
and active;

-- Impide que se creen/activen categorias fuera del catalogo fijo. Las
-- categorias legacy ya inactivas permanecen intactas por sus relaciones.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.categories'::regclass
      and conname = 'categories_fixed_active_names'
  ) then
    alter table public.categories
      add constraint categories_fixed_active_names
      check (
        not active or name in (
          'Bebidas frías', 'Bebidas calientes', 'Postres', 'Pasteles',
          'Repostería', 'Pan', 'Otros'
        )
      );
  end if;
end;
$$;

-- No permitir altas de nombres nuevos ni renombrar las siete categorias.
-- Las filas legacy inactivas se conservan y no se pueden reactivar.
create or replace function public.enforce_fixed_kiosk_categories()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  fixed_name boolean;
begin
  fixed_name := new.name in (
    'Bebidas frías', 'Bebidas calientes', 'Postres', 'Pasteles',
    'Repostería', 'Pan', 'Otros'
  );

  if tg_op = 'INSERT' then
    if not fixed_name or not new.active then
      raise exception 'Solo se permiten las siete categorias activas del catalogo fijo.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.name in (
    'Bebidas frías', 'Bebidas calientes', 'Postres', 'Pasteles',
    'Repostería', 'Pan', 'Otros'
  ) and (
    new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.display_order is distinct from old.display_order
    or new.active is distinct from old.active
  ) then
    raise exception 'Las categorias del catalogo fijo no se pueden editar ni desactivar.'
      using errcode = '23514';
  end if;

  if not fixed_name and new.active then
    raise exception 'No se pueden activar categorias fuera del catalogo fijo.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists categories_fixed_kiosk_catalog on public.categories;
create trigger categories_fixed_kiosk_catalog
  before insert or update of name, description, display_order, active on public.categories
  for each row execute function public.enforce_fixed_kiosk_categories();

-- Productos de demostracion: sin imagen y con stock de producto terminado.
-- Los UUID se generan en la base. El conflicto por nombre/categoria hace que
-- volver a ejecutar el archivo actualice solo estas filas de prueba.
with sample_products(category_name, name, description, price, stock) as (
  values
    ('Bebidas frías', 'Prueba · Limonada natural', 'Limonada preparada al momento.', 2.50::numeric, 40::numeric),
    ('Bebidas frías', 'Prueba · Té frío de durazno', 'Té frío con durazno.', 2.75::numeric, 40::numeric),
    ('Bebidas calientes', 'Prueba · Café americano', 'Café filtrado de la casa.', 2.00::numeric, 40::numeric),
    ('Bebidas calientes', 'Prueba · Chocolate caliente', 'Chocolate caliente preparado al momento.', 3.00::numeric, 40::numeric),
    ('Postres', 'Prueba · Flan de vainilla', 'Flan individual de vainilla.', 2.50::numeric, 25::numeric),
    ('Postres', 'Prueba · Mousse de chocolate', 'Mousse individual de chocolate.', 3.25::numeric, 25::numeric),
    ('Pasteles', 'Prueba · Porción de tres leches', 'Porción individual de pastel tres leches.', 3.75::numeric, 20::numeric),
    ('Pasteles', 'Prueba · Porción de cheesecake', 'Porción individual de cheesecake.', 4.00::numeric, 20::numeric),
    ('Repostería', 'Prueba · Croissant', 'Croissant de mantequilla.', 2.25::numeric, 30::numeric),
    ('Repostería', 'Prueba · Galleta de avena', 'Galleta horneada de avena.', 1.50::numeric, 30::numeric),
    ('Pan', 'Prueba · Pan de ajo', 'Pieza individual de pan de ajo.', 1.75::numeric, 30::numeric),
    ('Pan', 'Prueba · Panini de queso', 'Panini de queso preparado al momento.', 4.50::numeric, 15::numeric),
    ('Otros', 'Prueba · Agua embotellada', 'Agua embotellada.', 1.25::numeric, 40::numeric),
    ('Otros', 'Prueba · Jugo de naranja', 'Jugo de naranja individual.', 2.50::numeric, 30::numeric)
)
insert into public.products (
  category_id, name, description, price, stock, image_url, active
)
select
  c.id, s.name, s.description, s.price, s.stock, null, true
from sample_products s
join public.categories c on c.name = s.category_name
on conflict (name, category_id) do update
set description = excluded.description,
    price = excluded.price,
    stock = excluded.stock,
    image_url = null,
    active = true,
    updated_at = now();

commit;

-- Consulta de verificacion (no expone inventario al menu publico):
-- select name, display_order, active
-- from public.categories order by display_order, name;
-- select c.name as categoria, p.name, p.price, p.image_url
-- from public.products p join public.categories c on c.id = p.category_id
-- where p.name like 'Prueba · %' order by c.display_order, p.name;
