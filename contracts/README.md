# Contratos de integración del frontend

Esta carpeta es la **fuente canónica de contratos de implementación** para migrar el frontend por etapas a Supabase REST, usando `fetch` nativo.

Los documentos de contexto y arquitectura permanecen en `frontend/docs/` y `docs/`. Si hay discrepancias, el contrato versionado aquí define el comportamiento del siguiente cambio de código; actualizar también el plan general cuando cambie una decisión arquitectónica.

## Contratos

1. [Autenticación y sesión](01-autenticacion-y-sesion.md) — login, perfil, persistencia, renovación, logout y acceso al dashboard. Implementado; queda la verificación de aceptación en staging.
2. [Transporte REST y lectura de catálogo](02-transporte-y-catalogo.md) — adaptador y servicios implementados; integración del kiosco y validación contra staging pendientes.
3. [Usuarios y roles](03-usuarios-y-roles.md) — crear empleados con contraseña inicial del backend, editar, activar/inactivar y eliminar mediante Edge Function protegida; la cuenta admin principal está protegida.
4. [Inventario y recetas](04-inventario-y-recetas.md) — ajustes solo por RPC y recetas atómicas con unidades base cerradas.
5. [Categorías, productos y promociones](05-productos-categorias-y-promociones.md) — administración autenticada; cálculo promocional sigue siendo autoridad del servidor.
6. [Mesas y sesiones](06-mesas-y-sesiones.md) — administración de mesas, apertura idempotente y cierre seguro de sesiones.
7. [Órdenes kiosco/POS](07-ordenes-kiosco-pos.md) — ciclo de vida de órdenes, stock previo en POS, mesa operativa `Para llevar`, estados e idempotencia.
8. [Cuenta de mesa y pagos](08-cuenta-y-pagos.md) — cuenta agrupada por sesión, pagos parciales/divididos entre pedidos y cierre seguro.
9. [Caja](09-caja.md) — listado operativo de sesiones abiertas y navegación a cuentas; reutiliza lectura y cobro del contrato 08. Implementación inicial local; requiere validar roles y flujo en staging.
10. [Reportes de ventas](10-reportes.md) — ventas por mesa y día/rango sobre snapshots y ledger existentes. Servicio y vista iniciales locales; RPC SQL propuesta sin aplicar.

Las pantallas/servicios locales de los contratos 09 y 10 no acreditan que la RPC propuesta esté aplicada ni que Supabase remoto, RLS, zona horaria o permisos hayan sido validados. Importación, conciliación, reembolsos y corte de caja siguen fuera de alcance.

## Flujo de trabajo para cada contrato

1. Definir alcance, endpoints, headers, modelos internos, permisos, errores y aceptación.
2. Implementar únicamente ese alcance en servicios adaptadores; no migrar módulos ajenos.
3. Probar solicitudes/excepciones (tests unitarios y staging Supabase según corresponda).
4. Verificar lint, TypeScript y build.
5. Actualizar el estado del contrato y el plan de migración con lo que realmente quedó probado.

No guardar credenciales reales, tokens, respuestas con datos personales ni la clave `service_role` en esta carpeta.
