# Contrato 03 — Gestión de personal y roles

**Etapa:** CRUD de personal.  
**Estado:** implementado en React y alineado con la Edge Function `staff-users` actual. La integración contra el entorno desplegado debe validarse allí.  
**Objetivo:** que el administrador gestione desde la app las cuentas que acceden al panel: crear, actualizar, activar/inactivar y eliminar meseros y cajeros. La cuenta administrativa principal está protegida. Los clientes del kiosco no son usuarios de este módulo.

## Decisión de seguridad: operación privilegiada en servidor

La aplicación React puede seguir usando `fetch` nativo, pero **no puede crear, eliminar ni administrar identidades de Supabase Auth directamente**. Las operaciones administrativas de Auth requieren privilegios equivalentes a `service_role`; incluir esa clave en el navegador permitiría tomar control del proyecto.

Por eso este contrato requiere una **Supabase Edge Function** como endpoint administrativo:

- La UI la consume como REST, con `fetch`, publishable key y `Authorization: Bearer <JWT del administrador>`.
- La función valida el JWT, consulta el perfil en servidor y exige `role = admin` y `active = true`. Nunca confía en el rol enviado por el cliente ni en `user_metadata`.
- La clave administrativa se guarda exclusivamente como secreto de la Edge Function y nunca llega al navegador, respuesta o log.
- La función usa la API administrativa de Supabase Auth mediante llamadas HTTP servidor-a-servidor; no es necesario instalar SDK/ORM en React.
- `verify_jwt` debe estar habilitado para la función y la función debe volver a verificar que el usuario llamante sea el admin autorizado.
- El UUID de la cuenta administrativa protegida se configura de forma confiable en servidor (`PROTECTED_ADMIN_USER_ID` o equivalente); la comprobación debe aplicarse al modificar, dar de baja o eliminar.

**No implementar estas operaciones llamando directamente a `/auth/v1/admin/...` desde React.**

## Reglas de negocio

- Los perfiles gestionables desde la app son solo personal: `waiter` (mesero) y `cashier` (cajero).
- El cliente del kiosco no necesita cuenta Auth: sus pedidos públicos usan el flujo separado del kiosco.
- En esta pantalla no se puede crear otro `admin`, cambiar el rol del administrador protegido, desactivarlo ni borrarlo.
- La baja ordinaria usa `active=false` (baja lógica), conservando perfil, pedidos y atribución de auditoría.
- Se permite eliminación permanente solo para cuentas `waiter`/`cashier`, con confirmación explícita. Auth elimina la identidad y `profiles` se elimina por FK cascade; las filas históricas se conservan, pero sus referencias al usuario quedan en `NULL`. La UI debe advertir la pérdida de atribución antes de confirmar.
- Activar/inactivar cambia únicamente `profiles.active`. La Edge Function actual no invalida sesiones al inactivar; la autorización de las operaciones protegidas debe seguir aplicándose en el servidor/RLS.
- El alta crea directamente la cuenta y devuelve la contraseña inicial generada por el backend solo en la respuesta exitosa de creación. La aplicación no genera ni persiste la contraseña.
- La contraseña inicial se presenta en un modal de una sola ocasión y se descarta de memoria al cerrar. No se incluye en el listado, no se almacena en `localStorage`/`sessionStorage` y no se registra.
- Esta etapa no implementa cambio obligatorio, recuperación ni restablecimiento de contraseña. `must_change_password` permanece en `false` y no participa en guardas o redirecciones.
- No permitir que el administrador protegido se dé de baja a sí mismo ni cambie su propio rol.

## Recursos HTTP de la Edge Function

Base:

```text
GET   {SUPABASE_URL}/functions/v1/staff-users?limit=100
POST  {SUPABASE_URL}/functions/v1/staff-users
PATCH {SUPABASE_URL}/functions/v1/staff-users/{auth-user-uuid}
DELETE {SUPABASE_URL}/functions/v1/staff-users/{auth-user-uuid}
```

Headers comunes:

