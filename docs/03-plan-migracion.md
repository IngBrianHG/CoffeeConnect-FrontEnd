# Plan de migración incremental

## Principios para desplegar rápido sin arriesgar ventas

- Proyecto Supabase nuevo y entorno staging primero; MySQL/Express continúa siendo la fuente de verdad hasta completar conciliación y pruebas.
- Cada etapa tiene contrato, prueba de salida y mecanismo de reversión. No mezclar cambio de base, autenticación y UX de cobro en un único corte.
- El SQL es esquema inicial para PostgreSQL. Datos de MySQL requieren exportación, mapeo y script de importación separado; preservar IDs antiguos en columnas `legacy_id` durante la transición si se necesitan reconciliar.

## Etapa 1 — Proyecto Supabase, seguridad y esquema

1. Crear una organización/proyecto Supabase de staging; definir región cercana al personal y zona horaria operativa.
2. Guardar Project URL y publishable/anon key en un gestor de secretos local/CI. Desactivar el registro público de Auth; crear usuarios de prueba desde el módulo administrativo, que obtiene la contraseña inicial de `staff-users`.
3. Aplicar `docs/sql/001_supabase_schema.sql` mediante SQL Editor para el primer staging; en seguida versionarlo y ejecutarlo desde Supabase CLI en entornos futuros.
4. Probar restricciones, RPC y RLS con anon y perfiles de los tres roles. Invitar al primer administrador desde Auth (el trigger lo crea con rol seguro `waiter`) y promover su UUID desde SQL Editor/entorno confiable: `update public.profiles set role = 'admin' where id = '<auth-user-uuid>';`. Nunca conceder el rol desde `user_metadata` ni el navegador.
5. Cargar categorías/mesas/ingredientes/productos de prueba. Importar datos reales solo después de respaldar MySQL y acordar mapeo de IDs, estados, zonas horarias y pagos.

**Contrato / salida:** tablas, enums, constraints, RLS y RPC disponibles; pruebas demuestran que anon lee menú pero no lista pedidos, y que pedido/cobro no permiten stock negativo ni sobrepago. No exponer `service_role`.

## Etapa 2 — Contratos y transporte REST del frontend

1. Conservar Vite + React + TypeScript y usar `fetch` nativo; no instalar SDK, ORM ni cliente de base de datos. Variables públicas: URL base del proyecto y publishable key; nunca `service_role`.
2. Mantener contratos en `frontend/contracts/` y separar transporte común (`baseUrl`, headers, bearer token, serialización y errores normalizados) de servicios por dominio.
3. Los componentes dependen de interfaces/tipos propios, no de URLs Supabase, PostgREST ni respuestas crudas.
4. Migrar un dominio a la vez, empezando por lecturas de catálogo de bajo riesgo; no cambiar todo `services/api.ts` de una vez.
5. Añadir pruebas del transporte y servicios con `fetch` simulado; conservar lint, `tsc` y build.

**Contrato / salida:** hay un adaptador REST probado y los módulos nuevos no dependen de detalles del proveedor.

## Etapa 3 — Autenticación y rutas protegidas

El flujo REST está implementado en `src/services/auth.ts`, `src/auth/AuthContext.tsx` y `src/App.tsx`. Cerrar el contrato `frontend/contracts/01-autenticacion-y-sesion.md` probando restauración/refresh de sesión, perfil/roles, logout, inactividad y navegación directa en navegador.

**Contrato / salida:** sesión Supabase se restaura y valida; `localStorage.userInfo`/JWT propio dejan de ser autoridad.

## Etapa 4 — Módulos en orden de dependencia

La secuencia de contratos frontend está en `frontend/contracts/README.md`. Los contratos 03 (usuarios/roles), 04 (inventario/recetas) y 05 (productos/categorías/promociones) ya tienen implementación frontend; sus integraciones y criterios de aceptación deben verificarse en staging. El contrato 06 (mesas/sesiones, etapa 4.4) tiene implementación frontend local, pero su cierre sigue pendiente de staging y de resolver la brecha SQL de desactivación con sesión abierta. El contrato 07 (órdenes kiosco/POS, etapa 4.5) ya está definido en `contracts/07-ordenes-kiosco-pos.md`; implementarlo después de cerrar esos pendientes de 06. Completar también la integración del kiosco y la validación de staging antes de cerrar el contrato 02.

