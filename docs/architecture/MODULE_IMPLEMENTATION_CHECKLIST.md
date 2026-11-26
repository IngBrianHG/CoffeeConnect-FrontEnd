# Checklist de implementación de módulos

Antes de implementar:

- [ ] Leer `DESIGN_SYSTEM.md`, `UI_COMPONENTS.md`, `RESPONSIVE_GUIDELINES.md`, `FRONTEND_ARCHITECTURE.md` y `FORM_VALIDATION_GUIDELINES.md`.
- [ ] Leer `PRIME_REACT_GUIDELINES.md`; confirmar que los componentes usados son compatibles con PrimeReact 10.
- [ ] Inspeccionar estructura, componentes/estilos reutilizables, rutas, layout, roles, transporte y contratos/migraciones existentes.
- [ ] Definir alcance, estados vacíos/carga/error, roles permitidos e invariantes de datos.
- [ ] Confirmar contrato remoto. No cambiar Supabase remoto ni datos sin autorización.

Durante la implementación:

- [ ] Mantener límites vista / hook / dominio / servicio / servidor.
- [ ] Reutilizar tokens y componentes; no añadir biblioteca visual duplicada.
- [ ] Usar los componentes oficiales (DataTable, Dropdown, Calendar, InputNumber, Dialog, Toast, ConfirmDialog, etc.) en lugar de reconstruir controles equivalentes.
- [ ] Dar nombres accesibles, teclado, foco, errores y estados de carga.
- [ ] Validar datos sin convertir entradas vacías en números; validar nuevamente en servicio y dejar autoridad definitiva al backend.
- [ ] Usar claves estables para filas; cancelar o ignorar consultas obsoletas.
- [ ] Proteger operaciones destructivas, cambios no guardados, permisos y envíos duplicados.
- [ ] Conservar datos y clave idempotente solo para reintento idéntico.
- [ ] Añadir pruebas de dominio/servicio para éxito, datos malformados, permisos, desconexión, reintentos y carreras relevantes.

Antes de entregar:

- [ ] Ejecutar las pruebas disponibles, `npm run lint` y `npm run build`; declarar resultados sin inferir.
- [ ] Comprobar teclado y resoluciones 360×800, 390×844, 768×1024, 1024×768, 1366×768 y 1920×1080.
- [ ] Revisar overflow, foco, contraste, etiquetas, mensajes de error y acciones touch.
- [ ] Explicar limitaciones, dependencias de backend y cualquier SQL incremental pendiente de aprobación.
