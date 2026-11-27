# Contrato 08 — Cuenta de mesa, pagos y cierre

**Etapa:** 4.6 del plan de migración.  
**Estado:** implementado en frontend; las migraciones incrementales de idempotencia y cierre con cancelación están propuestas y requieren aprobación/staging antes de producción.
**Dependencia:** contratos 06 y 07.  
**Objetivo:** consultar una cuenta operativa completa, agrupar varios pedidos por sesión, registrar pagos completos o parciales con uno o varios métodos y cerrar la sesión solo cuando la cuenta y el ciclo operativo estén terminados.

## Alcance

- Implementar la cuenta de una sesión de mesa física o de la mesa virtual `Para llevar`.
- Mostrar todas las órdenes y líneas de la sesión, sus estados, total, pagos asignados y saldo por línea/orden/sesión.
- Permitir pagar una o varias líneas de distintos pedidos de la misma sesión en un pago; admitir pagos parciales sucesivos y métodos de pago distintos.
- Registrar pagos solo con `record_session_payment`; no insertar ni modificar `payments`, `payment_allocations`, `orders.payment_status` directamente.
- Cerrar automáticamente la sesión mediante la RPC al cumplir sus invariantes. No cerrar una sesión con órdenes activas o saldo pendiente.
- No incluye reembolsos, devoluciones posteriores a pago, propinas, impuestos, descuentos autoritativos, pagos electrónicos procesados por proveedor ni reportes históricos.

## Autoridad y permisos

Las políticas RLS, grants, validaciones RPC y restricciones PostgreSQL son autoridad; la UI solo mejora la experiencia.

| Operación | admin | cashier | waiter | anon |
|---|---:|---:|---:|---:|
| Consultar órdenes/líneas de una sesión | Sí | Sí | Sí | No |
| Consultar pagos y asignaciones | Sí | Sí | Sí | No |
| Registrar pago | Sí | Sí | No | No |
| Cerrar sesión vacía/elegible | Sí | Sí | Sí | No |

`record_session_payment` en `001_supabase_schema.sql` permite `admin` y `cashier`, no `waiter`. No cambiar ese alcance en la UI. Nunca exponer claves privilegiadas ni permitir escritura REST directa como alternativa a la RPC.

## Modelo de cuenta

Una sesión agrupa cero o más pedidos. Cada pedido tiene varias líneas; el pago se asigna a líneas por `order_item_id`. El estado monetario por orden (`unpaid`, `partial`, `paid`) lo calcula el servidor.

```ts
export interface AccountLine {
  orderId: string;
  orderItemId: string;
  orderStatus: OrderStatus;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  paidAmount: number;
  balance: number;
}

export interface SessionAccount {
  tableSessionId: string;
  tableId: string;
  sessionStatus: 'open' | 'closed' | 'cancelled';
  lines: AccountLine[];
  totalServed: number;
  totalPaid: number;
  balance: number;
  orders: OrderWithItems[];
  payments: SessionPayment[];
}

export interface SessionPayment {
  id: string;
  method: 'cash' | 'card' | 'transfer' | 'other';
  amount: number;
  payerLabel: string | null;
  reference: string | null;
  createdAt: string;
  allocations: Array<{ orderItemId: string; amount: number }>;
}
```

Validar UUID, enum, timestamps, importes finitos no negativos, y consistencia de relaciones. Rechazar datos malformados; nunca sustituir errores por una cuenta vacía ni convertir importes inválidos en cero. Para cada línea:

```text
saldo = subtotal snapshot de order_item - suma de payment_allocations.amount
```

El saldo nunca puede ser negativo. Los totales de la vista son derivados para lectura; el cliente no los envía como autoridad.

## Lectura de cuenta

Personal autenticado consulta la sesión, sus órdenes y líneas mediante las tablas permitidas por RLS. La lectura debe estar filtrada por `table_session_id` y paginar remotamente donde aplique; no asumir que un primer bloque de resultados es toda la cuenta.

Lecturas requeridas:

