# Contrato 05 — Administración de categorías, productos y promociones

**Etapa:** 4.3 del plan de migración.  
**Estado:** definido para carga de imágenes; precio promocional en el servidor sigue pendiente.  
**Objetivo:** migrar el mantenimiento administrativo de categorías, productos y promociones a Supabase REST sin trasladar a la UI la autoridad sobre precios/descuentos.

## Límites

- Mantener UUIDs y modelos internos camelCase; no reutilizar IDs numéricos del flujo Express.
- Componentes consumen servicios de dominio. No construyen URLs PostgREST ni llaman RPC directamente.
- El frontend solo usa `HttpClient`, publishable key y token del usuario autenticado. Nunca exponer `service_role` en el navegador; la función Edge la usa solo en el servidor para Storage.
- No cambiar el checkout ni migrar promociones del kiosco/POS en este contrato.
- Las promociones se administran aquí, pero su cálculo y aplicación en órdenes requieren una interfaz server-side validada. El cliente no puede ser autoridad de precio ni importe descontado.
- Imágenes: la carga se realiza exclusivamente mediante `product-image-upload`, una Edge Function que verifica sesión y perfil admin, admite JPG/PNG/WebP hasta 5 MiB y devuelve una URL pública del bucket `product-images`. La UI no acepta URLs arbitrarias.

## Autoridad y permisos

RLS y restricciones PostgreSQL son la autoridad. Solo `admin` puede crear/editar/desactivar categorías, productos y promociones. Los productos/categorías activos continúan disponibles en el catálogo público según `public_menu`; no mostrar datos operativos como stock en el menú.

Preferir desactivar en lugar de borrar. Las FK `ON DELETE RESTRICT` pueden impedir borrar categorías/productos referenciados por pedidos o promociones.

## Recursos disponibles en el esquema actual

### Categorías

```http
GET /rest/v1/categories?select=id,name,description,active,created_at,updated_at&order=name.asc&limit=200
POST /rest/v1/categories
PATCH /rest/v1/categories?id=eq.<uuid>
```

Alta: `{ "name": "...", "description": "...", "active": true }`.  
Edición permitida: `name`, `description`, `active`. Validar nombre recortado y no vacío; la unicidad la confirma la base.

### Productos

```http
GET /rest/v1/products?select=id,category_id,name,description,price,image_url,active,stock,created_at,updated_at&order=name.asc&limit=200
POST /rest/v1/products
PATCH /rest/v1/products?id=eq.<uuid>
```

Alta: `{ "category_id": "<uuid>", "name": "...", "description": "...", "price": 4.50, "image_url": null, "active": true }`. No enviar `stock` al crear o editar productos; los ajustes siguen el contrato 04 y su RPC. Precio finito y estrictamente positivo con dos decimales; nombre no vacío. La categoría debe existir y estar activa para publicar el producto.

Para listas administrativas se permite leer stock solo si el usuario está autenticado y autorizado por RLS. El catálogo público continúa usando `public_menu`, nunca `products` ni campos de inventario.

### Imágenes de producto (Supabase Storage)

- Bucket `product-images`, público solo para lectura del catálogo; los objetos se escriben exclusivamente desde la Edge Function con `service_role`, que nunca llega al navegador.
- Límite: 5 MiB; MIME permitido: `image/jpeg`, `image/png`, `image/webp`. La función también comprueba la firma del archivo.
- La función exige JWT válido y perfil `admin` activo. El navegador envía `multipart/form-data` con el campo `file`, `apikey` publishable y `Authorization: Bearer <access_token>`.
- Respuesta `201`: `{ "imageUrl": "https://<proyecto>/storage/v1/object/public/product-images/products/<uuid>.<ext>" }`. El frontend persiste esa URL en `products.image_url` mediante REST.
- Cada carga usa una ruta nueva e inmutable. Si luego falla el guardado del producto o se cancela el diálogo, el objeto puede quedar huérfano; mantener la URL en el formulario para reintentar evita volver a cargarlo. La limpieza automática de huérfanos queda como mantenimiento separado.
- No se reemplazan objetos existentes ni se borra la imagen anterior automáticamente. Las imágenes públicas deben considerarse visibles para cualquiera que conozca su URL.

