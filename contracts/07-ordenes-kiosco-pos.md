# Contrato 07 — Órdenes kiosco/POS

**Etapa:** 4.5 del plan de migración.  
**Estado:** propuesto; basado en las RPC, tablas y políticas del esquema SQL local. Validar en staging antes de cerrar la etapa.  
**Objetivo:** migrar la creación y gestión de órdenes del kiosco/POS a Supabase, vinculándolas a una sesión abierta de mesa y preservando UUID, idempotencia, snapshots de precio e inventario transaccional.

## Alcance y límites

- Usar UUID de mesa, sesión, orden, producto y línea. No reutilizar identificadores numéricos del flujo Express.
- Componentes consumen servicios de dominio; no construyen URLs PostgREST ni RPC.
- Mantener `fetch`/`HttpClient`, publishable key y JWT del personal autenticado. Nunca exponer `service_role`.
- Crear órdenes únicamente con `create_public_order`; no insertar directamente en `orders`, `order_items` ni snapshots.
- Confirmar, avanzar o cancelar órdenes únicamente mediante las RPC de personal. No actualizar `status`, inventario o movimientos directamente por REST.
- Para pedidos POS para llevar se usará una mesa operativa real llamada **Para llevar**. No se crearán órdenes sin mesa ni se alterarán las columnas obligatorias del modelo actual.
- El kiosco puede crear una orden como `anon`; anon no puede leer órdenes directamente ni consultar sesiones cerradas o arbitrarias. La única lectura compartida propuesta es una RPC limitada a los pedidos de la sesión actualmente abierta de una mesa activa; requiere aprobación y migración.
- Los pagos, asignaciones y cierre de sesión se especifican en el contrato 08; este contrato define el ciclo de vida operativo de la orden.
- El total, precio unitario, nombre snapshot, stock y estado de pago son autoridad del servidor. Nunca enviar total o descuento calculado por el navegador como instrucción de escritura.
- La RPC local no aplica promociones: `discount_total` y `discount_amount` quedan en cero. No presentar descuentos como aplicados ni habilitar promociones en checkout hasta que una RPC versionada las calcule.

## Autoridad y permisos

RLS, grants, restricciones e invariantes RPC son la autoridad; la UI por sí sola no controla acceso.

| Operación | admin | cashier | waiter | anon |
|---|---:|---:|---:|---:|
| Crear orden en sesión abierta | Sí | Sí | Sí | Sí |
| Leer lista y detalle de órdenes | Sí | Sí | Sí | No |
| Consultar cuenta de la sesión abierta de una mesa activa | No aplica | No aplica | No aplica | Sí, solo mediante RPC restringida propuesta |
| Confirmar orden y consumir inventario | Sí | Sí | Sí | No |
| Avanzar preparación/entrega | Sí | Sí | Sí | No |
| Cancelar si la transición lo permite | Sí | Sí | Sí | No |
| Consultar resumen de su propia orden kiosco con clave privada | No aplica | No aplica | No aplica | Sí, mediante RPC propuesta |

Las funciones de personal verifican un perfil activo y uno de los roles permitidos. No existe escritura REST directa en las tablas de órdenes. El `created_by` de una orden pública puede ser `null`.

## Pedido POS para llevar usando una mesa operativa

El modelo actual exige que cada orden pertenezca a una mesa y una sesión. Para cubrir el flujo POS sin cambiar ese modelo:

1. La instalación ya cuenta con una fila de `cafe_tables` con nombre visible exactamente `PARA LLEVAR`; no crear otra fila desde frontend.
2. El POS carga las mesas activas del servidor y resuelve esa fila por nombre normalizado solo para mostrarla como opción especial. Para crear la orden envía el UUID que devolvió el servidor; nunca envía el nombre como identificador.
3. El POS ofrece el tipo de atención `En mesa` / `Para llevar`. Para llevar selecciona la fila existente, sin pedir al cajero que elija una mesa física.
4. Antes de crear una orden, el POS resuelve o abre una sesión en esa mesa virtual. La sesión sigue las mismas reglas e RPC de apertura/cierre que una mesa normal.
5. Cada carrito enviado crea una orden independiente. Varias órdenes para llevar pueden quedar en la misma sesión abierta y se pueden pagar por las asignaciones a sus líneas, según el contrato 08.

