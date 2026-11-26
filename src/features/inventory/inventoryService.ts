import { ApiError, type HttpClient } from '../../services/http/client.ts';
import type {
  Ingredient,
  IngredientPresentation,
  IngredientAdjustmentType,
  InventoryMovement,
  InventoryProduct,
  InventoryService,
  InventoryUnit,
  MeasurementUnit,
  RecipeLine,
} from './model';

type Row = Record<string, unknown>;
type TokenProvider = () => string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNITS = new Set<InventoryUnit>(['g', 'ml', 'unit']);
const ADJUSTMENT_TYPES = new Set<IngredientAdjustmentType>([
  'opening_balance', 'purchase', 'expiration', 'spill', 'damage',
  'count_correction', 'return_to_stock', 'manual_adjustment',
]);
const MOVEMENT_TYPES = new Set([...ADJUSTMENT_TYPES, 'order_consumption', 'order_reversal']);
const MEASUREMENT_CATEGORIES = new Set(['weight', 'volume', 'preparation', 'count', 'purchase']);

function invalid(resource: string): never {
  throw new ApiError(200, `El servicio devolvió datos no válidos para ${resource}.`, 'INVALID_RESPONSE');
}

function record(value: unknown, resource: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(resource);
  return value as Row;
}

function numberField(value: unknown, resource: string): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return invalid(resource);
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return invalid(resource);
  return parsed;
}

function hasAtMostThreeDecimals(value: number): boolean {
  return Math.abs(value * 1000 - Math.round(value * 1000)) <= 1e-7;
}

function hasAtMostNineDecimals(value: number): boolean {
  return Math.abs(value * 1_000_000_000 - Math.round(value * 1_000_000_000)) <= 1e-5;
}

function parseIngredient(value: unknown): Ingredient {
  const row = record(value, 'ingredientes');
  if (
    typeof row.id !== 'string' || !UUID.test(row.id)
    || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 100
    || typeof row.unit !== 'string' || !UNITS.has(row.unit as InventoryUnit)
    || typeof row.active !== 'boolean'
  ) return invalid('ingredientes');
  const stock = numberField(row.stock, 'ingredientes');
  const minStock = numberField(row.min_stock, 'ingredientes');
  if (stock < 0 || minStock < 0 || !hasAtMostThreeDecimals(stock) || !hasAtMostThreeDecimals(minStock)) {
    return invalid('ingredientes');
  }
  return {
    id: row.id,
    name: row.name,
    unit: row.unit as InventoryUnit,
    stock,
    minStock,
    active: row.active,
  };
}

function parseProduct(value: unknown): InventoryProduct {
  const row = record(value, 'productos');
  if (typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.name !== 'string' || !row.name.trim()
    || typeof row.active !== 'boolean') return invalid('productos');
  const stock = numberField(row.stock, 'productos');
  if (stock < 0 || !hasAtMostThreeDecimals(stock)) return invalid('productos');
  return { id: row.id, name: row.name, stock, active: row.active, hasRecipe: false, availableQuantity: null };
}

function parseRecipeLine(value: unknown): RecipeLine {
  const row = record(value, 'recetas');
  const ingredient = record(row.ingredient, 'recetas');
  if (
    typeof row.ingredient_id !== 'string' || !UUID.test(row.ingredient_id)
    || typeof ingredient.id !== 'string' || !UUID.test(ingredient.id)
    || typeof ingredient.name !== 'string' || !ingredient.name.trim()
    || typeof ingredient.unit !== 'string' || !UNITS.has(ingredient.unit as InventoryUnit)
    || typeof ingredient.active !== 'boolean'
  ) return invalid('recetas');
  const quantityPerPortion = numberField(row.quantity_per_portion, 'recetas');
  if (quantityPerPortion <= 0 || !hasAtMostThreeDecimals(quantityPerPortion)) return invalid('recetas');
  const preparationQuantity = row.preparation_quantity == null ? null : numberField(row.preparation_quantity, 'recetas');
  if (preparationQuantity !== null && (preparationQuantity <= 0 || !hasAtMostThreeDecimals(preparationQuantity))) return invalid('recetas');
  const preparationUnitCode = typeof row.preparation_unit_code === 'string' ? row.preparation_unit_code : null;
  if ((preparationQuantity === null) !== (preparationUnitCode === null)) return invalid('recetas');
  return {
    ingredientId: row.ingredient_id,
    ingredientName: ingredient.name,
    unit: ingredient.unit as InventoryUnit,
    ingredientActive: ingredient.active,
    quantityPerPortion,
    preparationQuantity,
    preparationUnitCode,
  };
}

