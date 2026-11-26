# Arquitectura de datos y contrato API

## Topología destino

```text
React + TypeScript
  └─ services/repositorios por dominio
       └─ adaptador HTTP propio (fetch nativo)
            ├─ Supabase Auth
            └─ REST PostgREST (/rest/v1) + RPC (/rest/v1/rpc/...)
                  └─ PostgreSQL + RLS + constraints + funciones transaccionales
```

Para este tamaño y el plazo corto, no se requiere desplegar otro servidor Express para el CRUD ordinario. Supabase expone PostgreSQL mediante REST. No se instalará un SDK/ORM: el transporte compartido usa `fetch` nativo. React no debe usar SQL ni acoplar componentes a llamadas PostgREST directas: usar `authService`, `catalogService`, `inventoryService`, `ordersService`, `tablesService` y `paymentsService`.

Las llamadas de una sola lectura/escritura pueden usar REST bajo RLS. Un flujo que necesita consistencia entre varias tablas debe ser una función PostgreSQL llamada por REST RPC. Es la frontera de negocio con el servidor y, si más adelante se cambia de proveedor, los componentes conservan las mismas interfaces de servicio.

## Unidades y catálogos cerrados

El esquema usa enum `inventory_unit` con unidades base:

| Código | Uso | Presentación opcional en UI |
|---|---|---|
| `g` | sólidos/ingredientes pesados | kg se convierte a g antes de guardar |
| `ml` | líquidos | L se convierte a ml antes de guardar |
| `unit` | piezas/paquetes indivisibles | unidad |

Esta selección intencional evita sumar por error 1 taza y 240 ml como si fueran cantidades equivalentes sin conocer la densidad o el tamaño de porción. Ingrediente, receta, movimiento y ajuste siempre usan la misma unidad base; la UI puede ofrecer “taza”, “cucharada” o “sobre” como ayuda de captura, pero debe convertirlos a la unidad base conocida/configurada antes de persistir. Si cada receta necesita medidas domésticas reales, agregar una tabla de conversiones por ingrediente (no una conversión universal).

Catálogos PostgreSQL compartidos con TypeScript:

- `app_role`: `admin`, `cashier`, `waiter`.
- `table_status`: `available`, `assigned`, `occupied`, `unavailable`.
- `session_status`: `open`, `closed`, `cancelled`.
- `order_status`: `pending`, `confirmed`, `preparing`, `ready`, `served`, `cancelled`.
- `payment_status`: `unpaid`, `partial`, `paid`.
- `payment_method`: `cash`, `card`, `transfer`, `other`.
- `inventory_adjustment_type`: `opening_balance`, `purchase`, `expiration`, `spill`, `damage`, `count_correction`, `return_to_stock`, `manual_adjustment`, `order_consumption`, `order_reversal`.
- `promotion_type`: `nxm`, `percent`; `promotion_scope`: `product`, `category`, `all_menu`.

No mantener una segunda lista independiente de strings en React. Generar tipos TypeScript desde el esquema con Supabase CLI o derivarlos de enums versionados y validar en CI que coincidan.

## Modelo de datos

| Tabla | Propósito / relaciones |
|---|---|
| `profiles` | Extiende `auth.users`; rol, nombre y estado activo. El registro público no asigna roles administrativos. |
| `categories`, `products` | Menú, precio, categoría; stock de producto solo si no tiene receta. |
| `ingredients`, `product_ingredients` | Existencia con unidad cerrada y receta por porción. |
| `cafe_tables`, `table_sessions` | Mesa física y visita abierta; máximo una sesión abierta por mesa. |
| `orders`, `order_items` | Estados de preparación, totales y snapshots de producto/precio/notas. |
| `order_item_recipe_lines` | Copia de receta al crear el pedido, estable ante futuras ediciones de receta. |
| `inventory_movements` | Libro append-only de entradas, mermas, consumo y reversas por producto o ingrediente. |
| `payments`, `payment_allocations` | Uno o más pagos por sesión y asignación por línea para cuenta dividida. |
| `promotions` | Reglas NxM/porcentaje y su ámbito; cada línea conserva nombre/descuento histórico. |

El script completo está en `docs/sql/001_supabase_schema.sql`. Usa UUID desde el inicio. No se debe aplicar como “migración” sobre MySQL ni importarlo encima de datos reales.

`table_sessions` representa cada visita a una mesa y evita mezclar pedidos/pagos entre turnos. Los montos usan `numeric(12,2)` sin columna de moneda; la versión inicial asume una sola moneda para el café (confirmarla antes de importar). Agregar `currency_code` y reglas de conversión antes del primer cobro si se requiere multi-moneda.