### 4.1 Usuarios y roles

Desde la app, listar/crear personal, editar nombre/rol, activar/inactivar y eliminar; las operaciones Auth administrativas pasan por `staff-users`, que valida JWT y rol admin activo. La contraseña inicial se genera y devuelve una sola vez por el backend. La `service_role` permanece solo en secretos del servidor. No permitir alterar, eliminar ni inactivar la cuenta admin protegida. Confirmar políticas por rol desde API y UI.

### 4.2 Inventario y recetas

CRUD de ingredientes, selector cerrado `g/ml/unit`, mínimos, entradas/mermas/conteos por RPC y libro de movimientos. Editor de receta opcional por producto. Confirmar que actualizar receta no altera snapshots de órdenes históricas.

### 4.3 Productos y menú

CRUD de categorías/productos; imagen en Supabase Storage con bucket y políticas propias. El stock de producto solo se ajusta para productos sin receta; para recetas, disponibilidad es calculada por ingrediente. Portar promos server-side antes de publicar descuentos.

### 4.4 Mesas y sesiones

CRUD de mesas/estados, abrir sesión; un solo turno abierto por mesa. Kiosco QR usa UUID de mesa, no nombre/número predecible. La mesa debe tener sesión abierta para aceptar órdenes.

### 4.5 Órdenes

Kiosco/POS envía líneas con `product_id`, cantidad y nota, además de idempotency key. Mostrar pendientes al personal. Personal confirma (momento del descuento), avanza preparación/listo/servido y cancela con motivo antes de iniciar preparación; una orden ya en preparación/lista/servida requiere un flujo explícito de desperdicio/devolución, no una reversión automática del stock consumido.

### 4.6 Cobros

Diseñar pantalla de cuenta con saldo por artículo, selección de líneas/importes, pagador y método; permitir varias personas/métodos y cobros parciales. `record_session_payment` valida que la suma asignada no exceda saldos; se libera mesa únicamente cuando no hay órdenes activas y toda línea servida está pagada.

**Contrato / salida:** un flujo E2E: abrir mesa → kiosco/POS crea → confirmar descuenta → preparar/servir → dos pagos con métodos distintos → cuenta saldada → mesa disponible. Añadir casos sin stock, doble click/reintento, cancelación y pago concurrente.

## Etapa 5 — Reportes, datos y corte

1. Portar reportes desde pagos/asignaciones con filtros por fecha y zona horaria, validar contra totales MySQL.
2. Ejecutar importación en staging con snapshot real anonimizado; mapear int IDs a UUID (guardar `legacy_id` si se requiere conciliación), `delivered→served`, estados de mesa en mayúsculas a enums destino, `admin/cajero/mesero→admin/cashier/waiter`, métodos de pago español a enums destino y unidades existentes a `g/ml/unit` con conversión documentada.
3. Conciliar conteos, saldos de inventario, pedidos abiertos, descuentos y pagos históricos.
4. Lanzamiento controlado: backup final, detener escrituras en MySQL, importar delta final, habilitar React/Supabase por entorno/feature flag y observar errores/volumen.
5. Mantener mecanismo de rollback: DNS/hosting vuelve a build anterior y MySQL congelado permanece disponible para lectura durante ventana acordada.

**Criterio de producción:** RLS revisado; e2e de roles, orden e inventario y pagos; backup y restauración probados; alertas mínimas; conciliación firmada por negocio. El sistema actual no pasa a producción final solo por compilar el frontend.

## Pruebas mínimas por cambio

- Unitarias: reglas promocionales, conversión de unidad, formato monetario y validadores.
- Integración PostgreSQL: RLS por rol, inventario concurrente, idempotencia, rollback de RPC, transiciones de estado y asignaciones de pago.
- E2E navegador: kiosk móvil/QR, POS, preparación, división de cuenta, refresh/re-login.
- Seguridad: anon no consulta perfiles, órdenes, movimientos o pagos; un waiter no modifica roles/catálogo; ninguna clave privilegiada está en `dist`.
- Operación: backup/restore, límites de Supabase y alerta ante fallos de RPC, Auth o conexiones.
