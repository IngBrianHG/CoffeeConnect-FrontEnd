> **Documento de contexto conservado.** La versión canónica y vigente del contrato está en [`frontend/contracts/01-autenticacion-y-sesion.md`](../contracts/01-autenticacion-y-sesion.md). Para el siguiente paso de implementación, consultar también [`02-transporte-y-catalogo.md`](../contracts/02-transporte-y-catalogo.md). No editar este duplicado: actualizar el contrato canónico.

# Contrato 1 — Inicio de sesión con Supabase Auth REST

**Estado:** contrato inicial para la primera etapa de migración del frontend.  
**Alcance:** iniciar sesión con una cuenta ya creada en Supabase y permitir entrar al área administrativa únicamente si su perfil está activo. No implementa registro, recuperación de contraseña ni otros módulos.

## Decisiones de integración

- Consumir Supabase directamente con `fetch` del navegador; no instalar ORM ni `@supabase/supabase-js`.
- No llamar a `auth.users` desde la aplicación. La autenticación se hace por Supabase Auth REST y el perfil se lee por PostgREST.
- Mantener la integración tras una interfaz propia (`AuthProvider`/servicio de autenticación). Los componentes no deben conocer rutas, headers ni respuestas de Supabase. Así se podrá sustituir el proveedor implementando el mismo contrato.
- Una vez iniciado sesión, conservar la sesión durante recargas de la página en la pestaña y restaurar el usuario autenticado al volver a abrir el dashboard.
- Mostrar en el dashboard la identidad del usuario autenticado: nombre de perfil y, como respaldo, email; incluir acceso a una vista/sección “Mi perfil” de solo lectura en esta primera etapa.
- `VITE_SUPABASE_URL` es la URL base del proyecto, por ejemplo `https://<project-ref>.supabase.co`; las rutas `/auth/v1` y `/rest/v1` se agregan en el servicio.
- También hace falta la **publishable key** (antes llamada `anon key`) del proyecto. Es pública por diseño, pero solo es segura junto con Auth y RLS correctamente configurados. Nunca usar `service_role` en Vite.

Variables locales:

```dotenv
VITE_API_BASE_URL=https://<project-ref>.supabase.co
VITE_API_PUBLIC_KEY=<publishable-key>
```

No incluir contraseñas, tokens ni `service_role` en `.env.example`, Git, logs ni mensajes de error. Las variables `VITE_*` quedan visibles en el JavaScript publicado.

## Operaciones HTTP

Todas las solicitudes JSON llevan:

```http
apikey: <VITE_API_PUBLIC_KEY>
Content-Type: application/json
```

### 1. Iniciar sesión

```http
POST {BASE_URL}/auth/v1/token?grant_type=password
```

```json
{
  "email": "<correo-del-usuario>",
  "password": "<contraseña>"
}
```

Supabase Auth inicia sesión por **email y contraseña**. Si `UserAdminAccount` se identifica solamente con un nombre de usuario, verificar en Supabase cuál es su email de acceso; no enviar el nombre a este endpoint esperando que lo resuelva.

Respuesta exitosa (campos relevantes):

```json
{
  "access_token": "<bearer-token>",
  "refresh_token": "<refresh-token>",
  "expires_in": 3600,
  "token_type": "bearer",
  "user": {
    "id": "<uuid>",
    "email": "<correo>"
  }
}
```

No considerar que el usuario ya tiene acceso al panel hasta validar el perfil con la siguiente operación.

### 2. Consultar el perfil del usuario autenticado

```http
GET {BASE_URL}/rest/v1/profiles?select=id,display_name,role,active&id=eq.<user.id>
apikey: <VITE_API_PUBLIC_KEY>
Authorization: Bearer <access_token>
```

Respuesta esperada: arreglo con exactamente un perfil.

```json
[
  {
    "id": "<uuid>",
    "display_name": "Administrador",
    "role": "admin",
    "active": true
  }
]
```

La aplicación permite entrar al dashboard solo si el perfil existe, `active` es `true` y `role` es `admin`, `cashier` o `waiter`. La vista de usuario puede limitar opciones por rol, pero la autorización efectiva siempre debe permanecer en RLS/RPC.

El SQL actual crea los perfiles nuevos con rol `waiter`; **no asigna automáticamente `admin`** a `UserAdminAccount`. Antes de probar, confirmar en Supabase Dashboard que:

1. La cuenta existe en Auth y puede autenticarse por email.
2. Se aplicó el esquema y el trigger creó su fila en `public.profiles`.
3. Esa fila tiene el rol administrativo esperado y `active = true`.

No permitir que el navegador cambie su propio rol ni confiar en `user_metadata.role`.

### 3. Renovar sesión

Cuando el access token expire, renovar antes de repetir una solicitud protegida:

```http
POST {BASE_URL}/auth/v1/token?grant_type=refresh_token
apikey: <VITE_API_PUBLIC_KEY>
Content-Type: application/json
```

```json
{
  "refresh_token": "<refresh-token-actual>"
}
```

Usar los tokens devueltos; Supabase puede rotar el refresh token. Implementar una sola renovación simultánea cuando varias solicitudes fallen a la vez. Si la renovación falla, limpiar la sesión local y volver al login; no reintentar indefinidamente.

### 4. Cerrar sesión