La mesa `Para llevar` es una **cuenta operativa compartida**, no una identidad de cliente. La UI no debe presentarla como si identificara al comprador. Al cerrarse una sesión, la siguiente venta para llevar abre una nueva sesión. No abrir una sesión duplicada ante una carrera: si `open_table_session` responde `TABLE_ALREADY_OPEN`, recargar sesiones y reutilizar la sesión abierta. El UUID faltante, inactivo o inválido debe bloquear el envío con un error de configuración accionable; no usar una mesa física como fallback.

**Riesgo de agrupación:** los pedidos de varios compradores pueden coincidir en una sesión virtual. Cada orden sigue siendo independiente y el pago se asigna a sus líneas; no ofrecer un botón que cobre órdenes ajenas sin que el cajero pueda revisar/seleccionar las órdenes incluidas. Si el negocio requiere una cuenta aislada por comprador, se necesita una decisión de backend distinta (sesión por venta o entidad de venta para llevar); no se debe simular esa separación con notas o nombre de mesa.

## Modelos de dominio

```ts
export type OrderStatus =
  | 'pending' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface CafeOrder {
  id: string;
  tableSessionId: string;
  tableId: string;
  createdBy: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  discountTotal: number;
  total: number;
  notes: string | null;
  createdAt: string;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface CafeOrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  subtotal: number;
  promotionName: string | null;
  notes: string | null;
  usesRecipe: boolean;
}

export interface CreateOrderLine {
  productId: string;
  quantity: number;
  notes?: string | null;
}
```

Los UUID deben validarse y conservarse como strings. Los parsers rechazan enum desconocido, boolean, numeric, timestamp, nullable o relación orden/línea malformados. No convertir datos inválidos en cero ni ocultar errores como listas vacías. Debe cumplirse `total = subtotal - discountTotal`; para la RPC actual de creación, el descuento es cero. Cada línea debe pertenecer a una orden cargada y una orden debe referir a una sesión/mesa coherente cuando se soliciten esos recursos.

## Crear orden (kiosco/POS)

```http
POST /rest/v1/rpc/create_public_order
Content-Type: application/json
apikey: <publishable-key>
Authorization: Bearer <JWT del personal, omitido para anon>
```

```json
{
  "p_table_id": "<table-uuid>",
  "p_items": [
    { "product_id": "<product-uuid>", "quantity": 2, "notes": "Sin azúcar" }
  ],
  "p_idempotency_key": "<uuid>"
}
```

La función devuelve un UUID de orden como string. El request no incluye `table_session_id`: el servidor determina la sesión abierta para `p_table_id`.

Invariantes del esquema local:

- Requiere clave UUID, entre 1 y 50 líneas, cantidad entera de 1 a 99 y notas de hasta 200 caracteres (recortadas por servidor).
- Rechaza si no existe sesión abierta (`NO_OPEN_TABLE_SESSION`).
- `open_table_session` solo abre mesas activas. Sin embargo, por la brecha de desactivación descrita en el contrato 06, el SQL actual no vuelve a comprobar `active` al crear la orden. Cerrar esa brecha es requisito antes de producción.
- Rechaza producto/categoría inactivos o producto cuya receta contenga ingrediente inactivo.
- Captura precio y nombre de producto en la línea snapshot. La creación deja la orden `pending` y no descuenta stock.
- La idempotencia serializa solicitudes concurrentes por clave y devuelve la orden previa si la clave ya existe para la misma mesa.

### Disponibilidad de stock en POS y kiosco

