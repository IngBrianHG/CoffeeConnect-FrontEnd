# Guía responsive

## Enfoque

Diseñar primero el contenido para el ancho real disponible (`min-width: 0`, Grid/Flex, `minmax()` y unidades fluidas). Los breakpoints son umbrales de composición, no objetivos de dispositivos:

- Móvil: hasta 639px.
- Tablet: 640–1023px.
- Escritorio: 1024–1439px.
- Escritorio amplio: 1440px en adelante.

Preferir container queries para componentes cuyo espacio depende del contenedor. Evitar anchuras fijas y `100vw` dentro de layouts con sidebar.

## Reglas por tamaño

### Móvil

- Formularios a una columna; controles y acciones principales con área táctil aproximada de 44px.
- Dialogs PrimeReact deben ajustarse al viewport; usar footer con acciones reordenables y evitar anchos fijos de escritorio.
- Filtros apilables y acciones secundarias agrupadas sin ocultar opciones esenciales.
- Diálogos adaptados al viewport, con scroll interno seguro y márgenes pequeños.
- Tablas: scroll horizontal contenido si sus columnas no admiten reformateo; no crear scroll horizontal de página.
- DataTable puede usar `responsiveLayout="scroll"`; mantener filtros envolventes/apilables y acción principal disponible.
- Mantener visibles errores, unidades, motivo y confirmación de acciones de inventario.

### Tablet

- Formulario de una o dos columnas según ancho interno; permitir sidebar colapsable en el layout que la posea.
- Probar orientación vertical y horizontal; evitar columnas que queden demasiado estrechas.

### Escritorio

- Aprovechar el espacio sin estirar inputs; alinear filtros y acciones con la tabla.
- Tablas compactas y formularios en varias columnas cuando mejore el flujo.
- En anchos amplios limitar el ancho de lectura, no el ancho de tablas operativas.

## Verificación

Revisar manualmente 360×800, 390×844, 768×1024, 1024×768, 1366×768 y 1920×1080; anotar ancho del contenedor (incluyendo sidebar), zoom, teclado, foco y overflow. Un breakpoint solo se cambia tras probar el contenido, no por coincidencia con una marca de dispositivo.
