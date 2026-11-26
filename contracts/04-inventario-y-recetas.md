# Contrato 04 — Inventario y recetas

**Etapa:** 4.2 del plan de migración.  
**Estado:** propuesto; implementar después de cerrar el contrato 03 de usuarios/roles.  
**Objetivo:** migrar el mantenimiento de ingredientes, consulta del inventario, ajustes auditables de stock y recetas por producto, preservando las restricciones de PostgreSQL.

## Principios e invariantes

- Unidades cerradas y base: `g`, `ml`, `unit`. Convertir kg→g y l→ml antes de enviar; no almacenar unidades libres.
- Stock nunca se escribe directamente por REST. Todo ajuste usa RPC transaccional y crea una fila inmutable en `inventory_movements`.
- El stock inicial es cero. Registrar la existencia inicial mediante `opening_balance`; no permitir enviar `stock` al crear/editar un ingrediente.
- No aceptar cantidades cero, negativas cuando la operación requiere entrada, no finitas ni con más de tres decimales. La BD rechaza stock negativo.
- Los ingredientes y recetas son datos operativos; pedidos históricos conservan snapshots de la receta al crearse.
- Ajustar stock de producto terminado solo si no tiene receta. La disponibilidad de productos con receta deriva del stock de ingredientes; no duplicar su inventario.

## Permisos

| Operación | Roles permitidos |
|---|---|
| Leer ingredientes, recetas y movimientos | admin, cashier, waiter autenticados |
| Crear/editar/desactivar ingredientes y reemplazar recetas | admin |
| Ajustar stock de ingredientes y producto sin receta | admin, cashier |
| Escribir/borrar movimientos de inventario directamente por REST | nadie; solo RPC |

RLS/RPC es la autoridad. Ocultar botones no constituye control de acceso.

## Recursos REST de lectura/mantenimiento

Todos los endpoints requieren `apikey`, `Authorization: Bearer <access_token>` y usarán `VITE_API_BASE_URL`. La UI consume modelos propios en camelCase.

### Ingredientes

```http
GET /rest/v1/ingredients?select=id,name,unit,stock,min_stock,active,created_at,updated_at&order=name.asc&limit=200
```

```http
POST /rest/v1/ingredients
Content-Type: application/json
```

```json
{
  "name": "Café molido",
  "unit": "g",
  "min_stock": 500,
  "active": true
}
```

El stock es omitido y comienza en `0`. Para cambios de nombre, mínimo o estado:

```http
PATCH /rest/v1/ingredients?id=eq.<ingredient-uuid>
Prefer: return=representation
```

```json
{ "min_stock": 750, "active": true }
```

La interfaz debe preferir desactivar a borrar. La base puede rechazar `DELETE` si existen recetas o movimientos vinculados.

La unidad se define al crear el ingrediente y no se actualiza mediante este contrato (los permisos SQL no conceden UPDATE de `unit`). Si una unidad fue registrada incorrectamente, crear un ingrediente correcto y migrar receta/saldo de forma auditada; no reinterpretar cantidades existentes.

### Recetas

```http
GET /rest/v1/product_ingredients?select=product_id,ingredient_id,quantity_per_portion,ingredient:ingredients(id,name,unit,active)&product_id=eq.<product-uuid>
```

La escritura reemplaza toda la receta mediante RPC (no varias escrituras REST):

```http
POST /rest/v1/rpc/replace_product_recipe
Content-Type: application/json
```

```json
{
  "p_product_id": "<product-uuid>",
  "p_lines": [
    { "ingredient_id": "<ingredient-uuid>", "quantity_per_portion": 18.5 },
    { "ingredient_id": "<ingredient-uuid-2>", "quantity_per_portion": 220 }
  ]
}
```

Solo admin; máximo 30 ingredientes, sin duplicados, cada cantidad estrictamente positiva y en la unidad base del ingrediente. `p_lines: []` elimina la receta. Los pedidos existentes no cambian.

### Libro de movimientos

```http
GET /rest/v1/inventory_movements?select=id,ingredient_id,product_id,type,quantity_delta,reason,created_by,created_at&ingredient_id=eq.<ingredient-uuid>&order=created_at.desc&limit=100
```

Filtrar por ingrediente/producto, fecha y tipo según la pantalla. Los movimientos son de solo lectura para la UI. Nunca hacer `POST`, `PATCH` ni `DELETE` de movimientos directamente.

## Ajustes de stock por RPC

### Ingrediente

```http
POST /rest/v1/rpc/adjust_ingredient_stock
```

```json
{
  "p_ingredient_id": "<ingredient-uuid>",
  "p_delta": 1000,
  "p_type": "opening_balance",
  "p_idempotency_key": "<uuid-nuevo-por-operacion>",
  "p_reason": "Conteo inicial"
}
```