La disponibilidad de la UI es una comprobación previa, no una reserva: una venta concurrente puede consumir existencias antes de confirmar. `confirm_order` sigue siendo la autoridad final y debe validar toda la orden de forma transaccional.

- El POS consulta disponibilidad autenticado antes de permitir agregar o aumentar una línea. La cantidad solicitada debe compararse con la disponibilidad considerando también la cantidad de ese producto que ya está en el carrito.
- Para productos sin receta se usa `products.stock`; para productos con receta, la disponibilidad es el mínimo entero de las existencias de ingredientes dividido por el consumo de receta por porción. La cantidad vendible no puede ser negativa ni exceder 99.
- El esquema base no ofrece hoy una RPC de disponibilidad calculada para recetas. Antes de habilitar esta UX, agregar una RPC de lectura de disponibilidad para personal (preferiblemente por lote de UUID), con validación de perfil/rol y respuesta estricta. No exponer existencias reales desde `public_menu` ni convertir una respuesta incompleta en stock cero.
- El servidor también debe validar disponibilidad al crear una orden y rechazarla sin dejar filas si ya no alcanza el stock. La creación no descuenta ni reserva; `confirm_order` vuelve a validar al aceptar/preparar.
- Para el kiosco público no revelar cantidades reales de inventario. El kiosco no realiza el pre-chequeo de existencias de POS; debe conservar el carrito y mostrar el error seguro que devuelva la API. El personal recibe el resultado definitivo al confirmar.
- La tarjeta, acción de agregar, botón de aumentar y cantidad del carrito reflejan `agotado`/`disponibilidad insuficiente`; revalidar al recuperar el foco/actualizar catálogo y antes de enviar. Una respuesta vieja nunca habilita una cantidad superior a la última disponibilidad conocida.

Si la disponibilidad falla por red, datos inválidos o permiso, no tratarla como cero ni como ilimitada: deshabilitar agregar/enviar hasta reintentar y conservar el carrito.

Propuesta de interfaz para la nueva RPC de personal:

```http
POST /rest/v1/rpc/get_orderable_products_availability
{ "p_product_ids": ["<product-uuid>", "<product-uuid>"] }
```

Respuesta JSON propuesta:

```json
{
  "items": [
    {
      "product_id": "<product-uuid>",
      "available_quantity": 4,
      "orderable": true,
      "uses_recipe": false
    }
  ]
}
```

La RPC valida perfil activo y rol permitido, acepta una lista acotada sin UUID repetidos y devuelve exactamente un elemento por producto solicitado. Producto/categoría inactivos o receta con ingrediente inactivo devuelven `orderable: false` y cantidad cero; error de RPC/permisos no se transforma en esa respuesta. El cálculo se hace dentro de la base y no crea reserva. La migración local propuesta `docs/sql/004_order_stock_validation.sql` implementa esta función y extiende `create_public_order`; debe revisarse y aplicarse a staging antes de que el flujo pueda usarlas. No se debe alterar Supabase remoto desde el frontend.

### Idempotencia: brecha del SQL local

El SQL actual no compara el contenido de líneas cuando se reutiliza la misma clave para la misma mesa: podría devolver una orden creada con un carrito distinto. Antes de producción, una migración versionada debe guardar/comparar una huella del payload normalizado (incluyendo mesa, líneas, cantidades y notas) y responder `IDEMPOTENCY_KEY_REUSED` si difiere. No reutilizar una clave para una intención nueva.

El cliente crea una clave nueva por cada envío lógico del carrito, la conserva mientras el resultado sea ambiguo y reintenta solo con la misma clave y payload normalizado idéntico. No generar una clave nueva automáticamente tras timeout, desconexión o 5xx; ofrecer reintento explícito o consulta/recuperación una vez disponible un endpoint idempotente para resolver el resultado.

## Seguimiento privado de una orden del kiosco (migración propuesta)

El QR identifica una mesa, no a un cliente. Esta RPC privada no permite consultar órdenes por `table_id` o `table_session_id`; devuelve únicamente la orden cuyo navegador conserva la clave privada. La lectura compartida de la cuenta activa, con un alcance y payload separados, se describe en la siguiente propuesta.