function parseMeasurementUnit(value: unknown): MeasurementUnit {
  const row = record(value, 'unidades de medida');
  if (typeof row.code !== 'string' || !row.code.trim() || typeof row.name !== 'string' || !row.name.trim()
    || typeof row.abbreviation !== 'string' || !row.abbreviation.trim() || typeof row.category !== 'string'
    || !MEASUREMENT_CATEGORIES.has(row.category) || typeof row.active !== 'boolean') {
    return invalid('unidades de medida');
  }
  const baseUnit = row.base_unit == null ? null : row.base_unit;
  if (baseUnit !== null && (typeof baseUnit !== 'string' || !UNITS.has(baseUnit as InventoryUnit))) return invalid('unidades de medida');
  const conversionFactor = row.conversion_factor == null ? null : numberField(row.conversion_factor, 'unidades de medida');
  if (row.category === 'purchase' ? conversionFactor !== null || baseUnit !== null
    : conversionFactor === null || conversionFactor <= 0 || baseUnit === null) return invalid('unidades de medida');
  return {
    code: row.code, name: row.name, abbreviation: row.abbreviation,
    category: row.category as MeasurementUnit['category'], baseUnit: baseUnit as InventoryUnit | null,
    conversionFactor, active: row.active, sortOrder: numberField(row.sort_order, 'unidades de medida'),
  };
}

function parseMovement(value: unknown): InventoryMovement {
  const row = record(value, 'movimientos');
  const quantityDelta = numberField(row.quantity_delta, 'movimientos');
  if (
    typeof row.id !== 'string' || !UUID.test(row.id)
    || (row.ingredient_id !== null && (typeof row.ingredient_id !== 'string' || !UUID.test(row.ingredient_id)))
    || (row.product_id !== null && (typeof row.product_id !== 'string' || !UUID.test(row.product_id)))
    || typeof row.type !== 'string' || !MOVEMENT_TYPES.has(row.type as IngredientAdjustmentType)
    || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))
    || (row.reason !== null && typeof row.reason !== 'string')
    || (row.created_by !== null && typeof row.created_by !== 'string')
    || quantityDelta === 0 || !hasAtMostThreeDecimals(quantityDelta)
  ) return invalid('movimientos');
  return {
    id: row.id,
    ingredientId: row.ingredient_id as string | null,
    productId: row.product_id as string | null,
    type: row.type,
    quantityDelta,
    reason: row.reason as string | null,
    createdBy: row.created_by as string | null,
    createdAt: row.created_at,
  };
}

function arrayResponse(value: unknown, resource: string): unknown[] {
  if (!Array.isArray(value)) return invalid(resource);
  return value;
}

function validateQuantity(value: number, label: string): void {
  if (!Number.isFinite(value) || value === 0 || !hasAtMostThreeDecimals(value)) {
    throw new ApiError(400, `${label} debe ser distinta de cero y tener máximo tres decimales.`, 'INVALID_INVENTORY_ADJUSTMENT');
  }
}