```http
GET /rest/v1/table_sessions?select=id,table_id,status,opened_at,closed_at&id=eq.<session-uuid>
GET /rest/v1/orders?select=<campos de orden>&table_session_id=eq.<session-uuid>&order=created_at.asc,id.asc&limit=200&offset=0
GET /rest/v1/order_items?select=<campos snapshot>&order_id=in.(<uuids de la página>)&limit=...
GET /rest/v1/payments?select=id,table_session_id,method,amount,payer_label,reference,received_by,created_at&table_session_id=eq.<session-uuid>&order=created_at.desc,id.desc&limit=200&offset=0
GET /rest/v1/payment_allocations?select=payment_id,order_item_id,amount&payment_id=in.(<uuids de pagos>)
```

El servicio debe validar que cada orden pertenece a la sesión seleccionada, cada línea a una orden cargada, cada pago a esa sesión y cada asignación a una línea incluida en esa sesión. Si la cuenta excede límites por página, continuar la paginación o indicar que falta cargar información; no permitir cobrar con datos parciales.

Una consulta repetible por sesión debe devolver también órdenes `cancelled` para contexto, pero excluirlas del saldo cobrable. No confundir importe pagado con recaudación neta: los pagos se suman una sola vez desde asignaciones/pagos y las líneas elegibles se computan una sola vez desde órdenes.

## Registrar pago

```http
POST /rest/v1/rpc/record_session_payment
Content-Type: application/json
Authorization: Bearer <JWT de admin/cashier>
```

```json
{
  "p_table_session_id": "<session-uuid>",
  "p_method": "cash",
  "p_allocations": [
    { "order_item_id": "<linea-de-pedido-A>", "amount": 5.00 },
    { "order_item_id": "<linea-de-pedido-B>", "amount": 2.50 }
  ],
  "p_idempotency_key": "<uuid-nuevo-por-intencion-de-pago>",
  "p_payer_label": "Persona 1",
  "p_reference": null
}
```

La respuesta actual contiene `payment_id`, `amount`, `method` y `session_closed`. El servidor calcula el monto total a partir de asignaciones y valida:

- Sesión abierta y existente.
- Una a 100 asignaciones, UUID válidos, sin `order_item_id` repetido dentro de la solicitud.
- Importes positivos, con máximo dos decimales.
- Cada línea pertenece a un pedido `served` de la sesión indicada.
- El importe no supera el saldo restante de la línea, incluyendo pagos anteriores.
- Usuario activo con rol `admin` o `cashier`.
- Operación atómica: no guardar parcialmente cabecera, asignaciones, estados o cierre ante un error.

### Varias órdenes, pagos parciales y métodos

- Una llamada puede incluir líneas de **varios pedidos** de la misma sesión. Así se puede cobrar la cuenta de la mesa con una sola forma de pago.
- Para dividir por persona, importe o método, realizar varias llamadas, cada una con su propio UUID idempotente. Un mismo pedido puede recibir pagos en operaciones sucesivas.
- Se puede asignar un importe parcial a una línea y completar su saldo en un pago posterior. Una llamada no puede repetir la misma línea dos veces; consolidar sus asignaciones antes de enviarla.
- No mezclar sesiones distintas en una llamada. El servidor debe rechazar toda línea que no pertenezca a la sesión de la cabecera.
- No mostrar un pago como exitoso hasta que la RPC responda. Si la RPC se guardó y falla la recarga, informar que el pago se registró y ofrecer actualizar sin volver a cobrar automáticamente.

### Idempotencia requerida antes de producción

La función SQL base devuelve el pago anterior si la clave existe para la misma sesión, pero no compara método, asignaciones, pagador ni referencia. Eso permite que una clave reutilizada con otra intención parezca exitosa.

Una migración versionada debe guardar/comparar una huella normalizada que incluya sesión, método, asignaciones ordenadas por línea e importe, pagador y referencia. La misma clave y payload devuelve el pago previo; misma clave con payload diferente devuelve `IDEMPOTENCY_KEY_REUSED`. El frontend genera una clave por intención y conserva clave y payload exactos tras timeout/desconexión/5xx. Nunca genera una clave nueva automáticamente ante resultado ambiguo.

## Saldo, elegibilidad y cierre de sesión

Solo se cobran órdenes `served`. Órdenes `pending`, `confirmed`, `preparing` o `ready` siguen visibles y bloquean el cierre aunque sus líneas servidas ya estén pagadas. Órdenes `cancelled` no generan saldo y no bloquean por sí mismas.

