# Guía de PrimeReact — Coffee Connect

## Versión y alcance

- PrimeReact **10.x** es la biblioteca oficial de componentes administrativos. Mantener PrimeReact 10; no migrar a v11.
- React, TypeScript y Vite conservan las versiones existentes.
- No instalar una segunda biblioteca visual, paquetes premium ni productos que requieran licencia o clave.
- PrimeFlex 4 es el apoyo preferente para flex, grid, alineación y espaciado. CSS Grid es válido si expresa mejor la composición.
- El kiosco público conserva su composición propia; no forzar sobre él la densidad del panel administrativo.

## Configuración central

- `src/main.tsx`: cargar Lara Light Indigo, PrimeReact CSS, PrimeIcons y PrimeFlex; montar un `PrimeReactProvider` con `ripple`, `inputStyle="outlined"` y locale `es-SV`.
- `src/config/primeReact.ts`: registrar traducciones/calendario con `addLocale`. Locale regional: `es-SV`; moneda: USD; fecha de Calendar: `dd/mm/yy` (en PrimeReact `yy` es año de cuatro dígitos).
- `src/styles/primereact.css`: enlazar tokens Coffee Connect con variables de Lara y personalizar la identidad de marca café/rosa.
- `src/styles/primereact-overrides.css`: único lugar para ajustes visuales globales a clases de componentes PrimeReact. No duplicar overrides por módulo ni usar `!important` de forma general.
- `src/styles/application.css`: composición compartida del login, shell administrativo y estilos de estructuras de módulos.
- La galería `/__dev/ui` es una ruta lazy solo de desarrollo; no añadirla a la navegación ni habilitarla en producción.

## Cascada, capas y modo styled

El proveedor debe mantener `unstyled: false` (o dejar la opción omitida, cuyo default es styled). Las hojas oficiales deben cargarse en este orden: tema Lara, `primereact.min.css`, PrimeIcons y PrimeFlex; tokens/reset y CSS de la aplicación después. El login usa `p-fluid` y las props/clases oficiales de Password (`className="w-full"`, `inputClassName="w-full"`).

Lara Light Indigo de PrimeReact 10 declara buena parte del tema en `@layer primereact`. Las declaraciones CSS sin capa tienen precedencia sobre las reglas de cualquier capa, aun con menor especificidad. Por ello, un reset global como `* { margin: 0; padding: 0 }` elimina paddings nativos y rompe controles compuestos; se quitó de `src/index.css` y `src/styles/main.css`. El reset compartido conserva únicamente `box-sizing`; el margen cero se aplica a `body`, no a controles.

No usar selectores globales `input`, `button`, `select`, `textarea`, `svg` o `span` para reconstruir apariencia. No fijar padding, display, position, background o tamaño interno de un control PrimeReact desde CSS global. Dejar su apariencia base a Lara y limitar los ajustes comunes a medidas/tokens requeridos.

Lara 10 además contiene tonos índigo directos en estados activos/focus/selección que no cambian solo al redefinir `--primary-color`. El mapa de variables de marca está en `primereact.css`; los pocos selectores de estado necesarios (Button, campos enfocados, selecciones, Checkbox/InputSwitch, DataTable, Paginator y TabView) están centralizados en `primereact-overrides.css`. No editar el CSS dentro de `node_modules`.

`src/pages/dev/UiShowcase.tsx` presenta componentes reales y estados de error, deshabilitado y carga; verificar allí cambios de CSS en desarrollo.

```tsx
<PrimeReactProvider value={{ ripple: true, inputStyle: 'outlined', locale: 'es-SV', unstyled: false }}>
  <App />
</PrimeReactProvider>
```

## Selección de componentes

| Uso | Componente oficial |
|---|---|
| Listados administrativos | `DataTable`, `Column` |
| Selector simple/de dominio | `Dropdown` |
| Selección múltiple | `MultiSelect` |
| Fecha y rango | `Calendar` |
| Búsqueda sugerida | `AutoComplete` |
| Cantidad/precio | `InputNumber` |
| Texto/observaciones | `InputText`, `InputTextarea` |
| Contraseña | `Password` |
| Acción | `Button` |
| Edición/confirmación | `Dialog`, `ConfirmDialog` |
| Panel deslizable | `Sidebar` |
| Navegación de secciones | `TabView` |
| Estado | `Tag` |
| Activación | `InputSwitch` |
| Notificación | `Toast` |
| Acciones secundarias | `Menu` |
| Carga de estructura | `Skeleton` |
| Barra/filtros | `Toolbar` |
| Ayuda contextual | `Tooltip` |

No crear un wrapper si solo reexpone la misma API sin aportar composición, accesibilidad o comportamiento propio. Un componente de dominio (por ejemplo el selector de unidades compatibles) sí puede adaptar las opciones y renderizar el control oficial.

## Patrones observados

### DataTable y paginación

Inventario usa `DataTable` con `size="small"`, `stripedRows`, `paginator`, `rows={20}` sobre resultados que `inventoryService` carga completos por páginas. Usuarios conserva cursor remoto y botón “Cargar más” porque la página cargada no equivale al conjunto completo. No simular paginación local de resultados incompletos.

```tsx
<DataTable value={rows} dataKey="id" size="small" stripedRows paginator rows={20}
  responsiveLayout="scroll" emptyMessage="No hay registros.">
  <Column field="name" header="Nombre" />
</DataTable>
```

### Fecha y moneda

```tsx
<Calendar value={date} onChange={event => setDate(event.value as Date | null)}
  dateFormat="dd/mm/yy" locale="es-SV" showIcon />
```

Para importes controlados usar `InputNumber` con `locale="es-SV"`, `mode="currency"` y `currency="USD"`. Para etiquetas de solo lectura usar `formatCurrency` exportado de `src/config/primeReact.ts`.

### Dialog, validación y mensajes

Usar Dialog controlado con títulos descriptivos, ancho proporcional al contenido, `modal`, footer con acción primaria/secundaria y estado `loading`/`disabled`. Dialog se ocupa del foco y Escape; evitar overlays manuales salvo que exista una limitación comprobada.

Los campos deben tener label accesible vía `htmlFor`/`inputId`, ayuda y error próximo. Usar `Toast` para mensajes breves y `ConfirmDialog` para operaciones destructivas; no mostrar a la vez SweetAlert2 y Toast por una operación.

### Catálogos y servicios

Dropdown recibe catálogos del servicio/dominio. No duplicar unidades o roles del backend en una lista local como fuente de verdad. Los cambios de presentación no alteran rutas, payloads, RPC, Auth, roles, RLS ni idempotencia.

## Densidad, accesibilidad y responsive

- Títulos 22–24px; cuerpo 14px; tablas 13–14px; inputs 38–40px; áreas táctiles aproximadas de 44px.
- Usar `size="small"` cuando sea legible; no compactar a costa de contraste o teclado.
- Tablas con scroll propio si la anchura no permite reformatear. No crear overflow horizontal de página.
- Dialogs móviles con márgenes seguros, altura limitada y desplazamiento interno.
- Todo botón solo-icono necesita `aria-label`; toda acción debe ser operable por teclado y mostrar foco.
- Probar 360×800, 390×844, 768×1024, 1024×768, 1366×768 y 1920×1080.

## CSS

PrimeReact proporciona estilos de botones, inputs, selectores, diálogos, etiquetas y tablas: no recrearlos. Mantener en CSS de módulo únicamente grid/flex de dominio y contenido sin equivalente. Consumir tokens de `src/index.css`, no hardcodear colores de marca. Revisar consumidores antes de eliminar archivos heredados.