```http
apikey: <publishable-key>
Authorization: Bearer <admin-access-token>
Content-Type: application/json
Accept: application/json
```

No llamar endpoints administrativos de Auth desde el navegador. La baja es la opción habitual; el borrado permanente solo se permite para personal no protegido mediante el endpoint privilegiado.

### Listar empleados

La misma ruta `GET` debe devolver solo perfiles gestionables:

```http
GET {SUPABASE_URL}/functions/v1/staff-users?limit=100
```

Respuesta `200` (puede incluir `nextCursor` si el backend pagina):

```json
{
  "data": [
    {
      "id": "<uuid>",
      "email": "mesero@example.com",
      "displayName": "Nombre del mesero",
      "role": "waiter",
      "active": true,
      "createdAt": "2026-11-24T12:00:00Z",
      "mustChangePassword": false
    }
  ],
  "nextCursor": null
}
```

`profiles` no almacena el email; la función lo obtiene de Auth Admin y lo combina por UUID. Nunca devuelve usuarios de Auth que no tengan perfil de personal gestionable ni datos de clientes.

### Registrar empleado

```http
POST {SUPABASE_URL}/functions/v1/staff-users
```

```json
{
  "email": "mesero@example.com",
  "displayName": "Nombre del mesero",
  "role": "waiter"
}
```

`role` acepta exclusivamente `waiter` o `cashier`. El backend genera la contraseña inicial, crea directamente la identidad en Supabase Auth, confirma administrativamente el correo y crea el perfil con `must_change_password=false`. No se envía correo de invitación y la contraseña nunca se genera en el frontend.

Respuesta `201`:

```json
{
  "data": {
    "id": "<uuid>",
    "email": "mesero@example.com",
    "displayName": "Nombre del mesero",
    "role": "waiter",
    "active": true,
    "createdAt": "fecha ISO",
    "mustChangePassword": false,
    "temporaryPassword": "solo en la respuesta de creación"
  }
}
```

El correo ya registrado responde `409 EMAIL_ALREADY_REGISTERED`. `temporaryPassword` se devuelve exclusivamente en esta respuesta y nunca en GET, PATCH, logs ni almacenamiento del cliente.

### Actualizar perfil/rol

```http
PATCH {SUPABASE_URL}/functions/v1/staff-users/<uuid>
```

```json
{
  "displayName": "Nombre actualizado",
  "role": "cashier"
}
```

Aceptar solo `displayName`, `role` o `active` (todos opcionales; al menos uno requerido); rechazar campos desconocidos y todo intento de alterar la cuenta protegida o asignar el rol `admin`. Para dar de baja/reactivar se envía únicamente `{ "active": false }` o `{ "active": true }`. El servidor valida la cuenta destino y responde la entidad actualizada.

### Dar de baja / reactivar

```http
PATCH {SUPABASE_URL}/functions/v1/staff-users/<uuid>
```

Baja:

```json
{ "active": false }
```

Reactivación:

```json
{ "active": true }
```

La función actualiza `profiles.active`; no invalida sesiones Auth en esta etapa. No cambia ni elimina pedidos, pagos, movimientos u otras referencias históricas. La cuenta administrativa principal no puede modificarse.

### Eliminar empleado

```http
DELETE {SUPABASE_URL}/functions/v1/staff-users/<uuid>
```

Solo para mesero/cajero y después de confirmación explícita. La Edge Function valida el rol destino y el UUID protegido; elimina la identidad mediante Auth Admin y deja que las FK hagan cascade a `profiles` y `SET NULL` a referencias de auditoría. No eliminar pedidos, pagos ni movimientos. Responder `204 No Content`. Si se necesita conservar el vínculo histórico con una persona, usar baja lógica en vez de eliminación.

## Modelo de dominio para React

