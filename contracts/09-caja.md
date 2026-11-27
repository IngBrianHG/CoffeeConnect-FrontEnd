# Contrato 09 — Caja

**Etapa:** extensión operacional posterior a los contratos 06–08.  
**Estado:** implementación inicial local en `src/features/caja/CajaPage.tsx`; reutiliza servicios y cuenta de contratos 06/08. Requiere pruebas de permisos/UX en staging; no acredita cambios remotos.
**Objetivo:** ofrecer al personal una entrada de Caja para localizar mesas/sesiones operativas, abrir sus cuentas y registrar cobros sin crear un modelo de caja o un ledger paralelo.

## Alcance y decisiones

- La lista es una proyección operativa de `cafe_tables` y `table_sessions`, no un historial contable ni un nuevo recurso.
- Una mesa activa con sesión `open` permite abrir la cuenta de esa sesión. La mesa virtual `Para llevar` se muestra como cuenta compartida, conforme al contrato 07.
- Los datos de cuenta, pagos, asignaciones, cierre y saldo obedecen íntegramente al contrato 08. No duplicar lógica de saldo ni escribir directamente en `payments`, `payment_allocations`, `orders` u `order_items`.
- Caja puede iniciar apertura/cierre de sesión usando exclusivamente las RPC del contrato 06; cobro mediante `record_session_payment`; cierre con cancelación solo mediante el flujo aprobado del contrato 08.
- No incluye turnos, saldo inicial, retiros/ingresos manuales, efectivo contado, arqueo, reembolsos ni corte contable. El esquema actual descrito por estos contratos no contiene entidad de turno ni ledger de movimientos de efectivo.
- Todas las llamadas usan la URL Supabase, `apikey` publishable y JWT de la sesión. Nunca incluir `service_role` en frontend.

## Permisos

RLS, grants y validaciones RPC son la autoridad. La UI puede ocultar acciones, pero no sustituye autorización del servidor.

| Operación | admin | cashier | waiter | anon |
|---|---:|---:|---:|---:|
| Listar mesas y sesiones abiertas | Sí | Sí | Sí | No |
| Consultar cuenta de una sesión | Sí | Sí | Sí | No |
| Abrir/cerrar sesión según elegibilidad | Sí | Sí | Sí | No |
| Registrar pago | Sí | Sí | No | No |
| Leer QR público limitado del kiosco | Según contrato 06 | Según contrato 06 | Según contrato 06 | Solo RPC pública existente |

El acceso a reportes analíticos no se concede por este contrato; se define en el contrato 10. Verificar que la sesión Auth siga correspondiendo a perfil existente y activo (`profiles.active = true`) y a rol reconocido (`admin`, `cashier`, `waiter`). La base debe volver a validar rol/actividad en cada RPC protegida.

## Listado de mesas y sesiones

### Lectura y filtros

Leer recursos operativos usando las consultas del contrato 06:

```http
GET /rest/v1/cafe_tables?select=id,name,status,active,created_at,updated_at&order=name.asc,id.asc&limit=200&offset=0
GET /rest/v1/table_sessions?select=id,table_id,status,opened_by,opened_at,closed_at&status=eq.open&order=opened_at.desc,id.desc&limit=200&offset=0
```

Enviar `apikey`, `Authorization: Bearer <access-token>` y `Accept: application/json`. No aceptar filtro de sesión desde datos de un QR para este listado. En la vista de Caja, combinar por `table_sessions.table_id`; no inferir sesión abierta solo a partir de `cafe_tables.status`. Si el orden estable de sesiones requiere desempate, usar `id` después de `opened_at`.

Las respuestas PostgREST son arrays JSON. El límite máximo documentado por contrato para páginas de órdenes es 200; Caja usará `limit=200` y offsets crecientes, respetando además el `Content-Range`/límite configurado en servidor. No asumir que recibir 200 filas significa que terminó el listado. El backend/RLS no debe exponer sesiones cerradas históricas a anon.

Si no hay sesiones abiertas, presentar mesas activas y sus estados operativos sin fabricar una cuenta vacía. Mesa `unavailable` no se puede abrir. Las mesas inactivas no aceptan nuevas sesiones; si tienen una sesión abierta por un estado heredado, mostrarla como inconsistencia y no ofrecer operaciones que evadan las reglas de 06.

### Modelo combinado de presentación

```ts
export interface CashierTableRow {
  table: {
    id: string;
    name: string;
    active: boolean;
    status: 'available' | 'assigned' | 'occupied' | 'unavailable';
  };
  openSession: null | {
    id: string;
    openedBy: string | null;
    openedAt: string;
  };
  accountAvailability: 'open' | 'no_open_session' | 'table_unavailable' | 'inactive';
}
```

Parser estricto: UUID válidos, enums conocidos, boolean real y timestamps ISO con zona/offset. Rechazar relación incoherente (más de una sesión abierta por mesa), estado inesperado o datos inválidos; no degradar a una lista vacía. La restricción de unicidad de sesión abierta por mesa se documenta en 06.

### Paginación

La lista de mesas y sesiones se carga independientemente, y cada recurso pagina en el servidor. Cuando una operación requiera el conjunto completo (por ejemplo, búsqueda local o verificar unicidad de una sesión), cargar todas sus páginas o hacer búsqueda/validación en servidor; no inferir el estado de filas aún no cargadas.

