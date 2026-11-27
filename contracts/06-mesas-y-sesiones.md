# Contrato 06 — Mesas y sesiones

**Etapa:** 4.4 del plan de migración.  
**Estado:** propuesto; alineado con las funciones y políticas del esquema SQL local. Validar en staging antes de considerar cerrada la etapa.  
**Objetivo:** administrar mesas y permitir al personal abrir/cerrar sesiones de mesa de forma segura e idempotente, preparando el vínculo que usarán las órdenes del kiosco/POS en el contrato 07.

## Alcance y límites

- Administrar `cafe_tables` y consultar sesiones con UUID; no reutilizar IDs numéricos legacy.
- Los componentes consumen servicios de dominio; no construyen URLs PostgREST ni RPC.
- Mantener `fetch`/`HttpClient`, publishable key y JWT del usuario autenticado. Nunca exponer `service_role`.
- Ninguna escritura directa REST a `table_sessions`: apertura/cierre y transiciones de estado usan RPC.
- No implementar órdenes, cobros, pagos, promociones ni inventario en este contrato.
- La sesión de mesa debe estar abierta para aceptar órdenes; la RPC `create_public_order` volverá a validar esta condición en el contrato 07.
- Las operaciones de tabla no exponen a anon el listado, estado operativo ni sesiones. El kiosco resuelve únicamente el UUID del QR mediante `get_public_table`.

## Autoridad y permisos

RLS, grants, restricciones e invariantes de las RPC son la autoridad; ocultar acciones en la UI no constituye control de acceso.

| Operación | admin | cashier | waiter | anon |
|---|---:|---:|---:|---:|
| Listar mesas y sesiones | Sí | Sí | Sí | No |
| Crear/editar nombre y activar/desactivar mesa | Sí | No | No | No |
| Cambiar disponibilidad de mesa por RPC | Sí | No | No | No |
| Abrir sesión | Sí | Sí | Sí | No |
| Cerrar sesión vacía/elegible | Sí | Sí | Sí | No |
| Resolver nombre/UUID público de mesa activa por QR | Sí | Sí | Sí | Sí |

La base permite `DELETE` de mesas, pero las FK de sesiones pueden restringirlo. Preferir desactivar. La activación no equivale a disponibilidad: `active` decide si el QR puede resolver la mesa; `status` representa su estado operativo.

## Mesas

### Listar

```http
GET /rest/v1/cafe_tables?select=id,name,status,active,created_at,updated_at&order=name.asc&limit=200
```

Los UUID deben validarse y conservarse como strings. `status` solo acepta `available`, `assigned`, `occupied` o `unavailable`; no sustituir valores desconocidos por otro estado.

### Crear

```http
POST /rest/v1/cafe_tables
Prefer: return=representation
```

```json
{ "name": "Mesa 1", "active": true }
```

No enviar `status`, timestamps ni identificador: PostgreSQL crea UUID y usa `available` como estado inicial. Recortar y exigir nombre no vacío; la unicidad de `name` la confirma la base. Los nombres de mesas inactivas siguen ocupando el valor único.

### Editar nombre o actividad

```http
PATCH /rest/v1/cafe_tables?id=eq.<table-uuid>
Prefer: return=representation
```

Solo se permiten `name` y `active`. No enviar `status` por REST. La UI debe bloquear desactivar una mesa con sesión abierta y conservar el formulario si la base rechaza el cambio.

**Brecha a resolver antes de producción:** el esquema actual no impide en la base que un admin desactive una mesa con sesión abierta. La defensa de UI no es suficiente ante una llamada REST directa. Se requiere una migración versionada (constraint/trigger o RPC de administración) para cerrar esta brecha; no modificar el SQL remoto dentro de este contrato sin aprobación.

### Disponibilidad operativa

La transición de `status` usa RPC, solo para admin:

```http
POST /rest/v1/rpc/set_table_status
Content-Type: application/json
```

```json
{ "p_table_id": "<table-uuid>", "p_status": "unavailable" }
```

La función devuelve el nuevo enum `table_status`. La UI administrativa puede permitir poner una mesa `unavailable` y devolverla a `available` cuando no tenga sesión abierta. No presentar `occupied` como acción manual: abrir/cerrar sesión actualiza ese estado automáticamente.

`assigned` existe en el enum, pero el esquema no define una operación o regla de negocio que lo produzca. No ofrecerlo como acción hasta acordar qué significa y cómo se desasigna.

## Sesiones

### Consultar sesiones abiertas

```http
GET /rest/v1/table_sessions?select=id,table_id,status,opened_by,opened_at,closed_at&status=eq.open&order=opened_at.desc&limit=200
```

La tabla tiene RLS de lectura para personal autenticado y no otorga escrituras directas. La base impone un índice único parcial: solo puede existir una sesión `open` por mesa. El historial completo queda fuera de alcance; la vista operativa necesita como mínimo las sesiones abiertas.

```ts
export type TableStatus = 'available' | 'assigned' | 'occupied' | 'unavailable';
export type TableSessionStatus = 'open' | 'closed' | 'cancelled';

export interface CafeTable {
  id: string;
  name: string;
  status: TableStatus;
  active: boolean;
}

export interface TableSession {
  id: string;
  tableId: string;
  status: TableSessionStatus;
  openedBy: string | null;
  openedAt: string;
  closedAt: string | null;
}
```

Los parsers rechazan UUID, enum, timestamp, boolean o relación mesa/sesión malformados. Para una sesión abierta `closedAt` debe ser `null`; para `closed`/`cancelled` debe existir. No convertir respuestas inválidas en listas vacías.