Un pago parcial nunca cierra la sesión. La sesión tampoco se cierra mientras haya saldo de órdenes `served`, aunque se cancelen órdenes no entregadas. Cuando no quedan órdenes activas, el último pago puede cerrar la sesión automáticamente. Si quedan órdenes `pending`, `confirmed`, `preparing` o `ready`, el frontend conserva abierta la sesión y ofrece una acción explícita **Revisar cancelación y cerrar mesa** solo cuando el saldo servido es cero.

La acción de cierre explícito invoca `close_session_and_cancel_unserved_orders` y en una sola transacción:

1. Verifica que la sesión esté abierta y que el saldo de todas las líneas `served` sea cero.
2. Requiere que el cliente enumere exactamente todas las órdenes no entregadas; no acepta omisiones, órdenes de otra sesión ni órdenes `served`.
3. Cancela órdenes `pending` y `confirmed`; a las `confirmed` les revierte los consumos registrados.
4. Para cada orden `preparing` o `ready`, exige que el personal seleccione **merma** o **reutilizable/reasignable**. En ambos casos conserva el consumo de inventario y agrega la decisión a la observación; no repone existencias.
5. Agrega `Cuenta cerrada; orden no entregada cancelada.` a las notas existentes, sin sobrescribirlas; registra el destino de las órdenes preparadas cuando aplique.
6. Cierra la sesión y marca la mesa disponible. Si falla cualquier paso, no cancela órdenes ni libera la mesa parcialmente.

El RPC de pago sigue pudiendo cerrar automáticamente cuando las órdenes estén todas `served` o `cancelled` y sus líneas estén totalmente cobradas. Para cancelar órdenes pendientes como parte del cierre, se exige confirmación explícita de la acción anterior.

El cierre sin cancelaciones ocurre cuando:

1. No existen órdenes de la sesión con estado distinto de `served` o `cancelled`.
2. Todas las líneas cobrables de órdenes `served` están saldadas exactamente.
3. El total de asignaciones coincide con el total cobrable, sin sobrepago ni saldo negativo.

Al cumplirse estas reglas, la operación cierra sesión y libera la mesa de forma transaccional. Después del cierre explícito, la UI vuelve a consultar la sesión y el estado de mesa. Para la mesa virtual `Para llevar`, la siguiente venta abre otra sesión mediante el flujo del contrato 07; no seguir agregando pedidos a una sesión cerrada.

`close_empty_table_session` es solo para cerrar sesiones elegibles sin órdenes activas; no usarla para cancelar órdenes, simular un pago ni saltarse las reglas anteriores.

## Vista operativa requerida

La cuenta debe permitir que caja revise y entienda la situación sin inferirla de UUIDs:

- Cabecera con nombre de mesa (o etiqueta **Para llevar**), sesión, hora de apertura y estado.
- Lista agrupada por orden: hora, origen si se conoce, estado de preparación/pago, líneas snapshot, cantidades, notas visibles al personal, subtotal y saldo.
- Resumen persistente: total servido, total pagado, saldo por cobrar y órdenes todavía no cobrables.
- Selector de líneas e importes con validación inmediata de saldo. Acciones rápidas para “cobrar saldo de esta orden” y “cobrar todo lo elegible de esta sesión”, siempre mostrando qué órdenes/líneas incluye antes de confirmar.
- Si el saldo servido es cero pero hay órdenes no entregadas, ofrecer cierre explícito con lista de órdenes a cancelar, advertencia de cierre/liberación y selección obligatoria merma/reutilizable para órdenes en preparación o listas.
- Si queda saldo servido, bloquear el cierre explícito y comunicar que primero debe completarse el cobro, aun cuando el personal elija cancelar órdenes no entregadas.
- Registro de pagos recientes con método, hora, importe, pagador/referencia cuando existan y desglose de asignaciones por pedido.
- Estado visual claro para pendiente, parcial, pagado, cancelado y no cobrable; no usar solo color.
- Si hay más de una página de órdenes/pagos, controles para cargar páginas; bloquear cobro global hasta completar la lectura o usar una RPC resumen transaccional aprobada.

Componentes y organización sugeridos, sin concentrar lógica en la pantalla histórica:

```text
src/features/orders/
  accountModel.ts
  accountService.ts
  paymentService.ts
  accountValidation.ts
  components/
    SessionAccountPage.tsx
    SessionAccountSummary.tsx
    SessionOrderGroup.tsx
    PaymentComposer.tsx
    PaymentAllocationEditor.tsx
    PaymentHistory.tsx
```

