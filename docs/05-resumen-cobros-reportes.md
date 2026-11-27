# Resumen de estado: cobros, caja y reportes

**Propósito:** aclarar qué existe antes de ampliar el flujo de cobro o iniciar reportes.  
**Alcance de esta revisión:** código y SQL versionados en este checkout. No se consultó una instancia remota de Supabase/MySQL; el SQL local no demuestra por sí solo qué migraciones están aplicadas en producción.

## Resumen ejecutivo

- El cobro destino ya no es únicamente una acción global por mesa: desde **Mesas y Sesiones** se abre una cuenta por sesión con pagos parciales y asignaciones por línea. El servicio usa `record_session_payment`; la cuenta carga pedidos, líneas, pagos y asignaciones y deriva saldos.
- La pantalla de reportes sí está implementada en el frontend (filtros por día/rango, KPI y desglose de productos), pero consume `GET /pagos/report` desde el cliente API heredado. No se encontró una implementación equivalente conectada al modelo Supabase actual.
- No hay tablas separadas de reportes. Deben ser consultas/proyecciones derivadas del ledger transaccional existente, no una segunda fuente de verdad. Se añadió una propuesta de RPC local para ese propósito; no está aplicada remotamente.
- Recomendación de navegación: separar **Caja** como módulo operacional (cuentas, cobros, historial del turno y cierre); dejar **Reportes** como módulo de consulta/análisis. No hace falta crear una aplicación o backend independiente.

## Estado funcional comprobable

| Área | Estado en el checkout |
|---|---|
| Cuenta por sesión | Implementada en `src/features/orders/accountService.ts` y `src/features/orders/components/SessionAccountPage.tsx`. |
| Pagos | RPC `record_session_payment`; soporta método, referencia/pagador y asignación a líneas. La carga paginada de pagos/asignaciones y el cálculo de saldo están en el servicio de cuenta. |
| Cierre/cancelación al cerrar | El contrato documenta el RPC `close_session_and_cancel_unserved_orders`; la migración está propuesta y requiere aprobación/pruebas en staging. El código local no demuestra que esté aplicada en producción. |
| Reportes legacy | `OrdersHistory.tsx` ofrece filtros por día/rango, KPI y desglose de productos; `src/services/api.ts` pide `/pagos/report`. Esto no prueba que esa ruta lea la base Supabase nueva. |
| Reportes Supabase | Contrato y primer módulo están en implementación local; la RPC SQL está propuesta en `docs/sql/proposals/010_sales_report_rpc.sql`. No se ha aplicado ni validado en Supabase. Validar zona horaria y totales contra datos reales sigue pendiente. |
| Base disponible | El esquema local sí define pagos, asignaciones, pedidos, líneas y snapshots de producto/precio; esas relaciones permiten construir reportes sin duplicar datos. |

## Tablas relacionadas y uso propuesto para reportes

> “No tocada” aquí significa que no se encontró consumida por una ruta de reportes conectada al modelo Supabase actual, no que la tabla no exista o no se use en operaciones. El reporte visible existente sí consume el endpoint heredado.

| Tabla | Papel actual / potencial de reporte | Estado de integración de reportes |
|---|---|---|
| `payments` | Fuente primaria de cobros: monto, método, fecha, cajero, sesión, referencia. Base para ingresos cobrados y cortes por método/turno. | No se encontró consulta de reportes destino. |
| `payment_allocations` | Vincula cada pago con las líneas saldadas; sirve para conciliar pagos con ventas y calcular saldo. Evita contar un pago más de una vez al unir líneas. | No se encontró consulta de reportes destino. |
| `order_items` | Snapshot de producto, cantidad, precio, descuento y subtotal; base para productos/unidades vendidos. | La cuenta sí la consume; reportes Supabase no. El reporte legacy presenta desglose de productos desde su endpoint. |
| `orders` | Estado, fecha, sesión, mesa y totales; segmentación de ventas por estado/origen si el origen queda registrado. | Operaciones sí; no se encontró acceso en servicio de reportes Supabase. |
| `table_sessions`, `cafe_tables` | Agrupar venta por visita, mesa, apertura y cierre; distinguir dine-in y `Para llevar` según el catálogo/mesa. | Operaciones sí; no se encontró acceso en servicio de reportes Supabase. |
| `profiles` | `created_by` / `received_by` permiten atribución a mesero/cajero; evitar exponer datos personales innecesarios. | No se encontró consulta de reportes destino. |
| `products`, `categories` | Dimensiones actuales para clasificar ventas; históricos deben usar snapshots de nombre/categoría si se necesita conservar clasificación pasada. | Catálogo operativo; reportes destino no. |
| `promotions` | Catálogo de reglas, no ledger de ventas. Para análisis histórico usar `order_items.promotion_name` y `discount_amount`, no asumir que la regla actual describe la venta histórica. | Sin reporte destino. |
| `inventory_movements` | Consumo, ajustes, mermas y reversas; base de informes de inventario/costo si se definen políticas de costo. No equivale a ingreso. | Inventario operativo; reporte analítico no identificado. |
| `ingredients`, `product_ingredients`, `order_item_recipe_lines` | Stock y recetas/snapshot de receta para consumo teórico; no bastan por sí solos para valorar costo histórico sin costo de compra versionado. | Inventario operativo; sin reporte destino. |
| `profiles`/roles, `categories`, `products` | Catálogos/dimensiones administrativas; deben ser filtros y no fuentes monetarias. | No corresponde generar ingresos directamente de estas tablas. |

