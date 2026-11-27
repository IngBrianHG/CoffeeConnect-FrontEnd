# Plan de rediseño del kiosco

## Estado de implementación

- Fase visual aplicada en frontend: encabezado/mesa/actualización, categorías navegables por teclado, menú fluido, placeholders sin imagen externa, carrito estimado, modal móvil con Escape/foco y seguimiento privado de una orden.
- Categorías validadas por el catálogo fijo en cliente y cargadas por `display_order`.
- La migración `docs/sql/005_kiosk_catalog_seed.sql` permanece pendiente de ejecución en una base de desarrollo/staging; no se aplicó a Supabase remoto.
- Historial de todas las órdenes de sesión y total compartido siguen bloqueados hasta definir credencial, privacidad y contrato backend (sección Fase 2).

## Objetivo

Renovar `/user/:mesa_id` para ofrecer una experiencia clara, rápida y accesible en teléfono, tablet y escritorio: descubrir el menú por categorías, armar un pedido, consultar su estado y entender qué importe corresponde a la sesión sin presentar datos de otras personas como si fueran propios.

## Base visual y catálogo

- Mantener React 19, TypeScript, PrimeReact 10, PrimeFlex 4, Lucide y los tokens actuales; no añadir otra biblioteca visual.
- Usar las categorías cerradas definidas en `docs/sql/005_kiosk_catalog_seed.sql`: Bebidas frías, Bebidas calientes, Postres, Pasteles, Repostería, Pan y Otros.
- La base conserva `categories`; una restricción impide crear o activar categorías fuera de la lista. Los nombres de categoría no se editan desde administración.
- El frontend mantiene un mapa explícito de los siete nombres fijos a iconos Lucide; no infiere iconos por coincidencias parciales ni depende de metadatos de icono en la base.
- `display_order` define la posición de las categorías, sin duplicar la asignación visual de iconos.
- Los productos de demostración no llevan imagen (`image_url = null`). La tarjeta debe tener una presentación cuidada para ese caso, sin imágenes de stock ficticias ni espacios vacíos.
- Catálogo público continúa leyendo `categories`/`public_menu`; jamás seleccionar ni mostrar stock del menú público.

## Experiencia propuesta

1. **Encabezado compacto:** marca, nombre de mesa confirmado por el servidor y acción de ayuda/recarga; reducir altura para priorizar el menú.
2. **Categorías:** navegación con icono y texto, desplazable horizontalmente en móvil y persistente en escritorio. “Todos” siempre visible; indicar categoría seleccionada también con texto/estado, no solo color.
3. **Descubrimiento:** búsqueda accesible y resultados con nombre, descripción, precio autoritativo del catálogo e indicación clara de producto disponible en menú. Tarjetas en grid fluido; acciones táctiles de al menos 44 px.
4. **Carrito:** panel persistente en escritorio; resumen inferior fijo y hoja accesible en móvil. Mostrar cantidades, notas, subtotal/total estimado del carrito y errores junto a la acción. Etiquetar el importe como estimado por el catálogo, no como pago ni cobro confirmado.
5. **Envío:** conservar carrito y clave idempotente ante timeout/5xx, bloquear doble envío, y mostrar “Pedido recibido; pendiente de confirmación por el personal”. No afirmar reserva de inventario ni aplicar descuentos no calculados por servidor.
6. **Pedidos de esta sesión:** sección/timeline comprensible con estado y actualización; distinguir pendiente, confirmado, preparación, listo, entregado y cancelado. El alcance de consulta debe definirse con backend antes de mostrar pedidos que pudieran pertenecer a otros clientes.
7. **Carga, error y vacío:** skeleton/indicador, reintentar sin borrar estado y mensajes seguros/accionables para menú, mesa, sesión, red e inventario. No transformar una respuesta inválida en lista vacía.

## Responsive y accesibilidad

- Móvil hasta 639 px: una columna, categorías horizontales, CTA de carrito fijo con safe-area y hoja con scroll interno; ningún overflow horizontal de página.
- Tablet 640–1023 px: grid de dos columnas si el ancho real del contenedor lo permite; carrito como panel/hoja, no una columna comprimida.
- Escritorio desde 1024 px: navegación de categorías y menú con carrito persistente; limitar ancho de lectura sin restringir el grid operativo.
- Usar `min-width: 0`, grid fluido y viewport dinámico; no fijar anchos que asuman un dispositivo.
- Botones con nombres accesibles, foco visible, teclado, `aria-live` para confirmaciones/estado y respeto a movimiento reducido. No depender del color para selección o estado.
- Verificar 360×800, 390×844, 768×1024, 1024×768, 1366×768 y 1920×1080, incluyendo teclado virtual, orientación y zoom.

