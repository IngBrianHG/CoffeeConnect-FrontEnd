# Catálogo cerrado de unidades de inventario

## Aplicación

Aplicar `docs/sql/002_measurement_units.sql` después de `001_supabase_schema.sql` en cada entorno, con revisión y respaldo habituales. No se ejecutó en Supabase remoto. La migración conserva los valores existentes de `inventory_unit` y no altera cantidades, movimientos, recetas ni snapshots históricos.

El catálogo `measurement_units` solo tiene lectura para personal autenticado; no se conceden escrituras desde la API. Las presentaciones comerciales se configuran por ingrediente en `ingredient_presentations` (por ejemplo `box`, `1000` ml) y sus cantidades se expresan siempre en la unidad base del ingrediente. El catálogo comercial no define conversiones globales.

## Conversión y operaciones

- `convert_ingredient_quantity(uuid,text,numeric)` convierte en PostgreSQL unidades de la misma dimensión. Equivalencias de peso↔volumen solo existen si se configura el factor específico en `ingredient_unit_conversions.quantity_in_base`.
- `adjust_ingredient_stock_measurement(...)` valida la unidad/ingrediente y delega el ajuste a la RPC transaccional existente; sus movimientos y stock siguen registrados en unidad base.
- `record_ingredient_presentation_purchase(...)` toma la presentación configurada y contabiliza la cantidad en base en la misma operación transaccional.
- `replace_product_recipe` ahora acepta `{ingredient_id,quantity,unit_code}` y conserva `quantity_per_portion` en unidad base junto con la entrada original. Sin `unit_code`, sigue aceptando el formato antiguo en unidad base.
- Los pedidos continúan consumiendo y revirtiendo snapshots en unidad base con las funciones existentes de confirmación/cancelación.

Las fracciones convertidas se redondean a tres decimales, que es la precisión efectiva de las columnas del inventario (`numeric(14,3)`). Validar productos concretos y equivalencias (p. ej. taza de harina) antes de activar su uso operativo.

## Configuración / validación previa

La configuración de equivalencias por ingrediente y presentaciones requiere permisos de administrador y nunca modifica el catálogo global. Antes de registrar una equivalencia cruzada, verificarla físicamente para ese ingrediente. Una presentación válida debe tener cantidad positiva, nombre identificable y unidad base correcta. La unidad base de un ingrediente queda bloqueada al existir movimientos, recetas o snapshots.

## Recetas por lote

No se incorporó producción por lote ni rendimiento de porciones: requiere acordar rendimiento real, merma, estados de preparación, trazabilidad de lotes y cuándo se descuenta materia prima. Se recomienda diseñarlo como flujo separado cuando el proceso operativo de la cafetería esté definido; no reinterpretar las recetas actuales por porción.