## Decisiones de datos para reportes

1. Definir “venta” e “ingreso” de manera distinta: venta es el subtotal de líneas elegibles (por ejemplo servidas); ingreso/cobro es el importe registrado en `payments` y conciliado con asignaciones. Pagos parciales pueden caer en una fecha distinta a la venta.
2. Para ingresos por método/fecha, agregar `payments` en el nivel de pago, sin join directo con varias líneas, que multiplicaría el total. Para productos vendidos, partir de líneas elegibles; para ventas pagadas, usar asignaciones agregadas por línea.
3. Determinar zona horaria operativa y límites de fecha como rangos semiabiertos. Hoy el filtro legacy no demuestra consistencia de zona horaria.
4. Confirmar tratamiento de cancelaciones, descuentos, pagos mixtos, reembolsos y pagos sin asignación. El contrato actual excluye reembolsos; no reportar “neto” mientras no exista ledger compensatorio.
5. Mantener los reportes dentro de consultas/vistas/RPC con permisos de rol y RLS; evitar descargar todas las transacciones al navegador. No materializar/agregar tablas antes de medir volumen.

## ¿Conviene un módulo Caja?

**Sí, como separación funcional y de navegación, no como separación técnica/de base de datos.** Actualmente el cobro está dentro de **Mesas y Sesiones** (acción “Ver cuenta”), mientras los reportes son una pestaña del panel. Caja atendería tareas de alta frecuencia y sensibles a concurrencia: cuentas abiertas, órdenes cobrables, saldo, asignación de líneas, método de pago, confirmación, pagos recientes y cierre. Reportes serían una lectura posterior con filtros, totales y exportación.

Beneficios: reduce la sobrecarga del panel, facilita permisos `cashier`, centra la atención en cuentas abiertas y evita mezclar un pago autoritativo con métricas agregadas. Mantener `payments` y `payment_allocations` como ledger compartido; no crear tablas “caja” duplicadas.

## Mejoras sugeridas

- Antes del registro: mostrar total, saldo, método, asignaciones y contexto completo de la sesión; bloquear doble envío y preservar clave idempotente/payload ante timeout.
- Tras registrar: actualizar la cuenta desde servidor y distinguir claramente “pago registrado” de “no se pudo refrescar”. No repetir automáticamente un pago ambiguo.
- Para corte de caja: definir apertura/cierre de turno, saldo inicial, ingresos por método, retiros/entradas y diferencias contra efectivo contado. El esquema actual no contiene una entidad de turno/caja ni movimientos de efectivo; esto requiere decisión funcional y migración aprobada, no simularse con `payments`.
- Para reportes: implementar un contrato Supabase específico, filtros de periodo/método/cajero/canal, estados vacíos y exportación controlada; validar totales contra datos conocidos y contemplar paginación.
- Extraer las pantallas de `OrdersHistory.tsx` a módulos por dominio. El panel actual mantiene órdenes, POS, pagos y reportes dentro de un componente grande.
- Añadir pruebas de conciliación y totales, incluyendo pago mixto/parcial, varios pedidos, cancelados, cambio de día/huso y joins sin duplicación.

## Orden recomendado antes de avanzar

1. Confirmar en Supabase qué esquema y propuestas/migraciones están efectivamente aplicados; revisar permisos/RLS/RPC con roles reales. No ejecutar las propuestas automáticamente.
2. Cerrar el flujo de Caja: probar idempotencia, concurrencia, doble clic, timeout ambiguo, cierre y actualización posterior en staging.
3. Acordar definición del reporte y corte de caja (venta vs cobro, fecha, zona horaria, efectivo inicial, retiros, reembolsos).
4. Implementar reportes sobre `payments`/`payment_allocations`/`orders`/`order_items` con vista/RPC o consulta segura y contrastar resultados.
5. Separar navegación y vistas “Caja” y “Reportes”, conservando servicios y reglas de negocio compartidos; no duplicar el ledger ni la lógica de saldo.

## Referencias del repositorio

- `contracts/09-caja.md` — contrato del módulo Caja.
- `contracts/10-reportes.md` — contrato de reportes.
- `docs/sql/proposals/010_sales_report_rpc.sql` — RPC de consulta propuesta; requiere revisión, zona horaria confirmada y pruebas en staging antes de aplicar.
- `src/features/caja/CajaPage.tsx` y `src/features/reports/ReportsPage.tsx` — vistas iniciales de Caja y reportes en la interfaz.
- `docs/sql/001_supabase_schema.sql` — esquema base de PostgreSQL.
- `docs/02-arquitectura-datos-api.md` — topología, tablas, permisos y RPC.
- `contracts/08-cuenta-y-pagos.md` — contrato funcional de cuenta/pagos y fuera de alcance de reportes.
- `src/features/orders/accountService.ts` — lectura de cuenta y RPC de cobro.
- `src/pages/OrdersHistory.tsx` — panel administrativo, cobros/reportes.
- `src/services/api.ts` — endpoint heredado `/pagos/report`.
- `docs/plans/REDISENO_KIOSCO.md` — parte de UX, no sustituye especificación de Caja.
