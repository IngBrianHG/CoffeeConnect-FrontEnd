# Contrato 10 — Reportes de ventas

**Etapa:** reporting sobre el modelo transaccional de los contratos 06–08.  
**Estado:** servicio/vista iniciales locales en `src/features/reports/`; RPC propuesta en `docs/sql/proposals/010_sales_report_rpc.sql`, pendiente revisión, aprobación y pruebas en staging. No está aplicada en remoto.
**Objetivo:** consultar ventas agrupadas por mesa y día o rango de días, con semántica estable de venta/cobro, sin descargar todas las transacciones ni crear una segunda fuente de verdad.

## Alcance y fuentes

- Reporte principal: ventas por día de negocio y mesa, con subtotal bruto, descuentos, venta neta y unidades servidas.
- La vista de órdenes incluye las órdenes del período, su estado y los importes asignados a sus líneas; los totales cobrados/pendientes solo consideran órdenes servidas.
- La fecha de venta se basa en `orders.created_at`; la métrica de cobro se basa separadamente en `payments.created_at`. Pagos parciales pueden recibirse en un día distinto al de la venta.
- Fuentes existentes: `orders`, `order_items` (snapshot de nombre, cantidad, precio, descuento y subtotal), `table_sessions`, `cafe_tables`, `payments` y `payment_allocations`.
- Los pagos son el ledger de cobros; las asignaciones los concilian a líneas. No sumar `payments.amount` después de unir con varias líneas, pues multiplicaría el importe.
- No consultar `products`, `categories` o `promotions` como fuente histórica de nombre o descuento: usar snapshots de la venta. No agregar tablas materializadas en este alcance.
- Excluye reembolsos, devoluciones, propinas, impuestos no representados, costos/margen, inventario, conciliación, importación histórica, exportación masiva y corte de caja. Sin ledger compensatorio no afirmar “neto de reembolsos”.

## Definiciones semánticas

Todas las cifras monetarias usan decimal de PostgreSQL representado en JSON como número finito, con precisión de moneda (dos decimales); nunca usar `float` como autoridad para nuevas escrituras.

| Campo | Definición |
|---|---|
| `grossSales` | Suma de `quantity * unit_price` de líneas pertenecientes a órdenes `served` cuyo `created_at` cae en el rango. |
| `discountTotal` | Suma de `discount_amount` snapshot de esas mismas líneas. |
| `netSales` | Suma de `order_items.subtotal` snapshot de esas líneas; coincide con bruto menos descuento conforme al contrato 08. El cliente no recalcula este valor desde catálogo vigente. |
| `unitsSold` | Suma de `quantity` para las mismas líneas servidas. |
| `orderCount` | Número de órdenes distintas en estado `served` con al menos una línea incluida; contar órdenes una vez. |
| `collectedAmount` | Suma de pagos registrados en el día de pago del período, agregados una vez desde `payments`; no equivale a ventas del día. |
| `collectedByMethod` | Suma de `payments.amount` por método y día de `payments.created_at`, sin join multiplicador a líneas. |
| `allocatedAmount` | Suma de asignaciones del mismo conjunto de pagos; concilia los cobros a líneas, no es una segunda suma de ingreso. |
| `orderChargedAmount` | Suma de asignaciones de pago a las líneas de una orden; no depende del día en que se recibió el pago. |
| `orderPendingAmount` | Para órdenes `served`, `order.total - orderChargedAmount`. Para órdenes no servidas/canceladas es cero: no representan saldo cobrable en este reporte. |

Las órdenes `cancelled`, `pending`, `confirmed`, `preparing` y `ready` no cuentan como ventas servidas. Las canceladas no se presentan como ventas negativas. Órdenes sin líneas no suman venta y no incrementan `orderCount`. Si existen importes/relaciones inconsistentes, la consulta debe fallar o señalar error de integridad; no ocultarlos como cero.

### Agrupación de mesa