### Promociones

`promotions` admite `type` (`nxm`, `percent`), `scope` (`product`, `category`, `all_menu`), objetivo, fechas y activación. Validaciones de forma actuales:

- `nxm`: `buy_quantity >= 2`, `1 <= pay_quantity < buy_quantity`, `percent = null`.
- `percent`: `0 < percent <= 100`; cantidades NXM nulas.
- El scope exige exactamente el objetivo correspondiente; `all_menu` no admite producto/categoría.
- Fechas opcionales; cuando ambas existen, inicio no posterior al fin.
- Nombre obligatorio no vacío; descripción opcional.

CRUD REST de administración puede listar, insertar, actualizar y desactivar promociones con sesión autenticada. No borrar promociones referenciadas por historial.

**Bloqueo para aplicar promociones:** el esquema actual define tabla y RLS, pero no proporciona en el contrato un endpoint autoritativo que calcule el precio efectivo ni que aplique la misma regla al crear órdenes. No migrar cálculo al navegador ni publicar promociones como descuentos activos hasta acordar e implementar el contrato de servidor/RPC de órdenes.

## Modelos de dominio

```ts
export interface AdminCategory {
  id: string; name: string; description: string | null; active: boolean;
}
export interface AdminProduct {
  id: string; categoryId: string; name: string; description: string | null;
  price: number; imageUrl: string | null; active: boolean; stock?: number;
}
export type PromotionType = 'nxm' | 'percent';
export type PromotionScope = 'product' | 'category' | 'all_menu';
```

Los parsers deben rechazar respuesta malformada, UUID inválido, precio no finito/no positivo, enum desconocido y relaciones inconsistentes; no sustituir valores por cero ni ocultar errores como listas vacías.

## Errores y recuperación

- `401`: renovación única mediante la sesión existente; si falla, cerrar sesión.
- `403`/`42501`: permiso insuficiente; conservar el formulario.
- `23505`: nombre duplicado (categoría o producto en la misma categoría).
- `23503`: categoría/objetivo relacionado inexistente o protegido.
- `23514`/`22P02`: regla, formato o enum inválido; mensaje accionable y seguro.
- Error de red/5xx: permitir reintentar; evitar dobles envíos. En altas no reintentar automáticamente una petición cuyo resultado sea ambiguo sin mecanismo de idempotencia.
- Nunca mostrar detalles SQL, tokens o headers.

## Criterios de aceptación

1. Solo admin puede escribir; RLS niega escrituras a anon, waiter y cashier.
2. CRUD de categorías/productos se valida en UI y servicio, y la base sigue siendo autoridad.
3. No se puede ajustar stock desde este módulo; producto con receta mantiene disponibilidad derivada según contrato 04.
4. Catálogo público conserva `public_menu` y no filtra productos/categorías inactivos ni stock.
5. Promociones inválidas se rechazan; ninguna promoción cambia el checkout hasta que exista cálculo/aplicación autoritativos en servidor.
6. Tests con `fetch` simulado cubren transformación, validación, errores de permisos/duplicado/red y no envían campos prohibidos.
7. `npm run lint`, `npm run build` y pruebas existentes pasan.
8. Staging valida RLS con los tres roles y el flujo público después de que estén disponibles los contratos de servidor.

## Dependencias pendientes antes de habilitar funcionalidades

- Confirmar permisos SQL exactos de `products` (en particular lectura administrativa de `stock`) y vistas/columnas expuestas por PostgREST.
- Configurar en Supabase Storage el bucket descrito arriba y desplegar su función según `supabase/PRODUCT_IMAGE_UPLOAD.md`; falta verificarlo en staging.
- Configurar en Supabase Storage el bucket público `product-images` y desplegar `product-image-upload` con allowlist de orígenes. No crear políticas de escritura para clientes.
- Definir API/RPC autoritativa para promociones y asegurar que cálculo y creación de órdenes compartan las mismas reglas.
