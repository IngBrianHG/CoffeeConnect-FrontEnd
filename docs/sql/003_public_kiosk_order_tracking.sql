-- PROPUESTA INCREMENTAL — NO APLICAR EN SUPABASE SIN APROBACIÓN.
-- Permite al kiosco consultar únicamente la orden anónima creada con su propia
-- clave UUID de idempotencia. La clave funciona como credencial bearer: no
-- compartirla ni registrarla fuera del navegador de desarrollo.
--
-- No expone órdenes creadas por personal/POS (created_by IS NOT NULL), consultas
-- por mesa/sesión, notas, precios, datos del operador ni acceso REST a las tablas.
-- El acceso de seguimiento expira 24 horas después de crear la orden.

create or replace function public.get_public_kiosk_order_status(p_idempotency_key uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'order_id', o.id,
    'status', o.status,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_name', oi.product_name_snapshot,
          'quantity', oi.quantity
        )
        order by oi.created_at, oi.id
      )
      from public.order_items oi
      where oi.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where p_idempotency_key is not null
    and o.idempotency_key = p_idempotency_key
    and o.created_by is null
    and o.created_at >= now() - interval '24 hours';
$$;

revoke all on function public.get_public_kiosk_order_status(uuid) from public, anon, authenticated;
grant execute on function public.get_public_kiosk_order_status(uuid) to anon, authenticated;

comment on function public.get_public_kiosk_order_status(uuid) is
  'Devuelve estado y productos de una sola orden anónima, autorizada por su clave idempotente, con expiración de 24 horas.';
