-- Coffee Connect — reporting RPC (propuesta incremental; no ejecutar automáticamente).
-- Requiere el esquema Supabase de docs/sql/001_supabase_schema.sql.
-- Provee órdenes del período, importes cobrados/pendientes por orden,
-- ventas por fecha de creación y cobros por fecha del pago.
-- No es un corte de caja: el esquema aún no modela turnos ni entradas/retiros de efectivo.

create or replace function public.get_sales_report(
  p_date_from date,
  p_date_to date,
  p_timezone text default 'America/El_Salvador',
  p_table_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active
      and p.role in ('admin', 'cashier')
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if p_date_from is null or p_date_to is null or p_date_from > p_date_to
    or p_date_to - p_date_from > 365
    or p_timezone is null
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception using errcode = '22023', message = 'INVALID_REPORT_FILTER';
  end if;

  with
  daily_orders as (
    select o.id, o.table_session_id, o.table_id, t.name as table_name,
      o.created_at, o.status, o.payment_status, o.total
    from public.orders o
    join public.cafe_tables t on t.id = o.table_id
    where (p_table_id is null or o.table_id = p_table_id)
      and o.created_at >= (p_date_from::timestamp at time zone p_timezone)
      and o.created_at < ((p_date_to + 1)::timestamp at time zone p_timezone)
  ),
  paid_by_order as (
    select o.id as order_id, sum(pa.amount)::numeric(14,2) as charged_total
    from daily_orders o
    join public.order_items oi on oi.order_id = o.id
    join public.payment_allocations pa on pa.order_item_id = oi.id
    join public.payments pay
      on pay.id = pa.payment_id and pay.table_session_id = o.table_session_id
    group by o.id
  ),
  order_rows as (
    select o.id, o.table_id, o.table_name, o.created_at, o.status, o.payment_status,
      o.total::numeric(14,2) as total,
      coalesce(p.charged_total, 0)::numeric(14,2) as charged_total,
      case when o.status = 'served'
        then (o.total - coalesce(p.charged_total, 0))::numeric(14,2)
        else 0::numeric(14,2)
      end as pending_total
    from daily_orders o
    left join paid_by_order p on p.order_id = o.id
  ),
  eligible_orders as (
    select o.id, o.table_session_id, o.table_id, o.created_at
    from public.orders o
    where o.status = 'served'
      and (p_table_id is null or o.table_id = p_table_id)
      and o.created_at >= (p_date_from::timestamp at time zone p_timezone)
      and o.created_at < ((p_date_to + 1)::timestamp at time zone p_timezone)
  ),
  sales_by_day as (
    select (eo.created_at at time zone p_timezone)::date as day,
      count(distinct eo.id)::integer as order_count,
      coalesce(sum(oi.unit_price * oi.quantity), 0)::numeric(14,2) as gross_sales,
      coalesce(sum(oi.discount_amount), 0)::numeric(14,2) as discount_total,
      coalesce(sum(oi.subtotal), 0)::numeric(14,2) as sales_total
    from eligible_orders eo
    join public.order_items oi on oi.order_id = eo.id
    group by 1
  ),
  sales_by_table as (
    select eo.table_id, t.name as table_name,
      count(distinct eo.id)::integer as order_count,
      coalesce(sum(oi.unit_price * oi.quantity), 0)::numeric(14,2) as gross_sales,
      coalesce(sum(oi.discount_amount), 0)::numeric(14,2) as discount_total,
      coalesce(sum(oi.subtotal), 0)::numeric(14,2) as sales_total
    from eligible_orders eo
    join public.cafe_tables t on t.id = eo.table_id
    join public.order_items oi on oi.order_id = eo.id
    group by eo.table_id, t.name
  ),
  payments_in_range as (
    select pay.id, pay.table_session_id, pay.method, pay.amount, pay.created_at
    from public.payments pay
    join public.table_sessions ts on ts.id = pay.table_session_id
    where (p_table_id is null or ts.table_id = p_table_id)
      and pay.created_at >= (p_date_from::timestamp at time zone p_timezone)
      and pay.created_at < ((p_date_to + 1)::timestamp at time zone p_timezone)
  ),
  payments_by_method as (
    select method, count(*)::integer as payment_count,
      coalesce(sum(amount), 0)::numeric(14,2) as amount
    from payments_in_range
    group by method
  ),
  collections_by_day as (
    select (created_at at time zone p_timezone)::date as day,
      count(*)::integer as payment_count,
      coalesce(sum(amount), 0)::numeric(14,2) as collected_total
    from payments_in_range
    group by 1
  ),
  product_sales as (
    select oi.product_name_snapshot as product_name,
      sum(oi.quantity)::integer as quantity,
      coalesce(sum(oi.unit_price * oi.quantity), 0)::numeric(14,2) as gross_sales,
      coalesce(sum(oi.discount_amount), 0)::numeric(14,2) as discount_total,
      coalesce(sum(oi.subtotal), 0)::numeric(14,2) as sales_total
    from eligible_orders eo
    join public.order_items oi on oi.order_id = eo.id
    group by oi.product_name_snapshot
  )
  select jsonb_build_object(
    'date_from', p_date_from,
    'date_to', p_date_to,
    'timezone', p_timezone,
    'table_id', p_table_id,
    'orders_summary', jsonb_build_object(
      'order_count', (select count(*)::integer from order_rows),
      'charged_total', coalesce((select sum(charged_total) from order_rows where status = 'served'), 0)::numeric(14,2),
      'pending_total', coalesce((select sum(pending_total) from order_rows where status = 'served'), 0)::numeric(14,2)
    ),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
      'order_id', id, 'table_id', table_id, 'table_name', table_name,
      'created_at', created_at, 'status', status, 'payment_status', payment_status,
      'total', total, 'charged_total', charged_total, 'pending_total', pending_total
    ) order by created_at desc, id) from order_rows), '[]'::jsonb),
    'sales', jsonb_build_object(
      'order_count', coalesce((select sum(order_count)::integer from sales_by_day), 0),
      'items_count', coalesce((select sum(oi.quantity)::integer
        from eligible_orders eo join public.order_items oi on oi.order_id = eo.id), 0),
      'gross_total', coalesce((select sum(gross_sales) from sales_by_day), 0)::numeric(14,2),
      'discount_total', coalesce((select sum(discount_total) from sales_by_day), 0)::numeric(14,2),
      'total', coalesce((select sum(sales_total) from sales_by_day), 0)::numeric(14,2)
    ),
    'collections', jsonb_build_object(
      'payment_count', (select count(*)::integer from payments_in_range),
      'total', coalesce((select sum(amount) from payments_in_range), 0)::numeric(14,2)
    ),
    'sales_by_day', coalesce((select jsonb_agg(jsonb_build_object(
      'date', day, 'orders', order_count, 'gross_total', gross_sales,
      'discount_total', discount_total, 'sales_total', sales_total
    ) order by day) from sales_by_day), '[]'::jsonb),
    'collections_by_day', coalesce((select jsonb_agg(jsonb_build_object(
      'date', day, 'payments', payment_count, 'collected_total', collected_total
    ) order by day) from collections_by_day), '[]'::jsonb),
    'sales_by_table', coalesce((select jsonb_agg(jsonb_build_object(
      'table_id', table_id, 'table_name', table_name, 'orders', order_count,
      'gross_total', gross_sales, 'discount_total', discount_total, 'sales_total', sales_total
    ) order by sales_total desc, table_name) from sales_by_table), '[]'::jsonb),
    'collections_by_method', coalesce((select jsonb_agg(jsonb_build_object(
      'method', method, 'payments', payment_count, 'collected_total', amount
    ) order by method) from payments_by_method), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
      'product_name', product_name, 'quantity', quantity, 'gross_total', gross_sales,
      'discount_total', discount_total, 'sales_total', sales_total
    ) order by sales_total desc, product_name) from product_sales), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_sales_report(date, date, text, uuid) from public, anon;
grant execute on function public.get_sales_report(date, date, text, uuid) to authenticated;

comment on function public.get_sales_report(date, date, text, uuid) is
  'Reporte de órdenes del período, ventas servidas por created_at local y cobros por fecha de pago. No representa corte de turno.';