## Contratos REST/RPC clave

- `GET /rest/v1/categories?active=eq.true`
- `GET /rest/v1/public_menu` — proyección pública de productos activos; no expone existencias reales.
- `POST /rest/v1/rpc/get_public_table` — `{ p_table_id }`; entrega al QR únicamente UUID y nombre de su mesa.
- `POST /rest/v1/rpc/open_table_session` — `{ p_table_id, p_idempotency_key }`; personal abre la sesión antes de aceptar pedidos.
- `POST /rest/v1/rpc/create_public_order` — `{ p_table_id, p_items: [{product_id, quantity, notes}], p_idempotency_key }`; devuelve el UUID. Precio y receta se leen en la base. El pedido empieza `pending`; no consume inventario.
- `POST /rest/v1/rpc/confirm_order` — `{ p_order_id }`; solo personal. Bloquea stock, valida todos los insumos, registra movimientos y cambia a `confirmed` de forma atómica.
- `POST /rest/v1/rpc/advance_order` — `{ p_order_id, p_next_status }`; solo transiciones `confirmed→preparing→ready→served`.
- `POST /rest/v1/rpc/cancel_order` — `{ p_order_id, p_reason }`; solo permite cancelar pendientes/confirmados antes de preparación y registra reversas exactas.
- `POST /rest/v1/rpc/replace_product_recipe` — `{ p_product_id, p_lines: [{ingredient_id, quantity_per_portion}] }`; sustitución atómica, solo admin; lista vacía elimina la receta.
- `POST /rest/v1/rpc/adjust_ingredient_stock` — `{ p_ingredient_id, p_delta, p_type, p_idempotency_key, p_reason }`; delta positivo repone, negativo registra merma; no permite stock negativo.
- `POST /rest/v1/rpc/adjust_product_stock` — `{ p_product_id, p_delta, p_type, p_idempotency_key, p_reason }`; solo para productos sin receta.
- `POST /rest/v1/rpc/record_session_payment` — `{ p_table_session_id, p_method, p_allocations: [{order_item_id, amount}], p_idempotency_key, p_payer_label, p_reference }`; asigna importe a líneas servidas, permite varias llamadas/métodos y no sobrepaga.
- `POST /rest/v1/rpc/close_empty_table_session` — `{ p_table_session_id }`; libera una mesa sin saldo ni órdenes activas.

Enviar una clave UUID de idempotencia estable al abrir sesión, crear pedido, ajustar existencias y registrar pagos; reutilizarla en reintentos de esa misma operación y generar otra para la siguiente. Los RPC de estado son transiciones con control de estado: ante un timeout, consultar el registro antes de intentar una transición posterior. Las funciones de caja requieren Auth y rol admin/cashier. Las funciones de inventario y estado validan roles en PostgreSQL, no en el router de React.

## Reglas de seguridad

1. Activar RLS en toda tabla del esquema expuesto; el SQL ya establece políticas de lectura pública de menú/promociones y lectura de negocio solo para personal.
2. Solo `anon` y `authenticated` publicables en el navegador; la clave `service_role` elude RLS y nunca debe compilarse en Vite.
3. Mantener desactivado el signup público. El alta de personal se realiza mediante `staff-users`, que crea Auth y `profiles` con el rol solicitado tras validar al administrador. No confiar en `user_metadata.role`.
4. Escritura directa de pedidos/pagos/movimientos no está permitida por políticas: usar las RPC de negocio. El acceso RLS no sustituye límites de frecuencia del endpoint público.
5. Antes de producción, revisar políticas desde SQL Editor y probar con sesiones reales `anon`, waiter, cashier y admin, incluidas consultas y RPC negativas.
6. El RPC público de kiosco es accesible con UUID de mesa y puede ser abusado desde fuera. Para lanzamiento abierto, añadir rate limit/WAF o una Edge Function delante, limitar número/tamaño de líneas y alertar volumen anómalo.
7. Productos/ingredientes nuevos inician con stock 0; no se permite enviar stock en INSERT/UPDATE REST. El saldo inicial se registra como `opening_balance` vía RPC para que cuadre el libro de movimientos.

## Promociones: decisión explícita

Se conserva el catálogo, ámbito, validaciones, descuentos y snapshots de líneas del sistema original. La RPC inicial de creación no calcula aún NxM ni porcentaje; aplica el precio de catálogo sin descuento. Antes de activar promociones o hacer el corte, portar y probar `backend/utils/promotions.js` como cálculo autoritativo en PostgreSQL/RPC o Edge Function. La vista previa de React nunca puede determinar el total cobrado.