Para la apertura de una cuenta es suficiente usar la sesión abierta explícitamente seleccionada, pero el servicio debe validar que el UUID y su mesa coinciden con la fila cargada. Navegar a la cuenta no concede permisos nuevos.

## Cuenta, pagos y cierre

Al seleccionar una fila con `openSession.id`, navegar/abrir la cuenta de esa sesión invocando el servicio de dominio del contrato 08. La carga completa debe traer todas las órdenes, líneas, pagos y asignaciones paginadas; no habilitar cobro global con una lectura parcial.

Desde Mesas y Sesiones, el diálogo de detalles muestra el QR y los datos operativos; los administradores también pueden editar allí el nombre y activar/desactivar el QR. No se permite desactivar el QR mientras haya una sesión abierta. Su acción **Ver cuenta en Caja** navega al módulo Caja y abre la sesión seleccionada para consultar y cobrar. La lista de mesas no cobra ni abre cuentas directamente.

El contrato 08 es normativo para:

- campos y validación de `SessionAccount` / `SessionPayment`;
- saldo por línea, orden y sesión;
- `record_session_payment` y su payload;
- idempotencia, manejo de timeout, errores de pago;
- reglas de órdenes cobrables, cancelación y cierre automático o explícito.

No cambiar permisos de `record_session_payment`: únicamente `admin` y `cashier`. `waiter` puede consultar la cuenta y usar los cierres permitidos, pero no registrar pagos. Una clave y payload de pago ambiguos se conservan exactamente; nunca volver a cobrar automáticamente.

Caja puede ofrecer **Abrir sesión** y **Cerrar sesión vacía/elegible** únicamente con `open_table_session` y `close_empty_table_session` descritas en 06. El cierre de una cuenta con órdenes no entregadas se rige por `close_session_and_cancel_unserved_orders` en 08 y no debe representarse como un cierre vacío.

## Respuestas y errores

Las lecturas PostgREST devuelven arrays con las columnas seleccionadas; RPC y errores conservan los esquemas/códigos de 06 y 08. Caja no introduce un envelope REST ni traduce errores del servidor en éxito.

| Error | Comportamiento de Caja |
|---|---|
| `401` | Renovar una vez según contrato 01; si falla, terminar sesión y regresar al login. |
| `403`, `42501`, `FORBIDDEN` | Mostrar acceso insuficiente; mantener contexto no sensible. |
| `TABLE_NOT_FOUND`, `SESSION_NOT_FOUND` | Recargar lista; no abrir una cuenta inventada. |
| `TABLE_UNAVAILABLE`, `TABLE_ALREADY_OPEN`, `TABLE_HAS_OPEN_SESSION`, `SESSION_NOT_OPEN` | Recargar estado operativo; no repetir una apertura con clave nueva ante resultado ambiguo. |
| `SESSION_HAS_UNFINISHED_OR_UNPAID_ORDERS`, `SESSION_HAS_UNPAID_SERVED_ORDERS` | Mantener mesa/cuenta visible y guiar al flujo de órdenes/cobro indicado por 06/08. |
| `PAYMENT_ITEM_NOT_PAYABLE`, `PAYMENT_EXCEEDS_ITEM_BALANCE` | Recargar la cuenta y pedir revisar la selección. |
| `IDEMPOTENCY_KEY_REUSED` | No reutilizar la clave con otro intento; resolver el intento anterior. |
| Red, timeout, `5xx` | Mostrar error explícito y reintento manual seguro; para mutaciones conservar clave/payload. |
| Datos malformados o relación incoherente | Error de carga; no presentar saldo cero ni lista vacía como si fuera respuesta válida. |

No mostrar SQL, respuestas crudas, headers, tokens ni detalles internos.

## Criterios de aceptación y pruebas

1. `admin`, `cashier` y `waiter` autenticados consultan listas/cuentas según RLS; `anon` no puede listar mesas/sesiones ni cuentas privadas.
2. `waiter` no puede registrar pago llamando REST/RPC directamente; solo `admin`/`cashier` pueden ejecutar el cobro.
3. Las páginas de mesas y sesiones se combinan por UUID, con paginación completa y detección de relaciones/estados inválidos.
4. Mesa sin sesión no se presenta como cuenta con saldo cero; la cuenta exige sesión abierta y revalidación del servidor.
5. Apertura, cierre vacío, pago y cierre explícito usan las RPC de 06/08 y respetan concurrencia, idempotencia, permisos y transacciones de esos contratos.
6. Pruebas unitarias de servicio cubren arrays vacíos legítimos, múltiples páginas, repetición/duplicidad de sesión, parsers, expiración auth, 403 y fallos de red.
7. Pruebas de integración en staging cubren RLS/grants con `anon`, `waiter`, `cashier`, `admin`, sesión concurrente y transición de mesa al abrir/cerrar.
8. Pruebas de cuenta/pago conservan los casos del contrato 08; no se duplican ni divergen sus fixtures/reglas.

## Fuera de alcance / limitaciones

- Turnos de caja, arqueo y corte requieren definición funcional y migración separada aprobada; no simularlos con pagos.
- No se implementa ni cambia SQL, RLS, RPC ni datos remotos con este contrato.
- Confirmar en staging que el esquema y permisos descritos por 06/08 están desplegados; los contratos no demuestran estado remoto.