Un grupo usa el nombre snapshot histórico de mesa si está disponible en los datos; el esquema descrito por los contratos no confirma un snapshot de nombre de mesa en la orden/sesión. Por tanto, mientras no exista tal columna, `tableName` es el nombre actual de `cafe_tables` y el resultado debe incluir `tableId` para identidad. Renombrar una mesa puede cambiar la etiqueta histórica; no afirmar que el nombre es histórico.

`Para llevar` se incluye como mesa/operación compartida solo si la fila existente `cafe_tables` puede identificarse sin ambigüedad por UUID configurado. No detectar por comparación difusa del nombre en cada request. La agregación no separa compradores de una sesión virtual compartida.

## Zona horaria y período

- Las fechas se interpretan como fechas locales de negocio (`YYYY-MM-DD`), no como instantes UTC ni por zona horaria del navegador.
- El servidor debe tener un ajuste IANA obligatorio `REPORTING_TIME_ZONE` (por ejemplo, `America/Mexico_City` solo si el negocio confirma esa zona). No hay zona operativa confirmada en los contratos/repositorio inspeccionados: se debe acordar y configurar antes de desplegar.
- Responder la zona aplicada en cada resultado. No aceptar una zona arbitraria enviada por el navegador. Cambiar la configuración requiere revisión porque puede cambiar la inclusión de transacciones cerca de medianoche.
- El rango es inclusivo en las fechas de negocio solicitadas, implementado como intervalo de instantes semiabierto: `>= inicio_local a UTC` y `< día_siguiente_al_fin_local a UTC`. Usar la conversión de zona horaria IANA del servidor, incluyendo cambios de horario estacional, no sumar 24 horas fijas a instantes.
- `fromDate` y `toDate` son fechas ISO válidas con `fromDate <= toDate`; máximo 366 días calendario por llamada. Fechas futuras se permiten solo hasta el día actual de negocio inclusive.
- `sales` agrupa por día local de `orders.created_at`. Las métricas `collections` agrupan por día local de `payments.created_at` y, si se exponen junto a ventas, quedan bajo sección aparte claramente identificada. No distribuir un pago a fecha de venta ni atribuir cobros históricos a la fecha de orden.

## Permisos

El alcance analítico es más amplio que consultar una cuenta y requiere permiso explícito de reporting. Propuesta mínima:

| Operación | admin | cashier | waiter | anon |
|---|---:|---:|---:|---:|
| Leer reporte agregado de ventas/cobros | Sí | Sí | No | No |

La autorización debe comprobar en servidor JWT válido y perfil `profiles.active = true`, con rol `admin` o `cashier`. `waiter` conserva las lecturas operativas de contratos 06/08, pero no recibe por ello permiso de reporte agregado. No filtrar datos personales ni exponer `received_by`/`created_by` en la respuesta inicial. No hacer una llamada REST abierta a tablas para construir agregados en navegador.

**Requiere verificación/aprobación:** RLS/grants actuales podrían permitir lectura de tablas a waiter; no deben tratarse como autorización suficiente para este reporte. La propuesta necesita función con `SECURITY INVOKER` y RLS correcta, o `SECURITY DEFINER` cuidadosamente restringida, `search_path` fijo, validación de perfil/rol/actividad y `EXECUTE` solo para `authenticated`, con autorización interna admin/cashier. Revocar ejecución a `PUBLIC`/`anon`. No se modifica SQL remoto en este contrato.

## Endpoint propuesto

RPC incremental de solo lectura:

```http
POST /rest/v1/rpc/get_sales_report
apikey: <publishable-key>
Authorization: Bearer <JWT admin/cashier activo>
Content-Type: application/json
Accept: application/json
```

Request:

```json
{
  "p_date_from": "2026-11-01",
  "p_date_to": "2026-11-30",
  "p_timezone": "America/El_Salvador",
  "p_table_id": null
}
```

Parámetros:

