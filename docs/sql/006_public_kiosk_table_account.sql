-- PROPUESTA INCREMENTAL — NO APLICAR EN SUPABASE SIN APROBACIÓN.
-- Permite consultar solo la cuenta de la sesión ABIERTA de una mesa activa
-- identificada por su QR. No expone sesiones cerradas, claves idempotentes,
-- datos del operador, pagos ni acceso REST directo a las tablas.
--
-- Cualquier persona con el QR puede ver los pedidos vigentes de esa mesa,
-- incluidos pedidos creados desde otros dispositivos o por el personal.
-- Los comentarios por producto se incluyen porque forman parte del detalle
-- solicitado para la cuenta compartida de la mesa.

create or replace function public.get_public_kiosk_table_account(p_table_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'table_id', t.id,
    'table_name', t.name,
    'table_session_id', s.id,
    'opened_at', s.opened_at,
    'orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'table_id', o.table_id,
          'table_session_id', o.table_session_id,
          'status', o.status,
          'subtotal', o.subtotal,
          'discount_total', o.discount_total,
          'total', o.total,
          'created_at', o.created_at,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', oi.id,
                'product_name', oi.product_name_snapshot,
                'quantity', oi.quantity,
                'unit_price', oi.unit_price,
                'discount_amount', oi.discount_amount,
                'subtotal', oi.subtotal,
                'promotion_name', oi.promotion_name,
                'notes', oi.notes
              )
              order by oi.created_at, oi.id
            )
            from public.order_items oi
            where oi.order_id = o.id
          ), '[]'::jsonb)
        )
        order by o.created_at desc, o.id desc
      )
      from public.orders o
      where o.table_id = t.id
        and o.table_session_id = s.id
    ), '[]'::jsonb)
  )
  from public.cafe_tables t
  join public.table_sessions s on s.table_id = t.id and s.status = 'open'
  where p_table_id is not null
    and t.id = p_table_id
    and t.active;
$$;

revoke all on function public.get_public_kiosk_table_account(uuid) from public, anon, authenticated;
grant execute on function public.get_public_kiosk_table_account(uuid) to anon;

comment on function public.get_public_kiosk_table_account(uuid) is
  'Devuelve pedidos, totales y comentarios por producto de la sesión abierta de una mesa activa identificada por QR. No expone pagos, operador ni claves idempotentes.';
