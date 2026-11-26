# Instrucciones para agentes — Coffee Connect

## Stack de interfaz

El frontend actual es React 19, TypeScript 5.9, Vite 7 y React Router 7. Usa PrimeReact **10** y PrimeFlex 4 como biblioteca oficial de interfaz/distribución. No migrar a Angular, React 19/TypeScript/Vite nuevos, PrimeReact 11 ni añadir otra biblioteca visual.

Antes de modificar vistas, consultar también `docs/architecture/PRIME_REACT_GUIDELINES.md`. Mantener la configuración del proveedor, locale, tema y ajustes de componentes en `src/main.tsx`, `src/config/primeReact.ts` y `src/styles/primereact*.css`; no introducir overrides globales duplicados.

PrimeReact debe permanecer en modo styled (`unstyled: false`) y sus hojas oficiales deben cargarse antes de los estilos de aplicación. Lara 10 usa `@layer primereact`: no añadir resets universales sin capa para `margin`, `padding`, dimensiones o presentación de controles, pues esos estilos ganan al tema. Usar `p-fluid`, propiedades del componente y tokens. La galería de referencia `/__dev/ui` solo existe durante desarrollo.

Antes de crear o modificar componentes, vistas, rutas o estilos, consultar obligatoriamente:

- `docs/architecture/DESIGN_SYSTEM.md`
- `docs/architecture/UI_COMPONENTS.md`
- `docs/architecture/RESPONSIVE_GUIDELINES.md`
- `docs/architecture/FRONTEND_ARCHITECTURE.md`
- `docs/architecture/FORM_VALIDATION_GUIDELINES.md`
- `docs/architecture/MODULE_IMPLEMENTATION_CHECKLIST.md`
- `docs/architecture/PRIME_REACT_GUIDELINES.md`

Respetar el stack y componentes existentes; no añadir una biblioteca visual alternativa sin justificación y autorización. Conservar autenticación, roles, `HttpClient`, políticas RLS y RPC transaccionales. No cambiar Supabase remoto ni eliminar/modificar datos. Revisar contratos y SQL local antes de alterar operaciones; cualquier cambio de backend debe presentarse como migración incremental separada para aprobación.

Al finalizar ejecutar las verificaciones disponibles y reportar únicamente resultados realmente observados. No ocultar errores, degradar accesibilidad ni permitir pérdida silenciosa de cambios.