```ts
export type StaffRole = 'waiter' | 'cashier';

export interface StaffUser {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  active: boolean;
  createdAt: string;
  mustChangePassword: boolean;
}

export interface CreateStaffResponse {
  data: StaffUser & { temporaryPassword: string };
}

export interface StaffUsersService {
  list(options?: { limit?: number; cursor?: string }): Promise<{
    data: StaffUser[];
    nextCursor: string | null;
  }>;
  create(input: {
    email: string;
    displayName: string;
    role: StaffRole;
  }): Promise<CreateStaffResponse['data']>;
  update(id: string, changes: { displayName?: string; role?: StaffRole; active?: boolean }): Promise<StaffUser>;
  setActive(id: string, active: boolean): Promise<StaffUser>;
  delete(id: string): Promise<void>;
}
```

El servicio React llama a `GET` con `limit=100`, a `POST` en la ruta base y a `PATCH`/`DELETE` en `/{encodeURIComponent(id)}`. Envía `apikey` y `Authorization: Bearer <access-token>` en cada solicitud. Trata `204 No Content` como éxito sin parsear JSON. Los componentes no deben llamar a la Edge Function desde múltiples lugares ni decidir permisos a partir de datos editables localmente.

## Errores del contrato

Usar una respuesta estable y segura:

```json
{
  "error": {
    "code": "PROTECTED_ADMIN",
    "message": "No se puede modificar la cuenta administrativa protegida."
  }
}
```

Códigos mínimos:

- `401 UNAUTHENTICATED`: JWT ausente, inválido o expirado.
- `403 ADMIN_REQUIRED`: usuario no es admin activo.
- `404 STAFF_USER_NOT_FOUND`: UUID no corresponde a personal gestionable.
- `409 EMAIL_ALREADY_REGISTERED`: email ya existe en Auth.
- `409 PROTECTED_ADMIN`: intento de modificar/dar de baja la cuenta protegida.
- `409 USER_HAS_ADMIN_ROLE`: la cuenta destino no es personal gestionable.
- `422 INVALID_STAFF_ROLE` / `422 INVALID_INPUT`: rol o campos no permitidos.
- `502 AUTH_ADMIN_FAILURE`: fallo del servicio Auth administrativo; no filtrar respuesta interna ni secreto.

Al fallar, no aplicar actualizaciones optimistas; preservar el estado visible y permitir reintentar solo operaciones seguras.

## Criterios de aceptación y seguridad

1. Admin puede crear mesero/cajero y ver la contraseña inicial generada por el backend una sola vez.
2. Admin puede cambiar nombre/rol de personal, darlo de baja/reactivarlo y eliminarlo desde la app.
3. No se puede crear otro admin ni alterar, eliminar o desactivar la cuenta protegida; la regla se valida en servidor, no solo en UI.
4. Un waiter/cashier recibe `403` incluso si llama la Edge Function directamente.
5. Las operaciones de activación/inactivación actualizan el listado; la inactivación no invalida sesiones en esta etapa.
6. Borrado permanente solo aplica a personal no protegido; los registros operativos se conservan y la UI advierte que se pierde atribución.
7. Los fallos de creación no muestran una contraseña ni almacenan credenciales parcialmente.
8. No hay `service_role` en Vite, `dist`, respuestas de red o logs.
9. Tests de la función cubren roles, cuenta protegida, duplicados, fallos de Auth y borrado.
10. Tests de servicio/UI cubren formulario, paginación, errores y estados activos/inactivos; pasan lint, `tsc` y build.

## Relación con la autenticación de empleados

La autenticación de inicio de sesión no cambia en esta etapa: los empleados siguen usando Supabase Auth con email y contraseña, y el frontend conserva su flujo REST actual (`grant_type=password`) y validación del perfil. Lo que cambió es el aprovisionamiento administrativo: `staff-users` crea la identidad directamente y el backend entrega al administrador la contraseña inicial en la respuesta de creación. No hay invitación por correo ni flujo de cambio obligatorio asociado a `must_change_password`.

## Fuera de alcance

- Gestión de clientes del kiosco o cuentas de clientes.
- Borrado físico del administrador protegido o de clientes del kiosco.
- Crear/editar otros administradores desde la app.
- Cambio, recuperación o restablecimiento de contraseñas.
