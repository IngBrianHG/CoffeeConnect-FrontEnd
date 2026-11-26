# Sistema de diseño — Coffee Connect

## Propósito

Esta guía define los tokens y patrones visuales compartidos por las vistas internas. Es una evolución de la identidad actual (café `#6F4E37`, tonos cálidos y acento rosa del kiosco), no una sustitución de marca. Antes de añadir CSS, revisar `src/styles/main.css`, `src/index.css` y los tokens de `:root`.

## Tokens globales

Definir y consumir tokens CSS; no repetir valores en hojas particulares. Preferir tokens semánticos frente a nombres por componente.

| Grupo | Tokens |
|---|---|
| Marca | `--color-brand`, `--color-brand-hover`, `--color-brand-soft`, `--color-accent` |
| Texto | `--color-text`, `--color-text-muted`, `--color-text-inverse` |
| Superficies | `--color-canvas`, `--color-surface`, `--color-surface-subtle` |
| Estado | `--color-success`, `--color-warning`, `--color-danger`, `--color-info` y sus fondos |
| Borde y foco | `--color-border`, `--color-border-strong`, `--color-focus` |
| Tipografía | `--font-family-sans`, `--text-xs` (12px), `--text-sm` (13px), `--text-base` (14px), `--text-section` (16–18px), `--text-page` (22–24px) |
| Espaciado | `--space-1` a `--space-6`: 4, 8, 12, 16, 24 y 32px |
| Forma | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill` |
| Elevación | `--shadow-sm`, `--shadow-md` (reservar para superficies superpuestas) |
| Controles | `--control-height` (38–40px), `--button-height` (36–40px), `--touch-target` (44px) |
| Capas | `--z-sticky`, `--z-drawer`, `--z-dialog`, `--z-toast` |

Usar tablas compactas (texto 13–14px, filas 44–48px), labels de 13px y ayuda de 12px. Respetar preferencias de movimiento reducido y foco visible. No usar color como único indicador de estado.

## Componentes y composición

PrimeReact 10 es la biblioteca oficial para controles administrativos. La base es Lara Light Indigo, con su color primario redefinido por los tokens café de Coffee Connect. La configuración y los ajustes compartidos viven en `src/config/primeReact.ts`, `src/styles/primereact.css` y `src/styles/primereact-overrides.css`.

Usar controles HTML semánticos para contenido y composición, y componentes PrimeReact para controles interactivos con equivalente disponible. Las vistas deben mantener contraste suficiente, jerarquía de encabezados coherente, foco visible y mensajes próximos al campo que los origina. PrimeFlex 4 es la utilidad prioritaria para layout; el CSS de módulo solo resuelve composición de dominio.

## Reglas

- No añadir otra biblioteca visual sin una necesidad demostrada y acuerdo explícito.
- No introducir colores de marca fuera de tokens ni sombras/bordes decorativos redundantes.
- Mantener el kiosco reconocible; aplicar los patrones administrativos sin forzar su estética sobre la experiencia pública.
- Variar dimensiones solo por accesibilidad o evidencia de uso en pantalla pequeña.
- No usar el índigo predeterminado como color de marca: el primario de la aplicación es café y los estados deben usar los tokens semánticos.
- Para Calendar usar `dateFormat="dd/mm/yy"` (sintaxis PrimeReact) y `locale="es-SV"`; para importes usar `Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' })`.
- No aplicar un reset universal de margen/padding a controles: el tema Lara 10 utiliza `@layer primereact`, y reglas globales sin capa pueden anular sus estilos base. Mantener solo el box-sizing global; dejar padding, iconos, alineación y estados a los componentes oficiales.
- El login usa `p-fluid` y Password con `className="w-full"` e `inputClassName="w-full"` para dar el mismo ancho al wrapper y al input sin recrear sus estilos.