| Parámetro | Tipo | Obligatorio | Regla |
|---|---|---:|---|
| `p_date_from` | `date` ISO | Sí | Día local inicial inclusivo. |
| `p_date_to` | `date` ISO | Sí | Día local final inclusivo; máximo 366 días calendario. |
| `p_timezone` | Zona IANA | Sí | Debe coincidir con la zona aprobada/configurada para el negocio; no aceptar valores arbitrarios en producción. La propuesta SQL actual valida zonas existentes pero aún fija el valor de interfaz en El Salvador. |
| `p_table_id` | UUID o `null` | No | Filtro opcional por mesa. |

El RPC de solo lectura limita el rango a 366 días e incluye la lista de órdenes del período para el reporte operativo. Revisar tamaño y paginación del detalle antes de producción si el volumen esperado puede generar respuestas grandes. No aceptar nombres de mesa libres como filtro.

Respuesta exitosa `200` (función puede devolver objeto JSON):

```json
{
  "date_from": "2026-11-01",
  "date_to": "2026-11-30",
  "timezone": "America/El_Salvador",
  "table_id": null,
  "orders_summary": { "order_count": 3, "charged_total": 80.00, "pending_total": 35.00 },
  "orders": [{
    "order_id": "00000000-0000-0000-0000-000000000001",
    "table_id": "00000000-0000-0000-0000-000000000000",
    "table_name": "Mesa 1",
    "created_at": "2026-11-27T18:00:00Z",
    "status": "served",
    "payment_status": "partial",
    "total": 50.00,
    "charged_total": 15.00,
    "pending_total": 35.00
  }],
  "sales": { "order_count": 3, "items_count": 6, "total": 115.00 },
  "collections": { "payment_count": 4, "total": 80.00 },
  "sales_by_day": [{ "date": "2026-11-27", "orders": 3, "sales_total": 115.00 }],
  "collections_by_day": [{ "date": "2026-11-27", "payments": 4, "collected_total": 80.00 }],
  "sales_by_table": [{ "table_id": "00000000-0000-0000-0000-000000000000", "table_name": "Mesa 1", "orders": 3, "sales_total": 115.00 }],
  "collections_by_method": [{ "method": "cash", "payments": 4, "collected_total": 80.00 }],
  "products": [{ "product_name": "Café", "quantity": 6, "sales_total": 115.00 }]
}
```

`orders` incluye todas las órdenes creadas en el rango (incluidas las canceladas) y filtra por mesa. `orders_summary.charged_total` y `pending_total` suman únicamente órdenes `served`; sus cobros se derivan de `payment_allocations` conciliadas con pagos de la misma sesión, sin importar la fecha del pago. Órdenes no servidas y canceladas conservan su total/estado para contexto, pero no se reportan como cobrables. `sales` agrupa órdenes servidas por fecha local de `orders.created_at`. `collections` agrupa pagos por fecha local de `payments.created_at`. Son métricas distintas: no atribuir cobros a la fecha de venta. `sales_by_table` agrupa el período completo por mesa; `sales_by_day` agrega por día; `products` usa snapshot del nombre de línea y se presenta como reporte separado. Un rango/mesa sin datos devuelve arreglos vacíos y totales cero. No se incluyen datos personales ni asignaciones individuales.

## Errores y recuperación

Propuesta de error estable:

```json
{ "code": "INVALID_REPORT_RANGE", "message": "El rango de fechas no es válido." }
```

| HTTP/código | Acción de cliente |
|---|---|
| `401 UNAUTHENTICATED` | Renovar una vez según contrato 01; luego volver a login. |
| `403 REPORT_FORBIDDEN` / `42501` | Mostrar permiso insuficiente; no intentar leer tablas directamente como fallback. |
| `422 INVALID_REPORT_RANGE` | Corregir fechas/rango; no enviar automáticamente. |
| `422 INVALID_REPORT_FILTER` | Corregir UUID/filtro/grupo/límite. |
| `422 REPORT_TIME_ZONE_NOT_CONFIGURED` | Bloqueo de configuración del servidor; escalar, no usar zona local del navegador. |
| `409 REPORT_CURSOR_MISMATCH` | Reiniciar desde la primera página con los mismos filtros. |
| `500 REPORT_DATA_INTEGRITY_ERROR` | Mostrar fallo de datos y correlación segura si existe; no mostrar totales parciales. |
| Red, timeout, `5xx` | Reintento explícito; al ser lectura, puede repetirse con los mismos filtros/cursor. |

