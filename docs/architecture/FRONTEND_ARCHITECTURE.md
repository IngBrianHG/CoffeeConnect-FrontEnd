# Arquitectura frontend

## Stack y estructura observados

React 19 + TypeScript 5.9 + Vite 7 y React Router 7. No hay framework visual ni cliente oficial de Supabase instalado. La aplicación consume Supabase mediante REST/RPC a través de `src/services/http/client.ts`; autenticación está en `src/services/auth.ts` y estado/perfil en `src/auth/AuthContext.tsx`.

`src/features/inventory/` contiene modelo, servicio, selector de unidades, pantalla y estilos. `src/pages/OrdersHistory.tsx` integra `InventoryPage` como pestaña administrativa. `src/styles/main.css` contiene los tokens heredados y estilos principales del kiosco/pedidos; `src/index.css` agrega reset/base.

PrimeReact 10 es la biblioteca visual administrativa (no premium); PrimeFlex 4 se usa para layout. `PrimeReactProvider` se monta en `src/main.tsx`; la locale `es-SV`, USD y formato de Calendar se configuran en `src/config/primeReact.ts`. La identidad de Lara está centralizada en `src/styles/primereact.css` y las adaptaciones comunes en `src/styles/primereact-overrides.css`. `src/styles/application.css` contiene layout administrativo/login y CSS de composición compartida.

## Límites de responsabilidad

1. **Vistas y componentes:** render, accesibilidad e interacción; no construir URL REST ni llamar Supabase.
2. **Hooks/controladores de feature:** estado de carga inicial/actualización/envío/consulta, selección, cancelación de solicitudes y coordinación del flujo.
3. **Dominio:** validación determinista, conversión/estimación de unidades, formato y etiquetas de códigos técnicos.
4. **Servicios:** transporte, validación de contratos de entrada/salida, parsers de respuestas y traducción segura de errores.
5. **Servidor:** RLS, roles definitivos, conversiones y escrituras transaccionales/idempotentes mediante RPC. El cliente no sustituye esta autoridad.

Mantener el `HttpClient` existente. El helper de autorización/renovación está actualmente dentro de `InventoryPage`; si se necesita en otros módulos, extraerlo a una abstracción compartida solo con un contrato que preserve reintento único ante 401 y cierre de sesión al expirar.

No mover lógica de negocio al reemplazar controles visuales. Una tabla local solo puede paginar después de cargar el conjunto completo; si el servicio responde por cursor o páginas, conservar paginación remota/carga incremental.

## Inventario

Responsabilidad: `InventoryPage` coordina tabs y navegación; `ProductStockAdjustmentDialog` presenta el ajuste por producto y `useProductStockAdjustment` gestiona su draft, validación, idempotencia y envío; `inventoryDomain.ts` contiene reglas/formateo/conversiones puras y `inventoryValidation.ts` valida campos. `inventoryService` mantiene el acceso REST/RPC y parseo. Extraer más subsecciones del componente cuando se trabajen; no crear un hook monolítico como sustituto del componente monolítico.

Contratos existentes incluyen `ingredients`, `products`, `product_ingredients`, `inventory_movements`, unidades y equivalencias, además de RPC de stock y receta. Leer `contracts/04-inventario-y-recetas.md` y `docs/inventory-measurements.md` antes de cambiar consultas.

## Datos, errores y concurrencia

- Cancelar GET con `AbortSignal` cuando el cliente/servicio lo soporta; además ignorar respuestas obsoletas por identificador de solicitud.
- No presentar respuesta nula como error ni error RLS/conexión como “sin registros”.
- En escrituras, conservar entrada ante error; bloquear envíos simultáneos.
- Si la escritura RPC triunfa pero falla la recarga, mostrar que la operación se guardó y que la vista necesita actualizarse; no invitar a repetir el movimiento.
- Reintentar una operación idempotente con la misma clave solo cuando el payload normalizado coincide exactamente. Nueva intención = clave nueva.
- Cachear catálogos estables en memoria con invalidación explícita; no repetir llamadas por cada cambio del selector.

## Seguridad y cambios de backend

No exponer service role. Mantener Auth, RLS, funciones RPC y los snapshots históricos. No modificar recursos remotos. Cualquier extensión de contrato (paginación server-side, perfil legible del responsable, disponibilidad derivada) necesita comprobar soporte y autorización; entregar SQL incremental separado para aprobación en caso de necesitarlo.