```http
POST {BASE_URL}/auth/v1/logout
apikey: <VITE_API_PUBLIC_KEY>
Authorization: Bearer <access_token>
```

Limpiar siempre los datos de sesión del cliente, incluso si la solicitud de logout falla. No conservar el perfil como prueba de autenticación.

## Contrato interno independiente del proveedor

La UI debe depender de una interfaz similar a esta, no de respuestas crudas:

```ts
export type AppRole = 'admin' | 'cashier' | 'waiter';

export interface AppSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string };
  profile: {
    id: string;
    displayName: string;
    role: AppRole;
    active: boolean;
  };
}

export interface AuthProvider {
  signIn(email: string, password: string): Promise<AppSession>;
  getSession(): Promise<AppSession | null>;
  signOut(): Promise<void>;
}
```

La implementación Supabase REST traduce las respuestas HTTP al modelo interno y normaliza errores. Una futura API implementará `AuthProvider` sin rehacer el formulario ni las rutas de React. No distribuir `fetch` de Auth directamente entre componentes.

## Sesión en navegador

No hay almacenamiento de tokens completamente seguro para una SPA que los maneja desde JavaScript. `localStorage` y `sessionStorage` son accesibles ante una vulnerabilidad XSS.

**Decisión para esta etapa:** guardar el `access_token`, `refresh_token` y `expires_at` en `sessionStorage`, para restaurar la sesión tras recargar la página y borrarla al cerrar la pestaña. El perfil puede volver a consultarse al restaurar la sesión; no usar el perfil guardado como prueba de autenticación. `sessionStorage` sigue siendo accesible ante XSS, por lo que se debe evitar HTML no confiable y no registrar tokens. No implementar “recordarme” entre reinicios del navegador en esta etapa.

Al iniciar la app, leer la sesión guardada; si el access token expiró o está próximo a expirar, renovarlo con el refresh token antes de consultar el perfil. Si la renovación falla, limpiar `sessionStorage` y mostrar login. En logout, invalidar la sesión en Auth y limpiar siempre el almacenamiento local. Una alternativa más segura es un backend propio (BFF) que gestione cookies `HttpOnly`, aunque añade infraestructura y deja de ser una integración exclusivamente directa desde el navegador.

## Perfil visible en el dashboard

- Tras login o restauración de sesión, consultar `public.profiles` con el token actual.
- Guardar en el estado global/contexto de autenticación el perfil normalizado (`displayName`, `role`, `active`) y el email de Auth.
- En el encabezado del dashboard, mostrar `displayName`; si está vacío, mostrar el email. Mostrar también el rol si el diseño lo permite.
- Añadir un destino “Mi perfil” con nombre, email y rol en modo solo lectura. No habilitar edición de rol ni estado desde la aplicación; cambios de permisos son tarea administrativa protegida.
- Mostrar un estado de carga mientras se restaura la sesión y no renderizar el dashboard hasta confirmar sesión y perfil. Si la cuenta está inactiva, cerrar sesión local y bloquear acceso.

## Errores y comportamiento esperado

- `400`/`401` al iniciar sesión: credenciales inválidas o cuenta no disponible. Mostrar un mensaje genérico; no revelar si el email existe.
- `401` al consultar perfil o llamar a una API: intentar renovar una vez; si falla, cerrar sesión local.
- `200` con perfil vacío, inactivo o con rol no permitido: no entrar al dashboard y limpiar la sesión local.
- Error de red, CORS o respuesta no JSON: mostrar error recuperable sin registrar contraseña ni tokens.
- Nunca confiar solo en que el login devolvió `200`; el perfil activo y las políticas de base también deben permitir las operaciones.

## Criterios de aceptación

1. `UserAdminAccount` inicia sesión con email/contraseña y recibe un perfil activo con rol `admin`.
2. Contraseña incorrecta no crea una sesión ni se guarda en el navegador.
3. Perfil inexistente, inactivo o rol no permitido bloquea el dashboard.
4. Recargar la página restaura la sesión desde `sessionStorage`, renueva el access token cuando corresponde y vuelve a cargar/validar el perfil.
5. El dashboard muestra el nombre del perfil o, si está vacío, el email; “Mi perfil” presenta los datos en modo solo lectura.
6. Logout limpia el estado de la UI y la sesión local; cuenta inactiva o renovación fallida vuelve al login.
7. El frontend contiene únicamente URL y publishable key; no contiene `service_role`.
8. La pantalla React conoce solo errores y `AppSession` normalizados, no nombres de campos específicos de Supabase.

## Qué sigue después del login

1. Completar y verificar restauración/renovación de sesión y perfil con la cuenta administrativa en staging.
2. Integrar el estado inicial de Auth en `ProtectedRoute`, con estados explícitos `loading`, `authenticated` y `unauthenticated`; no dejar que el dashboard parpadee antes de la validación.
3. Mostrar identidad del usuario en el encabezado y crear “Mi perfil” de solo lectura.
4. Crear el adaptador HTTP REST común (`baseUrl`, headers, bearer token, errores normalizados) y tests unitarios con `fetch` simulado.
5. Migrar primero lectura de categorías y menú; después pedidos y RPC transaccionales. No migrar todos los módulos de una sola vez.
6. Para cada recurso, definir contrato REST/RPC, rol permitido, validación, errores y prueba antes de conectarlo a componentes.