```http
POST /rest/v1/rpc/get_public_kiosk_order_status
{ "p_idempotency_key": "<misma-clave-privada-del-envío-kiosco>" }
```

La propuesta `docs/sql/003_public_kiosk_order_tracking.sql` devuelve solo UUID de orden, estado, fecha y producto/cantidad; no devuelve mesa, sesión, cliente, operador, notas, importes ni pagos. La RPC solo encuentra órdenes `created_by is null` (kiosco público) y expira el acceso 24 horas después. La clave UUID funciona como credencial bearer: mantenerla en `sessionStorage`, no ponerla en URL ni logs y no enviarla a terceros.

Esta RPC no existe en el esquema base `001_supabase_schema.sql`; la migración es un cambio de backend pendiente de aprobación y despliegue. Hasta aplicarla, el kiosco puede confirmar la creación usando la respuesta de `create_public_order`, pero no puede refrescar el estado actual tras cambios hechos por el personal.

## Cuenta compartida de la sesión activa (migración propuesta)

La vista pública **Ver mi cuenta** puede mostrar los pedidos de la sesión abierta de la mesa actual, aunque se hayan enviado desde distintos dispositivos o desde el POS. No se concede `SELECT` anónimo sobre `orders`, `order_items` ni `table_sessions`; la lectura se limita a la RPC propuesta `get_public_kiosk_table_account(p_table_id)`.

La RPC recibe solo el UUID del QR y devuelve datos únicamente si la mesa está activa y tiene una sesión `open`. Devuelve todos los pedidos asociados a esa sesión, con fecha, estado, totales y líneas con nombre snapshot, cantidad, precio, descuento, subtotal y comentario del producto. Incluye cancelados para contexto; la interfaz los muestra, pero los excluye del total de pedidos. El resumen no representa saldo pendiente ni divulga pagos, personal, claves idempotentes o sesiones cerradas. No tener sesión abierta devuelve `null`. El permiso de ejecución se concede solo a `anon`; personal conserva su lectura existente por RLS.

El QR de mesa es compartido: cualquier persona que lo tenga podrá ver los pedidos y comentarios por producto de la sesión activa, incluidos los de otros clientes de esa misma mesa. La propuesta `docs/sql/006_public_kiosk_table_account.sql` concede únicamente la ejecución de esta función a `anon`; debe revisarse, aprobarse y aplicarse en staging antes de habilitar la función en producción. La UI consulta de nuevo cada 10 segundos y muestra errores de servicio explícitos; no sustituye una respuesta ausente por una cuenta vacía.

## Listar y consultar órdenes (personal)

Solo personal autenticado puede leer directamente `orders`, `order_items` y snapshots mediante REST. RLS incluye `admin`, `cashier` y `waiter`; anon carece de lectura directa y no puede consultar listas o detalles arbitrarios. La RPC de cuenta anterior es la excepción acotada para la sesión abierta del QR. Una consulta de lista para personal puede usar:

```http
GET /rest/v1/orders?select=id,table_session_id,table_id,created_by,status,payment_status,subtotal,discount_total,total,notes,created_at,confirmed_at,updated_at&order=created_at.desc&limit=200
```

Los detalles se consultan por las órdenes visibles, sin asumir que un listado truncado representa todo el historial:

```http
GET /rest/v1/order_items?select=id,order_id,product_id,product_name_snapshot,quantity,unit_price,discount_amount,subtotal,promotion_name,notes,uses_recipe&order_id=in.(<order-uuid>,<order-uuid>)
```

Filtrar por UUID de orden, sesión, mesa y/o estado cuando la vista lo requiera. Respetar el límite de 200 con paginación remota; no paginar localmente una respuesta parcial. Los datos de pago (`payment_status`) son solo lectura en este contrato.

## Confirmar y consumir inventario