La RPC devuelve el saldo actualizado. Reutilizar la misma clave UUID solo para reintentar exactamente el mismo ajuste; generar otra para un ajuste nuevo.

Tipos permitidos: `opening_balance`, `purchase`, `expiration`, `spill`, `damage`, `count_correction`, `return_to_stock`, `manual_adjustment`.

- `opening_balance`, `purchase`, `return_to_stock`: delta positivo.
- `expiration`, `spill`, `damage`: delta negativo.
- `count_correction`, `manual_adjustment`: delta positivo o negativo.
- Todos: delta distinto de cero, saldo resultante no negativo; razón de hasta 250 caracteres.

### Producto sin receta

```http
POST /rest/v1/rpc/adjust_product_stock
```

```json
{
  "p_product_id": "<product-uuid>",
  "p_delta": -2,
  "p_type": "damage",
  "p_idempotency_key": "<uuid-nuevo-por-operacion>",
  "p_reason": "Producto dañado"
}
```

Solo admin/cashier; la RPC rechaza el ajuste si el producto tiene receta.

## Modelos de dominio y servicios

```ts
export type InventoryUnit = 'g' | 'ml' | 'unit';

export interface Ingredient {
  id: string;
  name: string;
  unit: InventoryUnit;
  stock: number;
  minStock: number;
  active: boolean;
}

export interface RecipeLine {
  ingredientId: string;
  ingredientName: string;
  unit: InventoryUnit;
  quantityPerPortion: number;
}

export interface InventoryService {
  listIngredients(signal?: AbortSignal): Promise<Ingredient[]>;
  createIngredient(input: Pick<Ingredient, 'name' | 'unit' | 'minStock' | 'active'>): Promise<Ingredient>;
  updateIngredient(id: string, changes: Partial<Pick<Ingredient, 'name' | 'minStock' | 'active'>>): Promise<Ingredient>;
  listRecipe(productId: string): Promise<RecipeLine[]>;
  replaceRecipe(productId: string, lines: Array<{ ingredientId: string; quantityPerPortion: number }>): Promise<number>;
  adjustIngredientStock(input: {
    ingredientId: string; delta: number; type: string; idempotencyKey: string; reason?: string;
  }): Promise<number>;
  listInventoryMovements(filter: { ingredientId?: string; productId?: string }): Promise<InventoryMovement[]>;
}
```

No reutilizar los tipos legacy con IDs enteros sin transformación; los IDs destino son UUID strings. Los componentes no llaman PostgREST ni RPC directamente.

## Errores y recuperación

- `401`: renovar una vez; si falla, limpiar sesión y volver a login.
- `403`/`42501`: rol no autorizado; mantener el estado anterior y mostrar permiso insuficiente.
- `INSUFFICIENT_STOCK`, `ADJUSTMENT_DIRECTION_INVALID`, `INVALID_INVENTORY_ADJUSTMENT`, `IDEMPOTENCY_KEY_REUSED`, `RECIPE_PRODUCT_STOCK_IS_DERIVED`: convertir a mensajes accionables y seguros.
- `DUPLICATE_RECIPE_INGREDIENT`, `INVALID_RECIPE`, `INGREDIENT_NOT_FOUND`, `PRODUCT_NOT_FOUND`: marcar el formulario/selección correspondiente.
- Error de red/timeout: permitir reintentar con la misma idempotency key del ajuste para evitar doble registro.
- No mostrar errores internos SQL ni guardar tokens en logs.

## Criterios de aceptación

1. Waiter/cashier/admin leen ingredientes y recetas según RLS; anon no accede a inventario.
2. Solo admin administra ingredientes y recetas; solo admin/cashier hacen ajustes autorizados.
3. Creación REST nunca escribe stock; primer saldo queda registrado como movimiento `opening_balance`.
4. Reposición, merma, ajuste de conteo y reintento idempotente actualizan saldo y libro exactamente una vez.
5. Stock negativo, NaN/Infinity, precisión > 3 decimales, unidad inválida, delta cero y dirección incompatible fallan sin modificar datos.
6. Reemplazar/eliminar receta no modifica snapshots de órdenes históricas.
7. Un producto con receta no acepta ajuste de stock propio; producto sin receta sí.
8. La UI muestra mínimos, unidad, historial de movimientos y errores sin optimismo incorrecto.
9. Tests con `fetch` simulado cubren transforms y errores; staging prueba RLS/RPC/rollback con los tres roles.
10. Pasan lint, `tsc` y build.

## Fuera de alcance

- CRUD de productos/categorías y almacenamiento de imágenes.
- Promociones, pedidos y pagos.
- Importación de balances MySQL; se define en el contrato de corte y debe generar movimientos iniciales conciliables.