function validateAdjustment(type: string, delta: number, reason?: string): asserts type is IngredientAdjustmentType {
  if (!ADJUSTMENT_TYPES.has(type as IngredientAdjustmentType)) {
    throw new ApiError(400, 'Selecciona un tipo de ajuste válido.', 'INVALID_INVENTORY_ADJUSTMENT');
  }
  validateQuantity(delta, 'La cantidad');
  if (['opening_balance', 'purchase', 'return_to_stock'].includes(type) && delta < 0
    || ['expiration', 'spill', 'damage'].includes(type) && delta > 0) {
    throw new ApiError(400, 'La dirección del ajuste no coincide con el tipo seleccionado.', 'ADJUSTMENT_DIRECTION_INVALID');
  }
  if (reason && reason.length > 250) {
    throw new ApiError(400, 'La razón no puede superar 250 caracteres.', 'INVALID_INVENTORY_ADJUSTMENT');
  }
}

function uuid(): string {
  return crypto.randomUUID();
}

export function createInventoryService(client: HttpClient, getAccessToken: TokenProvider): InventoryService {
  const request = <T>(resource: string, options: Parameters<HttpClient['request']>[1] = {}) => (
    client.request<T>(resource, { ...options, accessToken: getAccessToken() })
  );
  const listAllPages = async (resource: string, query: Record<string, string>, signal?: AbortSignal) => {
    const pageSize = 200;
    const result: unknown[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const data = await request<unknown>(resource, {
        method: 'GET',
        query: { ...query, limit: String(pageSize), offset: String(offset) },
        signal,
      });
      const page = arrayResponse(data, resource);
      result.push(...page);
      if (page.length < pageSize) return result;
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    }
  };

  return {
    async listMeasurementUnits(signal) {
      const data = await request<unknown>('measurement_units', {
        method: 'GET', query: { select: 'code,name,abbreviation,category,base_unit,conversion_factor,active,sort_order', active: 'eq.true', order: 'sort_order.asc' }, signal,
      });
      return arrayResponse(data, 'unidades de medida').map(parseMeasurementUnit);
    },

    async listIngredientUnitConversions(ingredientId) {
      if (!UUID.test(ingredientId)) throw new ApiError(400, 'Selecciona un ingrediente válido.', 'INGREDIENT_NOT_FOUND');
      const data = await request<unknown>('ingredient_unit_conversions', {
        method: 'GET', query: { select: 'unit_code,quantity_in_base', ingredient_id: `eq.${ingredientId}` },
      });
      return arrayResponse(data, 'equivalencias por ingrediente').map(value => {
        const row = record(value, 'equivalencias por ingrediente');
        if (typeof row.unit_code !== 'string') return invalid('equivalencias por ingrediente');
        const quantityInBase = numberField(row.quantity_in_base, 'equivalencias por ingrediente');
        if (quantityInBase <= 0) return invalid('equivalencias por ingrediente');
        return { unitCode: row.unit_code, quantityInBase };
      });
    },

    async saveIngredientUnitConversion(input) {
      if (!UUID.test(input.ingredientId) || !input.unitCode || !Number.isFinite(input.quantityInBase)
        || input.quantityInBase <= 0 || !hasAtMostNineDecimals(input.quantityInBase)) {
        throw new ApiError(400, 'Indica una unidad y equivalencia positiva válidas.', 'INVALID_INGREDIENT_UNIT_CONVERSION');
      }
      const data = await request<unknown[]>('ingredient_unit_conversions', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=representation',
        query: { on_conflict: 'ingredient_id,unit_code', select: 'ingredient_id,unit_code,quantity_in_base' },
        body: { ingredient_id: input.ingredientId, unit_code: input.unitCode, quantity_in_base: input.quantityInBase },
      });
      const rows = arrayResponse(data, 'equivalencias por ingrediente');
      if (rows.length !== 1) return invalid('equivalencias por ingrediente');
      const row = record(rows[0], 'equivalencias por ingrediente');
      if (row.ingredient_id !== input.ingredientId || row.unit_code !== input.unitCode
        || numberField(row.quantity_in_base, 'equivalencias por ingrediente') <= 0) return invalid('equivalencias por ingrediente');
    },

    async deleteIngredientUnitConversion(ingredientId, unitCode) {
      if (!UUID.test(ingredientId) || !unitCode) throw new ApiError(400, 'Selecciona una equivalencia válida.', 'INVALID_INGREDIENT_UNIT_CONVERSION');
      await request<unknown>('ingredient_unit_conversions', {
        method: 'DELETE',
        query: { ingredient_id: `eq.${ingredientId}`, unit_code: `eq.${unitCode}` },
      });
    },

    async listIngredientPresentations(ingredientId, includeInactive = false): Promise<IngredientPresentation[]> {
      if (!UUID.test(ingredientId)) throw new ApiError(400, 'Selecciona un ingrediente válido.', 'INGREDIENT_NOT_FOUND');
      const data = await request<unknown>('ingredient_presentations', {
        method: 'GET',
        query: {
          select: 'id,ingredient_id,name,unit_code,quantity_in_base,active',
          ingredient_id: `eq.${ingredientId}`, ...(!includeInactive ? { active: 'eq.true' } : {}), order: 'name.asc',
        },
      });
      return arrayResponse(data, 'presentaciones').map(value => {
        const row = record(value, 'presentaciones');
        const quantityInBase = numberField(row.quantity_in_base, 'presentaciones');
        if (typeof row.id !== 'string' || !UUID.test(row.id) || row.ingredient_id !== ingredientId
          || typeof row.name !== 'string' || typeof row.unit_code !== 'string' || quantityInBase <= 0
          || typeof row.active !== 'boolean') return invalid('presentaciones');
        return { id: row.id, ingredientId, name: row.name, unitCode: row.unit_code, quantityInBase, active: row.active };
      });
    },

    async createIngredientPresentation(input) {
      if (!UUID.test(input.ingredientId) || !input.name.trim() || input.name.trim().length > 80 || !input.unitCode
        || !Number.isFinite(input.quantityInBase) || input.quantityInBase <= 0
        || !hasAtMostThreeDecimals(input.quantityInBase)) {
        throw new ApiError(400, 'Indica nombre, presentación y contenido positivo en unidad base.', 'INVALID_PRESENTATION');
      }
      const data = await request<unknown[]>('ingredient_presentations', {
        method: 'POST', prefer: 'return=representation',
        query: { select: 'id,ingredient_id,name,unit_code,quantity_in_base,active' },
        body: {
          ingredient_id: input.ingredientId, name: input.name.trim(), unit_code: input.unitCode,
          quantity_in_base: input.quantityInBase, active: true,
        },
      });
      const rows = arrayResponse(data, 'presentaciones');
      if (rows.length !== 1) return invalid('presentaciones');
      const row = record(rows[0], 'presentaciones');
      const quantityInBase = numberField(row.quantity_in_base, 'presentaciones');
      if (typeof row.id !== 'string' || !UUID.test(row.id) || row.ingredient_id !== input.ingredientId
        || typeof row.name !== 'string' || typeof row.unit_code !== 'string' || typeof row.active !== 'boolean'
        || quantityInBase <= 0) return invalid('presentaciones');
      return {
        id: row.id, ingredientId: row.ingredient_id, name: row.name, unitCode: row.unit_code,
        quantityInBase, active: row.active,
      };
    },

    async updateIngredientPresentation(id, changes) {
      if (!UUID.test(id) || (changes.name !== undefined && (!changes.name.trim() || changes.name.trim().length > 80))
        || (changes.quantityInBase !== undefined && (!Number.isFinite(changes.quantityInBase)
          || changes.quantityInBase <= 0 || !hasAtMostThreeDecimals(changes.quantityInBase)))) {
        throw new ApiError(400, 'Revisa nombre y contenido de la presentación.', 'INVALID_PRESENTATION');
      }
      const body: Row = {};
      if (changes.name !== undefined) body.name = changes.name.trim();
      if (changes.quantityInBase !== undefined) body.quantity_in_base = changes.quantityInBase;
      if (changes.active !== undefined) body.active = changes.active;
      if (!Object.keys(body).length) throw new ApiError(400, 'No hay cambios para guardar.', 'INVALID_PRESENTATION');
      const data = await request<unknown[]>('ingredient_presentations', {
        method: 'PATCH', prefer: 'return=representation',
        query: { id: `eq.${id}`, select: 'id,ingredient_id,name,unit_code,quantity_in_base,active' },
        body,
      });
      const rows = arrayResponse(data, 'presentaciones');
      if (rows.length !== 1) return invalid('presentaciones');
      const row = record(rows[0], 'presentaciones');
      const quantityInBase = numberField(row.quantity_in_base, 'presentaciones');
      if (typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.ingredient_id !== 'string'
        || typeof row.name !== 'string' || typeof row.unit_code !== 'string' || typeof row.active !== 'boolean') {
        return invalid('presentaciones');
      }
      return { id: row.id, ingredientId: row.ingredient_id, name: row.name, unitCode: row.unit_code, quantityInBase, active: row.active };
    },

    async listIngredients(signal) {
      return (await listAllPages('ingredients', {
        select: 'id,name,unit,stock,min_stock,active,created_at,updated_at', order: 'name.asc',
      }, signal)).map(parseIngredient);
    },

    async createIngredient(input) {
      if (!input.name.trim() || input.name.trim().length > 100 || !UNITS.has(input.unit)
        || !Number.isFinite(input.minStock) || input.minStock < 0 || !hasAtMostThreeDecimals(input.minStock)) {
        throw new ApiError(400, 'Revisa el nombre y la unidad del ingrediente.', 'INVALID_INVENTORY_ADJUSTMENT');
      }
      const data = await request<unknown[]>('ingredients', {
        method: 'POST',
        prefer: 'return=representation',
        body: { name: input.name.trim(), unit: input.unit, min_stock: input.minStock, active: input.active },
        query: { select: 'id,name,unit,stock,min_stock,active,created_at,updated_at' },
      });
      const rows = arrayResponse(data, 'ingredientes');
      if (rows.length !== 1) return invalid('ingredientes');
      return parseIngredient(rows[0]);
    },

    async updateIngredient(id, changes) {
      if (!UUID.test(id)) throw new ApiError(400, 'El ingrediente seleccionado no es válido.', 'INVALID_RESPONSE');
      const body: Row = {};
      if (changes.name !== undefined) {
        if (!changes.name.trim() || changes.name.trim().length > 100) throw new ApiError(400, 'El nombre debe tener entre 1 y 100 caracteres.', 'INVALID_INVENTORY_ADJUSTMENT');
        body.name = changes.name.trim();
      }
      if (changes.minStock !== undefined) {
        if (!Number.isFinite(changes.minStock) || changes.minStock < 0 || !hasAtMostThreeDecimals(changes.minStock)) {
          throw new ApiError(400, 'El mínimo debe ser no negativo y tener hasta tres decimales.', 'INVALID_INVENTORY_ADJUSTMENT');
        }
        body.min_stock = changes.minStock;
      }
      if (changes.active !== undefined) body.active = changes.active;
      if (!Object.keys(body).length) throw new ApiError(400, 'No hay cambios para guardar.', 'INVALID_INVENTORY_ADJUSTMENT');
      const data = await request<unknown[]>('ingredients', {
        method: 'PATCH',
        prefer: 'return=representation',
        query: { id: `eq.${id}`, select: 'id,name,unit,stock,min_stock,active,created_at,updated_at' },
        body,
      });
      const rows = arrayResponse(data, 'ingredientes');
      if (rows.length !== 1) return invalid('ingredientes');
      return parseIngredient(rows[0]);
    },

    async listProducts(signal) {
      const products = (await listAllPages('products', {
        select: 'id,name,stock,active', order: 'name.asc',
      }, signal)).map(parseProduct);
      const recipeRows = await listAllPages('product_ingredients', {
        select: 'product_id,quantity_per_portion,ingredient:ingredients(stock,active)',
      }, signal);
      const capacityByProduct = new Map<string, number>();
      const recipeProducts = new Set<string>();
      const blockedProducts = new Set<string>();
      for (const value of recipeRows) {
        const row = record(value, 'recetas de productos');
        const ingredient = record(row.ingredient, 'ingredientes de recetas');
        if (typeof row.product_id !== 'string' || !UUID.test(row.product_id) || typeof ingredient.active !== 'boolean') {
          return invalid('recetas de productos');
        }
        const quantity = numberField(row.quantity_per_portion, 'recetas de productos');
        const stock = numberField(ingredient.stock, 'ingredientes de recetas');
        if (quantity <= 0 || stock < 0 || !hasAtMostThreeDecimals(quantity) || !hasAtMostThreeDecimals(stock)) {
          return invalid('recetas de productos');
        }
        recipeProducts.add(row.product_id);
        if (!ingredient.active) blockedProducts.add(row.product_id);
        const capacity = Math.floor(stock / quantity);
        capacityByProduct.set(row.product_id, Math.min(capacityByProduct.get(row.product_id) ?? Number.POSITIVE_INFINITY, capacity));
      }
      return products.map(product => ({
        ...product,
        hasRecipe: recipeProducts.has(product.id),
        availableQuantity: !recipeProducts.has(product.id) || blockedProducts.has(product.id)
          ? null : capacityByProduct.get(product.id) ?? 0,
      }));
    },

    async listRecipe(productId) {
      if (!UUID.test(productId)) throw new ApiError(400, 'Selecciona un producto válido.', 'PRODUCT_NOT_FOUND');
      const data = await request<unknown>('product_ingredients', {
        method: 'GET',
        query: {
          select: 'product_id,ingredient_id,quantity_per_portion,preparation_quantity,preparation_unit_code,ingredient:ingredients(id,name,unit,active)',
          product_id: `eq.${productId}`,
        },
      });
      return arrayResponse(data, 'recetas').map(parseRecipeLine);
    },

    async replaceRecipe(productId, lines) {
      if (!UUID.test(productId)) throw new ApiError(400, 'Selecciona un producto válido.', 'PRODUCT_NOT_FOUND');
      if (lines.length === 0 || lines.length > 30 || new Set(lines.map(line => line.ingredientId)).size !== lines.length) {
        throw new ApiError(400, 'La receta admite hasta 30 ingredientes distintos.', 'INVALID_RECIPE');
      }
      for (const line of lines) {
        if (!UUID.test(line.ingredientId) || typeof line.unitCode !== 'string' || !line.unitCode
          || !Number.isFinite(line.quantity) || line.quantity <= 0 || !hasAtMostThreeDecimals(line.quantity)) {
          throw new ApiError(400, 'Cada ingrediente requiere una cantidad positiva y una unidad válida.', 'INVALID_RECIPE');
        }
      }
      const result = await request<unknown>('rpc/replace_product_recipe', {
        method: 'POST',
        body: {
          p_product_id: productId,
          p_lines: lines.map(line => ({
            ingredient_id: line.ingredientId,
            quantity: line.quantity,
            unit_code: line.unitCode,
          })),
        },
      });
      return typeof result === 'number' && Number.isFinite(result) ? result : lines.length;
    },

    async deleteRecipe(productId) {
      if (!UUID.test(productId)) throw new ApiError(400, 'Selecciona un producto válido.', 'PRODUCT_NOT_FOUND');
      const result = await request<unknown>('rpc/replace_product_recipe', {
        method: 'POST',
        body: { p_product_id: productId, p_lines: [] },
      });
      if (typeof result !== 'number' || result !== 0) return invalid('eliminación de receta');
    },

  async adjustIngredientStock(input) {
      validateAdjustment(input.type, input.delta, input.reason);
      if (!UUID.test(input.ingredientId)) throw new ApiError(400, 'Selecciona un ingrediente válido.', 'INGREDIENT_NOT_FOUND');
      if (!input.unitCode) throw new ApiError(400, 'Selecciona una unidad válida.', 'INVALID_INVENTORY_ADJUSTMENT');
      const idempotencyKey = input.idempotencyKey || uuid();
      if (!UUID.test(idempotencyKey)) throw new ApiError(400, 'La clave de operación no es válida.', 'INVALID_INVENTORY_ADJUSTMENT');
      const result = await request<unknown>('rpc/adjust_ingredient_stock_measurement', {
        method: 'POST',
        body: {
          p_ingredient_id: input.ingredientId,
          p_quantity: ['count_correction', 'manual_adjustment'].includes(input.type)
            ? input.delta : Math.abs(input.delta),
          p_unit_code: input.unitCode,
          p_type: input.type,
          p_idempotency_key: idempotencyKey,
          p_reason: input.reason?.trim() || null,
        },
      });
      const balance = typeof result === 'number' ? result
        : result && typeof result === 'object' && 'stock' in result ? Number((result as Row).stock) : NaN;
      if (!Number.isFinite(balance)) return invalid('saldo de inventario');
      return balance;
    },

    async purchaseIngredientPresentation(input) {
      if (!UUID.test(input.ingredientId) || !UUID.test(input.presentationId) || !UUID.test(input.idempotencyKey)
        || !Number.isFinite(input.quantity) || input.quantity <= 0 || !hasAtMostThreeDecimals(input.quantity)
        || (input.reason !== undefined && input.reason.length > 250)) {
        throw new ApiError(400, 'La presentación y cantidad de compra no son válidas.', 'INVALID_INVENTORY_ADJUSTMENT');
      }
      const result = await request<unknown>('rpc/record_ingredient_presentation_purchase', {
        method: 'POST',
        body: {
          p_ingredient_id: input.ingredientId, p_presentation_id: input.presentationId,
          p_quantity: input.quantity, p_idempotency_key: input.idempotencyKey,
          p_reason: input.reason?.trim() || null,
        },
      });
      const balance = typeof result === 'number' ? result
        : result && typeof result === 'object' && 'stock' in result ? Number((result as Row).stock) : NaN;
      if (!Number.isFinite(balance)) return invalid('saldo de inventario');
      return balance;
    },

    async adjustProductStock(input) {
      validateAdjustment(input.type, input.delta, input.reason);
      if (!UUID.test(input.productId)) throw new ApiError(400, 'Selecciona un producto válido.', 'PRODUCT_NOT_FOUND');
      const idempotencyKey = input.idempotencyKey || uuid();
      if (!UUID.test(idempotencyKey)) throw new ApiError(400, 'La clave de operación no es válida.', 'INVALID_INVENTORY_ADJUSTMENT');
      const result = await request<unknown>('rpc/adjust_product_stock', {
        method: 'POST',
        body: {
          p_product_id: input.productId,
          p_delta: input.delta,
          p_type: input.type,
          p_idempotency_key: idempotencyKey,
          p_reason: input.reason?.trim() || null,
        },
      });
      const balance = typeof result === 'number' ? result
        : result && typeof result === 'object' && 'stock' in result ? Number((result as Row).stock) : NaN;
      if (!Number.isFinite(balance)) return invalid('saldo de producto');
      return balance;
    },

    async listInventoryMovements(filter) {
      if (!filter.ingredientId && !filter.productId) {
        throw new ApiError(400, 'Selecciona un ingrediente o producto para consultar movimientos.', 'INVALID_INVENTORY_ADJUSTMENT');
      }
      const query: Record<string, string> = {
        select: 'id,ingredient_id,product_id,type,quantity_delta,reason,created_by,created_at',
        order: 'created_at.desc',
      };
      if (filter.ingredientId) query.ingredient_id = `eq.${filter.ingredientId}`;
      if (filter.productId) query.product_id = `eq.${filter.productId}`;
      return (await listAllPages('inventory_movements', query)).map(parseMovement);
    },
  };
}