```http
POST /rest/v1/rpc/confirm_order
{ "p_order_id": "<order-uuid>" }
```

Solo personal activo. La RPC confirma una orden `pending`, bloquea y valida stock de producto o ingredientes y, en una única transacción, descuenta stock, registra movimientos `order_consumption` y actualiza la orden a `confirmed`. Una insuficiencia aborta la transacción completa. La repetición para órdenes ya confirmadas/avanzadas devuelve el estado existente sin consumir dos veces.

Crear orden no reserva inventario. El POS/kiosco no debe mostrar una confirmación como “aceptada/en preparación” hasta que se haya confirmado por el personal. Si la confirmación del RPC funciona pero falla la recarga de datos, informar que se guardó y que hace falta actualizar; no invitar a confirmar de nuevo.

Si la confirmación falla por falta de existencias, mostrar un aviso específico —“No hay existencias suficientes para preparar este pedido; actualiza productos o ajusta cantidades”—, conservar el carrito/detalle, refrescar disponibilidad y no reintentar automáticamente la confirmación. No presentar el pedido como aceptado ni mostrar nombres técnicos, cantidades internas, SQL, headers o tokens.

## Avanzar preparación

```http
POST /rest/v1/rpc/advance_order
{ "p_order_id": "<order-uuid>", "p_next_status": "preparing" }
```

Transiciones permitidas por SQL: `confirmed → preparing → ready → served`. Repetir el mismo estado es idempotente; cualquier salto o transición incompatible responde `INVALID_ORDER_TRANSITION`. El servidor devuelve `{ "order_id": "...", "status": "..." }`.

## Cancelar orden

```http
POST /rest/v1/rpc/cancel_order
{ "p_order_id": "<order-uuid>", "p_reason": "Cancelada por solicitud del cliente" }
```

`p_reason` puede ser `null`; el servidor recorta a 250 caracteres. Solo personal activo puede cancelar. La operación es idempotente si ya está cancelada. SQL rechaza órdenes en `preparing`, `ready` o `served`, y órdenes con asignaciones de pago. Si la orden ya consumió inventario, la RPC registra movimientos reversos en la misma transacción. La UI no debe simular una devolución ni permitir cambiar el estado directamente.

## Errores y recuperación

- `401`: renovar una vez mediante la sesión existente; si falla, cerrar sesión y volver al login.
- `403`/`42501`/`FORBIDDEN`: permiso insuficiente; no perder el estado de la vista.
- `P0002`, `ORDER_NOT_FOUND`, `SESSION_NOT_FOUND`: recurso inexistente.
- `NO_OPEN_TABLE_SESSION`: la mesa no tiene una sesión abierta; explicar que el personal debe abrirla antes de aceptar pedidos.
- `TABLE_NOT_FOUND`, `TABLE_UNAVAILABLE`, `TABLE_ALREADY_OPEN`: para la mesa virtual, revisar configuración/estado o recargar la sesión; no sustituirla en silencio por otra mesa.
- `IDEMPOTENCY_KEY_REUSED`: clave usada con otro payload/mesa; no reenviar con esa clave.
- `PRODUCT_UNAVAILABLE`/`PRODUCT_RECIPE_HAS_INACTIVE_INGREDIENT`: producto no disponible; refrescar menú y permitir editar carrito.
- `INSUFFICIENT_PRODUCT_STOCK`/`INSUFFICIENT_INGREDIENT_STOCK`: informar que no hay existencias suficientes y refrescar productos, tanto en pre-chequeo como al confirmar; no mostrar texto SQL, nombres técnicos, headers ni tokens.
- `INVALID_ORDER`, `INVALID_QUANTITY`, `22P02`: datos/UUID inválidos; revisar líneas sin borrar el carrito.
- `ORDER_NOT_PENDING`, `INVALID_ORDER_TRANSITION`, `SESSION_NOT_OPEN`: estado cambió; recargar antes de ofrecer otra acción.
- `ORDER_TOO_LATE_TO_CANCEL`: ya inició preparación; explicar que requiere el flujo operativo autorizado, no reintentar cancelación.
- `ORDER_HAS_PAYMENT`: la orden tiene pago asignado; continuar por contrato 08.
- Red/5xx: permitir reintento. En creación, conservar la misma clave y el mismo payload ante resultado ambiguo. Nunca mostrar detalle SQL, tokens, headers ni respuestas crudas.