No mostrar SQL, JWT, headers, respuesta cruda ni información personal. No transformar error de red o parser en reporte vacío.

## Volumen y consistencia

- La respuesta inicial incluye todas las órdenes del rango para que los totales y el detalle se muestren juntos; no pagina este detalle. Evaluar el tamaño máximo de respuesta con datos reales de staging antes de aprobar la propuesta.
- No descargar tablas transaccionales ni construir reportes en el navegador. Si el volumen excede el presupuesto acordado, diseñar paginación remota de órdenes y totales autoritativos antes de producción.
- La consulta debe agregar a nivel correcto (línea, orden, pago) antes de combinar dimensiones; probar pago mixto y una sola orden con muchas líneas para detectar multiplicación.

## Propuesta incremental de backend (no implementar aquí)

1. Revisar esquema y grants efectivamente aplicados en un entorno de desarrollo/staging; las propuestas o contratos locales no prueban despliegue remoto.
2. Diseñar y revisar migración versionada con RPC `get_sales_report`, sólo lectura, sin tablas nuevas ni escrituras. Acordar `REPORTING_TIME_ZONE`, permisos admin/cashier, semántica de líneas y envelope final antes de implementarla.
3. Implementar agregados separados: ventas desde órdenes servidas/líneas snapshot por fecha de creación; cobros desde pagos por fecha de recepción y método; asignaciones en agregado independiente para conciliación. Proteger con RLS/validación server-side y grants mínimos.
4. Añadir pruebas SQL de roles/fechas/bordes de medianoche/DST/rango/límites/paginación, estados y reconciliación; comparar resultados con consultas manuales controladas en staging.
5. Aplicar migración solo tras aprobación del responsable; no ejecutar cambios contra remoto como parte de este contrato.

No usar `SECURITY DEFINER` sin revisión de `search_path`, privilegios, control de rol/actividad y posibles canales de fuga. Si el volumen es pequeño y RLS/grants permiten consulta segura, una vista puede ser opción posterior; no hacer varios REST selects de todas las tablas y agregar en React.

## Criterios de aceptación y pruebas

1. Casos `served`, `cancelled`, estados activos, descuentos, cantidades y órdenes vacías verifican las definiciones exactas de bruto/neto/unidades/órdenes.
2. Una orden con muchas líneas y un pago asignado a múltiples líneas/pedidos no multiplica ingresos ni pagos.
3. Pago parcial de otro día se contabiliza como cobro por fecha de pago, separado de venta por fecha de orden.
4. Probar inicio inclusivo y fin exclusivo con eventos justo antes/después de medianoche local y cambio de horario estacional de la zona configurada.
5. Admin/cashier activos autorizados; waiter, usuario inactivo, anon y JWT ausente/revocado denegados por servidor; no hay fallback REST.
6. Fecha malformada, rango invertido/largo, UUID, cursor, límite, timezone ausente y dato inconsistente producen error estable sin datos parciales.
7. El detalle de órdenes, su conteo y totales se generan con los mismos filtros y fechas; probar el tamaño máximo de respuesta en staging.
8. Sin filas se devuelve vacío válido; error de red/parser no se presenta como vacío.
9. Resultados manuales de staging concilian con órdenes/líneas/pagos/asignaciones y el contrato 08; los importes cobrados/pendientes por orden concilian incluso cuando el pago se registró otro día. No afirmar cobertura de reembolsos o corte.

## Limitaciones explícitas

- No hay zona horaria operativa confirmada: requiere decisión/configuración antes de liberar reportes.
- No está confirmado en este checkout un endpoint Supabase de reportes ni su aplicación en ambiente remoto.
- El snapshot histórico del nombre de mesa y un UUID configurado de `Para llevar` no están garantizados por los contratos existentes.
- Reembolsos, turnos y cortes requieren contratos y cambios de backend independientes.
- Este contrato no altera SQL, frontend ni datos remotos.
