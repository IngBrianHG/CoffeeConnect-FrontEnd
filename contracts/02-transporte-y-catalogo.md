# Contrato 02 — Transporte REST y lectura del catálogo público

**Estado:** transporte y servicio implementados; el kiosco ya lee categorías/productos de Supabase. Lint, TypeScript, build y pruebas locales pasan. Falta validar el menú con Supabase en staging. El checkout continúa en Express y requiere atención en el contrato 03 porque ahora recibe UUID de catálogo.  
**Objetivo:** crear el transporte `fetch` agnóstico y migrar únicamente las lecturas públicas del kiosco a Supabase. No migrar todavía CRUD administrativo, pedidos, inventario, mesas ni pagos.

## Límites

- Sin `@supabase/supabase-js`, ORM ni cliente de base de datos.
- `frontend/src/services/api.ts` continúa atendiendo las funciones todavía conectadas a Express/MySQL. No cambiarlo globalmente ni modificar funciones legacy en este contrato.
- Crear un adaptador separado (`src/services/http/` o equivalente) y un servicio de catálogo separado (`src/services/catalog.ts`).
- El kiosco debe leer categorías/productos a través de esas nuevas funciones; preservar comportamiento y datos actuales para los demás módulos.
- Las lecturas del menú se conectan a Supabase; el envío de pedidos, la mesa y las promociones permanecen en sus servicios actuales. `public_menu.id`/`category_id` son UUID, mientras el modelo y endpoint de pedidos legacy esperan IDs numéricos. El checkout no queda validado por este contrato; resolver la compatibilidad al implementar el contrato 03.
- Solo usar URL base y publishable key en el navegador. No añadir secretos ni `service_role`.

## Configuración HTTP

Usar:

- `VITE_API_BASE_URL=https://<project-ref>.supabase.co`
- `VITE_API_PUBLIC_KEY=<publishable-key>`

Requests al API deben enviar:

```http
apikey: <publishable-key>
Accept: application/json
```

Cuando la llamada sea autenticada, añadir:

```http
Authorization: Bearer <access-token>
```

El transporte debe construir URLs desde la base del proyecto, codificar query params con `URLSearchParams`, serializar body JSON solo cuando exista y parsear respuestas vacías sin fallar.

## Endpoints públicos

### Categorías activas

```http
GET /rest/v1/categories?select=id,name,description&active=eq.true&order=name.asc
```

Requiere `apikey`; no requiere sesión de usuario. Solo devolver categorías activas. RLS también debe restringir la lectura; los filtros del cliente no son autorización.

### Menú público

```http
GET /rest/v1/public_menu?select=id,category_id,category_name,name,description,price,image_url&order=name.asc
```

La vista `public_menu` debe ser el origen de datos del menú anónimo. No seleccionar `products.stock` ni exponer campos internos.

## Modelos del dominio

Los tipos usados por el kiosco son independientes de la respuesta PostgREST:

```ts
export interface PublicCategory {
  id: string; // UUID
  name: string;
  description: string | null;
}

export interface PublicMenuItem {
  id: string; // UUID
  categoryId: string;
  categoryName: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
}
```

El adaptador traduce `category_id`, `category_name` e `image_url` al modelo camelCase. Rechazar o reportar respuestas inesperadas; no sustituir datos inválidos silenciosamente por `0`.

Interfaz pública del servicio:

```ts
export interface CatalogService {
  listPublicCategories(signal?: AbortSignal): Promise<PublicCategory[]>;
  listPublicMenu(signal?: AbortSignal): Promise<PublicMenuItem[]>;
}
```

La pantalla no debe conocer el proveedor ni crear URLs PostgREST directamente.

## Errores y comportamiento

- `2xx`: parsear JSON y validar que la forma sea un arreglo; una respuesta vacía válida produce `[]`.
- `401`/`403`: mostrar error de acceso/configuración sin reintentar login para un endpoint anónimo.
- `404`: error de contrato/configuración (tabla o vista ausente); no convertirlo en catálogo vacío.
- `5xx`/red: mostrar mensaje recuperable y permitir reintentar.
- Cancelación por `AbortSignal`: no presentar como error al usuario.
- Normalizar errores como `ApiError` del proyecto con `status`, `code` opcional y mensaje seguro; no mostrar ni registrar tokens/headers.

## Pruebas y criterios de aceptación

1. Las solicitudes se dirigen a la raíz configurada y llevan la publishable key; nunca aparece `/rest/v1/rest/v1`.
2. El menú no consulta ni recibe existencias reales.
3. El transformador mapea UUID y campos snake_case a los modelos TypeScript esperados.
4. Una respuesta `404`, `401`, `500`, JSON malformado y una solicitud cancelada tienen comportamientos distintos y comprobados.
5. Integrar estas lecturas en el kiosco y confirmar en staging que menú/categorías vienen de Supabase; mantener temporalmente el checkout, mesa y promociones legacy sin mezclarlos. Pendiente validación de staging.
6. Tests del transporte y del servicio usan `fetch` simulado; no dependen de credenciales reales.
7. Pasan lint, `tsc` y build.

## Estado de implementación y siguiente contrato

- `src/services/http/client.ts`: transporte `fetch` independiente con URL base, headers públicos/autenticados, query params, body JSON opcional, parseo vacío y errores normalizados.
- `src/services/catalog.ts`: lectura y validación de categorías activas y `public_menu`, transformadas a modelos camelCase y sin incluir existencias.
- `tests/catalog.test.mjs`: pruebas de URL/headers, transformación, respuesta vacía, errores HTTP, JSON/datos no válidos, cancelación y fallo de red.
- `src/pages/user/Kiosk.tsx` usa el servicio Supabase para categorías y menú, y conserva mesa, promociones y pedidos legacy. No se cambió `src/services/api.ts`.

`npm run test:catalog`, `npm run lint` y `npm run build` pasan localmente. La validación con credenciales/datos reales de staging sigue pendiente.

- No crear ni actualizar productos/categorías desde este contrato.
- No actualizar la firma/types generales de todos los componentes para UUID.
- No migrar login: eso pertenece a `01-autenticacion-y-sesion.md`.
- Una vez integrado y validado el catálogo del kiosco, conforme al orden de `docs/03-plan-migracion.md`, definir el contrato de **usuarios y roles** (4.1). Mesas/sesiones y pedidos públicos por RPC vienen después, en las etapas 4.4 y 4.5.
