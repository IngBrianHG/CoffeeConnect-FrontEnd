# Despliegue rápido y operación

## Entornos y variables

Crear por separado proyectos Supabase `staging` y `production`. En React (`.env.local`, nunca versionado):

```dotenv
VITE_API_BASE_URL=https://<project-ref>.supabase.co
VITE_API_PUBLIC_KEY=<publishable-key>
```

`.env.example` puede incluir nombres y valores ficticios. Las variables `VITE_*` se compilan y son públicas: solo se permite la clave publishable/anon protegida por RLS. `service_role`, contraseñas de MySQL y secretos de Auth se guardan fuera del frontend.

## Despliegue de la UI

1. Hosting estático recomendado para salida rápida: Vercel o Netlify.
2. Directorio de aplicación: `frontend`; build `npm ci && npm run build`; salida `dist`.
3. Definir las dos variables públicas de Supabase en el entorno del proveedor y reconstruir.
4. Configurar fallback SPA para rutas profundas (`/user/<uuid>` y `/admin/...`) a `index.html`.
5. HTTPS obligatorio. Probar refresco de rutas, móvil, red lenta, login/logout y conexión al proyecto correcto.

## Supabase

- Aplicar schema y siguientes cambios con migraciones versionadas; evitar cambios manuales no reflejados en Git.
- Activar Auth; restringir el registro público y gestionar las cuentas de empleados mediante `staff-users`.
- Configurar políticas de contraseña, expiración de sesión y MFA para administradores si está disponible.
- Configurar backups/PITR según el plan; verificar restauración, no solo que el backup exista.
- Configurar alertas de Auth, errores de base/RPC, uso/capacidad y límites del proyecto.
- Las escrituras del kiosco se exponen por RPC pública y deben tener una capa de protección contra abuso (rate limit/CDN/WAF o Edge Function) antes de compartir QR públicamente.

## Verificación antes de abrir puertas

- [ ] El SQL se aplicó en el proyecto correcto y no contiene datos/credenciales productivas.
- [ ] Admin, cajero y mesero pueden iniciar sesión; un usuario inactivo pierde acceso.
- [ ] Anon puede leer solo categorías/productos/promos activas y crear pedido solo para una mesa con sesión abierta.
- [ ] Dos confirmaciones simultáneas no venden el mismo stock; stock insuficiente falla sin efectos parciales.
- [ ] Cancelar pedido revierte exactamente lo consumido y no se permite cancelar líneas ya pagadas.
- [ ] Una orden en preparación/lista/servida no devuelve existencias automáticamente al cancelarse; registrar desperdicio por el flujo de inventario.
- [ ] Pago en efectivo + tarjeta/transferencia, pagos parciales, reintentos idempotentes y exceso de pago están cubiertos.
- [ ] El dashboard de reportes concilia montos y fecha/huso horario.
- [ ] Se probó backup y restauración; hay dueño operativo, canal de soporte y rollback.
- [ ] `npm audit` está limpio o se documentó y aceptó cada excepción temporal; no desplegar el backend MySQL auditado sin corregir sus dependencias vulnerables.

## Línea base de verificación del checkout

- Backend: `npm test` aprobó 20 pruebas unitarias de helpers de inventario/promociones; no prueba rutas, MySQL, concurrencia ni Supabase.
- Frontend: tras `npm ci`, `npm run build` y `npm run lint` terminaron correctamente.
- No se encontró `psql` ni Docker en el entorno de revisión; el SQL de PostgreSQL no se ejecutó contra un proyecto Supabase y sus políticas/RPC aún requieren validación real.
- `npm audit` reportó vulnerabilidades pendientes: auditoría backend incluye una crítica transitiva (`proxy-addr`) y hallazgos altos, incluida `mysql2`; auditoría frontend de producción reporta dos hallazgos en `react-router`/`react-router-dom`. Re-ejecutar auditoría al momento de desplegar y actualizar/validar dependencias, especialmente si el backend anterior seguirá expuesto durante el corte.

## Límite del alcance del SQL inicial

`docs/sql/001_supabase_schema.sql` crea las tablas, constraints, RLS y RPC críticas para Auth, sesión de mesa, pedido, confirmación/cancelación, ajustes de existencias y cobro dividido. No importa filas desde MySQL, no crea usuarios de Auth ni imágenes, y la RPC inicial no aplica promociones NxM/porcentaje. Esos trabajos deben terminar y validarse antes de un corte funcional completo.
