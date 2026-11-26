# Validación de formularios

## Principios

Validar en la interfaz para ayudar, en el servicio para impedir solicitudes inválidas accidentales y en PostgreSQL/RPC para integridad y seguridad. La validación cliente nunca reemplaza RLS, restricciones, triggers ni RPC.

## Reglas de inventario

- Requeridos: recortar espacios; nombres no vacíos (ingrediente hasta 100 caracteres; presentación hasta 80; razón hasta 250, según contratos actuales).
- Números: mantener texto durante edición; rechazar vacío, `null`, booleanos, NaN e infinito antes de convertir. No usar `Number('')` como validación. Requerir valor finito y máximo tres decimales (`numeric(14,3)` donde corresponde).
- Cantidades para movimientos ordinarios y presentaciones: estrictamente positivas. Corrección/ajuste manual permite signo; su dirección se calcula según la operación. El saldo resultante se valida definitivamente en servidor.
- Mínimo de stock: finito, no negativo y con precisión máxima de tres decimales.
- Receta: una o más líneas al guardar, máximo 30, identificadores UUID válidos y únicos, cantidad positiva y unidad compatible. No omitir líneas incompletas ni interpretar receta vacía como eliminación.
- Unidades: catálogo activo; categoría no comercial para equivalencias/recetas; verificar dimensión base o equivalencia específica existente.
- Movimientos: ingrediente activo, presentación activa y perteneciente al ingrediente; salidas con saldo suficiente (la RPC vuelve a validar).
- Acciones administrativas: bloquear edición en UI por rol y confiar igualmente en RLS/RPC. Confirmar desactivación/eliminación; proteger la última cuenta admin.

## Presentación de errores

Mostrar errores junto al campo o formulario de origen. Mantener valores para corrección y reintento. Usar mensajes accionables y seguros; no exponer SQL ni tokens. Distinguir validación de servicio, permiso, recurso inexistente, red y recarga fallida después de confirmar una escritura.

Al usar PrimeReact, enlazar etiquetas con `htmlFor` / `inputId`, marcar `invalid` y mostrar `small` o `Message` junto al control. Deshabilitar el botón de envío y usar `loading` durante procesamiento. InputNumber mejora la entrada numérica, pero no reemplaza la validación de dominio/servicio/backend ni debe convertir un campo vacío en cero.

## Destructivos y cambios sin guardar

Solicitar confirmación explícita antes de eliminar una receta completa. Interceptar cambios de producto, pestaña y ruta cuando haya cambios sin guardar; ofrecer guardar, descartar explícitamente o continuar editando. Cancelar no debe mutar datos. No activar guardado si existen filas incompletas.