## Alcance técnico sugerido

### Fase 1 — Catálogo y esqueleto visual

- Aplicar y revisar el SQL de catálogo en desarrollo/staging.
- Ampliar `PublicCategory` y su parser en `src/services/catalog.ts` para validar los siete nombres y leer `display_order`; ordenar categorías por el campo del servidor.
- Mantener la pestaña de categorías como catálogo de solo lectura; retirar alta, edición y activación/desactivación desde la UI.
- Extraer categorías, tarjetas y resumen de carrito a componentes pequeños; mantener la página como coordinadora.
- Actualizar estilos propios del kiosco en `src/styles/main.css` o en un módulo dedicado, reutilizando tokens y sin overrides globales de controles.
- Cubrir iconos conocidos, icono no reconocido, categoría sin productos, producto sin imagen y fallos de red con pruebas.

### Fase 2 — Pedidos y cuenta de sesión

- Seguir el contrato 07 para crear órdenes solo mediante `create_public_order`; no escribir en tablas ni enviar importes.
- Conservar la consulta privada existente por clave idempotente para seguimiento de **una orden** cuando la migración aprobada esté instalada.
- Antes de listar todas las órdenes de sesión o mostrar una cuenta agregada, definir quién comparte esa sesión y cómo se autoriza. El QR de mesa no es secreto ni identifica a una persona.
- Si el negocio confirma que todos los ocupantes de la mesa pueden ver la misma cuenta, revisar/versionar el contrato y diseñar una RPC pública limitada que requiera una credencial de sesión no incluida en el QR, expire y devuelva solo los datos aprobados. La suma debe calcularse en servidor y respetar estados, cancelaciones y política de pagos del contrato 08.
- Si los pedidos deben ser privados por comprador, no ofrecer el historial de sesión completo; usar una credencial privada por intención/orden y mostrar solo ese pedido. No sumar órdenes ajenas.
- No habilitar lista pública por `table_id` o `table_session_id`, ni leer órdenes directamente como `anon`. El contrato actual prohíbe ambas opciones y la RPC 003 devuelve estado/productos de una única orden, sin importes.
- Contrato 08 define pagos/asignaciones/cierre. Hasta acordar su semántica, el kiosco puede mostrar el total de los pedidos autorizados como importe informativo pendiente, pero no “saldo a pagar”, “cuenta pagada” ni estado de pago inventado.

## Criterios de aceptación

- Interfaz usable sin scroll horizontal de página en los seis tamaños de referencia; flujo completo con mouse, teclado y pantalla táctil.
- Las categorías llegan ordenadas por `display_order` y cada nombre fijo muestra su icono Lucide; un nombre inesperado usa el icono genérico.
- La ausencia de imagen mantiene la alineación de tarjetas y no oculta nombre, precio o acción.
- El carrito presenta cantidades/notas y total calculado para orientación; el servidor sigue siendo autoridad para precio, snapshots y orden.
- Un timeout conserva exactamente payload y clave idempotente; el envío no se duplica ni borra el carrito en error ambiguo.
- Nunca se exponen inventario, órdenes de otras sesiones o datos de pago no autorizados al usuario anónimo.
- La vista de pedidos/cuenta solo se activa cuando exista contrato aprobado, RPC aplicada y pruebas de autorización/expiración para `anon`, waiter, cashier y admin.
- Pasan `npm run lint`, `npm run build` y pruebas de catálogo/órdenes; staging valida RLS, RPC y flujo de mesa/sesión.

## Dependencias y decisiones pendientes

1. Revisar y aprobar `docs/sql/005_kiosk_catalog_seed.sql`; sus productos son solo datos de prueba.
2. Aprobar/aplicar las migraciones de seguimiento y órdenes necesarias en staging. No cambiar Supabase remoto desde este plan.
3. Decidir si la sesión de mesa representa una cuenta compartida visible por todos o solo una agrupación operativa del personal.
4. Definir con el contrato 08 qué significa “cuenta total” antes de presentarla como saldo cobrable.