Los componentes presentan/validan interacción; servicios encapsulan `HttpClient`, consultas y RPC; parsers/domino calculan saldos desde datos servidor y validan relaciones. No duplicar cálculo de saldo entre componentes.

## Errores y recuperación

| Código/error | Mensaje/acción |
|---|---|
| `401` | Renovar una vez con la sesión existente; si falla, cerrar sesión y volver al login. |
| `403`, `42501`, `FORBIDDEN` | Permiso insuficiente; conservar selección y cuenta. |
| `SESSION_NOT_OPEN` | La cuenta ya se cerró; actualizar antes de otra operación. |
| `PAYMENT_ITEM_NOT_PAYABLE` | Una orden cambió o no está servida; recargar cuenta y revisar líneas. |
| `PAYMENT_EXCEEDS_ITEM_BALANCE` | El saldo cambió; no reintentar con la selección obsoleta, actualizar. |
| `INVALID_PAYMENT_ALLOCATIONS`, `DUPLICATE_PAYMENT_ALLOCATION`, `INVALID_PAYMENT_AMOUNT`, `INVALID_PAYMENT_PRECISION` | Corregir líneas/importes; conservar los datos editables si siguen siendo válidos. |
| `IDEMPOTENCY_KEY_REUSED` | No reenviar esa intención con la clave; resolver el intento previo y crear una intención nueva solo tras confirmar su resultado. |
| `SESSION_HAS_UNPAID_SERVED_ORDERS` | No cerrar ni cancelar órdenes operativas; cobrar todo lo entregado y actualizar la cuenta. |
| `INVALID_SESSION_CANCELLATIONS`, `INVALID_CANCEL_DISPOSITION` | Actualizar la cuenta y confirmar la lista completa; seleccionar merma/reutilizable en cada orden preparada. |
| Red, timeout o `5xx` | Mantener clave y payload idénticos; permitir reintento explícito y advertir que el resultado puede estar pendiente. |

Nunca mostrar SQL, respuesta cruda, headers, tokens ni datos internos de inventario. No borrar una asignación editada ante error; separar estado del formulario de la respuesta autoritativa.

## Criterios de aceptación

1. Una cuenta agrupa todas las órdenes de la sesión y carga páginas completas; relaciones rotas o respuestas inválidas producen error explícito.
2. Un solo pago puede asignarse a líneas de varios pedidos servidos de una sesión.
3. Pagos sucesivos con distintos métodos completan una cuenta; se permiten pagos parciales por línea sin superar el saldo.
4. Intentos con orden no servida, sesión cerrada, línea de otra sesión, duplicado o saldo obsoleto fallan sin escrituras parciales.
5. Repetir clave+payload de pago devuelve el mismo resultado; payload distinto con esa clave se rechaza.
6. Un pago parcial nunca cierra la sesión. El saldo servido impago bloquea el cierre; con saldo cero y órdenes no entregadas, la acción explícita las cancela, conserva/reversa stock según estado y destino, y cierra/libera una sola vez.
7. La cuenta de `Para llevar` se presenta como cuenta compartida; el cobro global permite revisar qué pedidos incluye y pagos separados no se asignan a líneas de otra sesión.
8. Las órdenes canceladas no se cobran; cancelar una orden con asignaciones de pago sigue rechazado por el contrato 07.
9. Tests de servicio cubren parsers, saldos, llamadas RPC, idempotencia, permisos, concurrencia, doble clic, timeout, red y respuestas parciales/paginadas.
10. Pruebas PostgreSQL/staging con `anon`, `waiter`, `cashier` y `admin` verifican grants, RLS, transacción, sobrepago, cancelación, política de merma/reutilizable, idempotencia de cierre y liberación.
11. Prueba E2E: abrir mesa → crear varias órdenes → confirmar/avanzar/servir → pago parcial que mantiene sesión abierta → completar pagos → cancelar órdenes no entregadas con confirmación → cierre/liberación → nueva sesión de `Para llevar`.
12. Pasan `npm run lint`, `npm run build` y pruebas existentes.

## Fuera de alcance

- Reembolsos, anulaciones de cobros y devoluciones tras pago; requieren un contrato/migración con ledger compensatorio.
- Pagos online/tokenización y confirmación del proveedor.
- Descuentos/promociones o impuestos calculados por el cliente.
- Reportes, conciliación e importación histórica (etapa 5).