### Abrir sesión

```http
POST /rest/v1/rpc/open_table_session
Content-Type: application/json
```

```json
{
  "p_table_id": "<table-uuid>",
  "p_idempotency_key": "<uuid-nuevo-por-intención-de-apertura>"
}
```

La RPC devuelve el UUID de la sesión. Solo personal autenticado activo (`admin`, `cashier`, `waiter`) puede abrirla. La función valida mesa existente/activa y no `unavailable`, crea la sesión, registra `opened_by` y cambia la mesa a `occupied` en una transacción.

- Crear una clave UUID por cada intención nueva y conservarla mientras el resultado sea ambiguo.
- Reintentar un timeout/error de red únicamente con la misma clave y el mismo `tableId`; la RPC devuelve la sesión existente.
- Reutilizar la misma clave con otra mesa responde `IDEMPOTENCY_KEY_REUSED`.
- No generar otra clave automáticamente ante resultado de red ambiguo; podría abrir una segunda sesión lógica.
- `TABLE_ALREADY_OPEN`, `TABLE_UNAVAILABLE` y `TABLE_NOT_FOUND` son errores recuperables de negocio, no éxito.

### Cerrar sesión vacía/elegible

```http
POST /rest/v1/rpc/close_empty_table_session
Content-Type: application/json
```

```json
{ "p_table_session_id": "<session-uuid>" }
```

La respuesta JSON confirma `table_session_id` y `status`. Personal autenticado puede solicitar el cierre. La RPC solo cierra cuando no hay órdenes sin cancelar que estén pendientes de terminar o pagar; cierra la sesión y devuelve la mesa a `available` de forma atómica. Repetir para una sesión ya cerrada es idempotente.

Errores como `SESSION_HAS_UNFINISHED_OR_UNPAID_ORDERS` deben conservar el estado visible y explicar que primero deben terminarse/cobrarse las órdenes. La RPC de pago del contrato 08 también puede cerrar automáticamente la sesión al saldarla; después de un pago la UI debe volver a consultar mesa/sesión y no asumir su estado previo.

## Resolución pública del QR

El QR conserva UUID de mesa y la ruta ya existente `/user/:mesa_id`; no debe codificar número o nombre como autoridad. Para el kiosco, usar:

```http
POST /rest/v1/rpc/get_public_table
Content-Type: application/json
```

```json
{ "p_table_id": "<table-uuid>" }
```

La función devuelve solo `{ "id": "...", "name": "..." }` para una mesa activa, o `null` si el UUID no existe o la mesa está inactiva. No revela `status`, sesiones, operador ni órdenes. La resolución pública no abre una sesión: abrirla es una acción del personal. Aunque `get_public_table` pueda resolver una mesa sin turno abierto, la creación de órdenes debe fallar en servidor hasta que el personal abra la sesión.

## Errores y recuperación

- `401`: renovar una vez mediante la sesión existente; si falla, cerrar sesión y volver al login.
- `403`/`42501`/`FORBIDDEN`: permiso insuficiente; no perder cambios del formulario.
- `23505`: nombre de mesa duplicado.
- `23503`: registro relacionado o mesa protegida por sesión/historial.
- `22P02`: UUID o enum inválido.
- `P0002`, `TABLE_NOT_FOUND`, `SESSION_NOT_FOUND`: recurso inexistente.
- `TABLE_ALREADY_OPEN`, `TABLE_UNAVAILABLE`, `TABLE_HAS_OPEN_SESSION`, `OPEN_SESSION_REQUIRED`, `SESSION_NOT_OPEN`, `SESSION_HAS_UNFINISHED_OR_UNPAID_ORDERS`, `IDEMPOTENCY_KEY_REUSED`: traducir a mensajes accionables y seguros.
- Red/5xx: mostrar reintento. Apertura conserva la misma idempotency key tras resultado ambiguo; no repetir automáticamente con una clave nueva.
- Nunca mostrar detalle SQL, token, headers ni respuestas crudas.

## Criterios de aceptación

1. Solo admin modifica datos de mesa; anon no lee `cafe_tables` ni sesiones.
2. Admin/cashier/waiter autenticados pueden abrir/cerrar conforme a RPC y anon no puede hacerlo.
3. RLS/grants bloquean a anon, waiter y cashier al escribir directamente `cafe_tables`; nadie escribe `table_sessions` directamente.
4. Dos aperturas concurrentes no generan más de una sesión abierta por mesa; los reintentos usan idempotencia.
5. Las RPC mantienen `status` sincronizado (`occupied` al abrir, `available` al cerrar) y rechazan transiciones incompatibles.
6. El QR resuelve solo UUID/nombre de mesas activas; no expone estado ni información operativa y no permite crear órdenes sin sesión abierta.
7. Intentar cerrar una sesión con órdenes pendientes/no pagadas falla sin mutar mesa/sesión; repetición de cierre exitoso no duplica efectos.
8. Tests con `fetch` simulado cubren transformación, validación, permisos, duplicados, conflicto de sesión, timeout/idempotencia y errores de red.
9. Staging prueba RLS y RPC con anon, waiter, cashier y admin; la brecha de desactivación de mesa con sesión abierta queda cerrada antes de producción.
10. Pasan `npm run lint`, `npm run build` y pruebas existentes.

## Fuera de alcance

- Crear/editar/aceptar/cancelar órdenes y su transición de preparación (contrato 07).
- Pagos, división de cuenta y cierre automático por saldo pagado (contrato 08).
- Generación/descarga/impresión masiva de QR, si requiere una ruta o formato distinto del existente.
- Añadir semántica de reservación para `assigned`.
