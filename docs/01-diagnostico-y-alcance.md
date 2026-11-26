# Diagnóstico del proyecto y alcance funcional

## Estado actual

El checkout contiene dos aplicaciones separadas:

- `frontend/`: React 19, TypeScript, Vite y React Router. Tiene un kiosco QR para clientes y una aplicación administrativa en una sola pantalla grande (`OrdersHistory.tsx`).
- `backend/`: API REST Express 5 con controladores por dominio y MySQL (`mysql2`). Maneja JWT en cookie, roles, migraciones al iniciar, validación, promociones e inventario transaccional.
- `backend/database.sql` y `backend/migrations/`: esquema MySQL anterior. No son compatibles con PostgreSQL/Supabase y no deben ejecutarse en el proyecto destino.

El frontend ya aporta una base reutilizable de UI y comportamiento; no está listo para apuntar directamente a Supabase. Su capa `src/services/api.ts`, el login, los tipos numéricos del modelo MySQL y la verificación de sesión en `localStorage` están acoplados al backend anterior.

## Frontend: implementado y por completar

### Implementado

- Kiosco móvil QR `/user/:mesa_id`: carga menú/categorías, búsqueda, carrito responsive y envío de orden.
- Comentarios por línea, cantidades, promociones en carrito y mensajes de resultado.
- Panel administrativo con pestañas para pedidos, mesas/pagos, catálogo, POS, reportes, usuarios, promociones e inventario.
- Editor opcional de receta por producto y disponibilidad derivada de ingredientes.
- Refresco periódico de pedidos/mesas, errores básicos de carga y configuración de rutas para hosting estático.

### Parcial o faltante para la versión Supabase

- Migrar `services/api.ts` a servicios por dominio sobre Supabase REST/RPC; ahora consume rutas Express `/auth`, `/orders`, `/ingredients`, etc.
- Supabase Auth, sesión persistente, protección de rutas y recuperación de sesión. El login actual usa usuario/contraseña del backend; `ProtectedRoute` solo comprueba si existe una clave en `localStorage` y no valida el token/rol.
- Administración de usuarios crea empleados directamente mediante la Edge Function segura `staff-users`; la contraseña inicial la genera el backend y `service_role` nunca se expone en el cliente.
- El panel no evidencia CRUD completo de categorías/mesas, y el formulario de usuarios no ofrece el rol cajero aunque el backend sí lo contempla.
- El cobro actual es un solo método por mesa y una sola operación global; falta interfaz de cuenta dividida por artículo/persona, pagos parciales, varios métodos y saldo pendiente.
- El pago actual registra el método seleccionado, no se integra con una pasarela/procesador ni incluye flujo de devolución.
- La unidad de inventario actual es texto libre/datalist; debe ser un catálogo cerrado compartido por ingredientes, recetas y ajustes.
- El dashboard concentra estado y lógica en un único componente muy extenso; separar por módulos. Ocultar pestañas no sustituye autorización (el backend actual sí protege las operaciones API).
- Faltan pruebas automatizadas de componentes y recorridos completos; los documentos históricos confirman que no hubo validación de pagos/concurrencia contra una base real.

## Backend actual: piezas de negocio

- `auth`, `users`: sesión propia JWT/cookie y roles admin, cajero y mesero.
- `categories`, `products`: catálogo, precio, stock de producto sin receta e imágenes.
- `ingredients`, `product_ingredients`, `order_ingredient_usage`: existencias compartidas, recetas y devolución al cancelar.
- `orders`, `order_items`: pedido, líneas, notas, precios y estados.
- `promotions`: descuentos porcentuales y NxM por producto/categoría/menú.
- `Mesas`, `pagos`: mesas ocupadas/liberadas y agrupación de pedidos por mesa.
- Reportes: ingresos agrupados por método y productos vendidos.

El backend protege las operaciones críticas con transacciones MySQL y validación de existencias. Sin embargo, en el comportamiento actual el inventario se descuenta al crear un pedido (`ordersController.createOrder`); el nuevo flujo requerido lo descontará al confirmar el pedido por personal. Esa diferencia debe probarse explícitamente en la transición.

## Requerimientos funcionales del destino

1. **Identidad y permisos:** inicio/cierre de sesión con Supabase Auth; perfiles de personal con rol admin/cajero/mesero y políticas RLS.
2. **Usuarios:** creación directa por administrador con contraseña inicial generada por backend, edición, activación/inactivación y eliminación.
3. **Catálogo:** categorías, productos, precio, imagen, disponibilidad y stock propio para artículos sin receta.
4. **Recetas/inventario:** receta opcional por porción; descuento atómico al confirmar; alerta de mínimo; compras, conteos, vencimientos, derrames, daño y devoluciones con motivo/auditoría.
5. **Mesas:** estado y sesión de servicio que agrupa pedidos y pagos.
6. **Pedidos:** kiosco y POS crean pedido pendiente; personal confirma; preparación → listo → servido; cancelación solo si no cobrado y con reversión exacta de existencias.
7. **Cobros:** dividir la cuenta por líneas/importes/personas; registrar varios pagos y métodos en una sesión; evitar sobrepago y liberar mesa solo al saldarla y terminar los pedidos.
8. **Promociones y reportes:** conservar promociones y descuentos históricos; el precio final siempre debe calcularse en una capa confiable, nunca aceptar total del navegador.

## Requerimientos no funcionales

- **Seguridad:** `service_role` solo en servidor; RLS activado en todas las tablas expuestas; rol verificado en base de datos, validación de sesión, mínimo privilegio.
- **Integridad:** operaciones monetarias e inventario atómicas, bloqueo de filas, idempotencia en pedidos/pagos y libro de movimientos no editable desde el cliente.
- **Portabilidad:** componentes React consumen interfaces/repositorios de dominio; las dependencias específicas de Supabase se limitan a `services/` y RPC SQL.
- **Operación:** claves separadas por entorno, backups, migraciones versionadas, logs útiles, monitoreo y pruebas de recuperación.
- **Usabilidad:** UI móvil para kiosco y checkout rápido; estados de carga/error, accesibilidad y feedback para conflictos de inventario/pago.
- **Rendimiento:** índices en claves de consulta; paginación en historial/reportes; suscripciones en tiempo real solo donde aporte valor (cola de pedidos), no refresco global excesivo.

## Relaciones entre módulos

`Auth → profiles/roles → RLS → servicios UI`. `categories → products → (product_ingredients → ingredients)`. `cafe_tables → table_sessions → orders → order_items`; `orders → movimientos de inventario` y `table_sessions → payments → payment_allocations → order_items`. `promotions → precio/descuento snapshot en order_items`; reportes derivan de pagos y líneas cobradas.

El esquema destino añade `table_sessions` como unidad de visita: evita que varios pedidos y pagos de la misma mesa se mezclen con visitas anteriores. La cuenta y el estado de ocupación se calculan por sesión, no solo por `mesa_id`.