La UI debe distinguir errores de validación/carrito, configuración de mesa, permisos, falta de stock, conflicto de estado y error de red. No limpiar carrito ni cambiar la clave si el resultado de creación es ambiguo. Evitar doble envío con estado de carga y bloqueo accesible; tras un resultado confirmado, vaciar el carrito y mostrar la confirmación recibida sin afirmar que inventario fue reservado.

## Estructura de frontend recomendada

No ampliar `src/pages/OrdersHistory.tsx` con más lógica de dominio. Extraer POS y órdenes a módulos con componentes pequeños y servicios comprobables:

```text
src/features/orders/
  model.ts
  ordersService.ts
  orderValidation.ts
  orderAvailabilityService.ts
  components/
    PosOrderComposer.tsx
    PosFulfillmentSelector.tsx
    ProductAvailabilityCard.tsx
    OrderList.tsx
    OrderDetailDialog.tsx
    OrderStatusTimeline.tsx
```

La pantalla/ruta integra componentes y estado de navegación; los servicios encapsulan `HttpClient`/RPC y los parsers; las funciones de dominio validan UUID, cantidades, disponibilidad y transiciones sin React. No duplicar reglas de stock en tarjetas, carrito y servicio.

## Criterios de aceptación

1. Kiosco y POS envían UUID y líneas; ningún cliente envía importe autoritativo ni escribe órdenes/líneas directamente.
2. Anon puede crear orden solo para una mesa con sesión abierta, no puede listar/consultar órdenes arbitrarias ni ejecutar RPC de personal, y solo puede consultar el resumen de su propia orden kiosco después de aprobar/aplicar la RPC privada propuesta.
3. `admin`, `cashier` y `waiter` pueden consultar y operar órdenes conforme a sus RPC; RLS/grants siguen siendo autoridad.
4. La ausencia de sesión abierta rechaza la creación con un error accionable, sin crear orden; la integridad del indicador `active` depende de cerrar la brecha SQL del contrato 06.
5. Dos creaciones concurrentes con la misma clave y payload devuelven la misma orden; payload distinto con esa clave es rechazado tras cerrar la brecha de idempotencia SQL.
6. Precio/nombre snapshot son del servidor; stock no cambia al crear y se descuenta exactamente una vez al confirmar.
7. Confirmación con stock insuficiente no deja cambios parciales; las transiciones solo avanzan en el orden permitido.
8. Cancelación repetida es idempotente; cancelaciones tardías o con pago se rechazan; cualquier reverso de stock queda reflejado en el ledger.
9. Promociones no se muestran como aplicadas hasta que exista cálculo autoritativo integrado en la RPC.
10. Tests con `fetch` simulado cubren UUID, transformación, carrito inválido, permisos, sesión ausente, mesa para llevar no configurada, apertura concurrente, clave reutilizada, conflicto concurrente, timeout/reintento, disponibilidad de producto/receta, carrito mayor a stock, confirmación con stock agotado, estados, cancelación y errores de red.
11. Staging valida RPC/RLS con anon, waiter, cashier y admin, y prueba el flujo completo con datos controlados.
12. Pasan `npm run lint`, `npm run build` y pruebas existentes.

## Fuera de alcance

- Implementación de pagos y división de cuenta en frontend (contrato 08).
- Cálculo/aplicación de promociones en servidor; se requiere decisión/migración independiente antes de publicar descuentos.
- Historial completo o reportes; la consulta operativa paginada no sustituye contrato 09.
- Flujo de desperdicio/devolución para órdenes ya en preparación, listas o servidas.
