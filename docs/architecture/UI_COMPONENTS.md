# Componentes de interfaz

## Inventario existente

- `src/components/SearchBar.tsx`: búsqueda del catálogo público; evaluar reutilización por API/estilo antes de duplicar.
- `src/components/layout/Sidebar.tsx` y `KioskoLayout.tsx`: navegación propia del kiosco, no son el layout administrativo.
- `src/features/inventory/MeasurementUnitSelect.tsx`: selector de unidad agrupado por categoría; mantenerlo como control de dominio.
- `src/features/inventory/InventoryPage.tsx`: actualmente mezcla presentación y operaciones; dividir por responsabilidades al extender el módulo.
- `src/components/RecipeEditor.tsx` es editor del flujo existente; comprobar contrato/consumidores antes de reutilizarlo para recetas de inventario.
- PrimeReact 10 es la biblioteca oficial administrativa. El proveedor está configurado en `src/main.tsx`; idioma, moneda y formato de fecha se definen en `src/config/primeReact.ts`.
- `src/features/inventory/InventoryPage.tsx` usa DataTable para ingredientes, productos y movimientos; Dropdown para filtros y selectores; Calendar para rangos de fecha; `MeasurementUnitSelect` conserva sus opciones de dominio obtenidas del catálogo PostgreSQL y las representa con Dropdown.
- `src/pages/admin/UsersAdmin.tsx` muestra el patrón administrativo DataTable + filtros + acciones Menu + Dialog + ConfirmDialog + Toast. La consulta usa cursor remoto y “Cargar más”; no paginar localmente un resultado parcial.
- `src/pages/admin/Login.tsx` conserva `AuthContext` y muestra el patrón de InputText, Password, Message y Button.
- SweetAlert2 y Lucide React se conservan para consumidores existentes; las nuevas operaciones administrativas deben preferir Toast y ConfirmDialog de PrimeReact.

## API sugerida

Los componentes compartidos deben ser pequeños, accesibles y tipados. Preferir el componente PrimeReact oficial para cada control y composición sobre wrappers que dupliquen su API. Mantener controles HTML para semántica/contenido cuando no hay equivalente útil.

| Componente | Contrato recomendado |
|---|---|
| `PageHeader` | `title`, `description?`, `actions?` |
| `SectionHeader` | `title`, `description?`, `actions?` |
| `Button` | `variant`, `size`, `loading`, `disabled`, `type`, contenido |
| `IconButton` | `label` accesible obligatorio, `disabled`, icono |
| `Input`, `NumberInput`, `Select`, `SearchInput` | props HTML, `invalid`, `error`, etiquetas/ayuda enlazadas |
| `FormField` | `label`, `htmlFor`, `required?`, `hint?`, `error?`, contenido |
| `DataTable` | columnas tipadas, filas, clave estable, estados de carga/vacío/error |
| `Pagination` | página, tamaño, total, callbacks; anunciar cambios |
| `Dialog`, `Drawer` | título, `open`, cierre controlado, `onClose`, contenido |
| `ConfirmDialog` | acción explícita, descripción y variante destructiva |
| `Badge`, `Alert` | estado semántico y texto |
| `EmptyState`, `LoadingState`, `ErrorState` | mensaje específico y acción opcional |
| `Tabs` | tabs con semántica ARIA y navegación por teclado |
| `Toast` | mensaje breve, rol apropiado y cierre/tiempo no intrusivo |

Antes de crear uno, buscar en `src/components`, `src/features` y estilos asociados. Las variantes de dominio permanecen en el feature cuando expresan reglas de negocio.

## Accesibilidad obligatoria

- Cada control tiene nombre accesible; icon-only requiere `aria-label`.
- `Dialog` debe guardar/restaurar foco, enfocar contenido inicial, contener Tab, cerrar con Escape si no hay envío en curso y bloquear scroll del fondo; al cerrar, devolver foco al disparador.
- Los errores se enlazan con `aria-describedby`, se marcan con `aria-invalid` y no sustituyen el texto asociado.
- Deshabilitar acciones incompatibles durante un envío y comunicar carga.
- `DataTable` usa encabezados; en móvil decidir scroll interno o presentación alternativa, sin ocultar acciones esenciales.
- Usar `size="small"` en tablas administrativas compactas y `responsiveLayout="scroll"` cuando las columnas no quepan; el scroll debe quedar confinado a la tabla.
- Inputs de fecha son Calendar con `dateFormat="dd/mm/yy"` y `locale="es-SV"`. Importes: InputNumber con `locale="es-SV"`, `mode="currency"` y `currency="USD"` cuando se edite un importe.
- Dropdown de dominio solo recibe opciones ya obtenidas del servicio; no duplicar catálogos en frontend.
