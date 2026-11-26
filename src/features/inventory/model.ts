export type InventoryUnit = 'g' | 'ml' | 'unit';
export type MeasurementCategory = 'weight' | 'volume' | 'preparation' | 'count' | 'purchase';

export interface MeasurementUnit {
  code: string;
  name: string;
  abbreviation: string;
  category: MeasurementCategory;
  baseUnit: InventoryUnit | null;
  conversionFactor: number | null;
  active: boolean;
  sortOrder: number;
}

export interface IngredientPresentation {
  id: string;
  ingredientId: string;
  name: string;
  unitCode: string;
  quantityInBase: number;
  active: boolean;
}

export type IngredientAdjustmentType =
  | 'opening_balance'
  | 'purchase'
  | 'expiration'
  | 'spill'
  | 'damage'
  | 'count_correction'
  | 'return_to_stock'
  | 'manual_adjustment';

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
  ingredientActive: boolean;
  quantityPerPortion: number;
  preparationQuantity: number | null;
  preparationUnitCode: string | null;
}

export interface InventoryMovement {
  id: string;
  ingredientId: string | null;
  productId: string | null;
  type: string;
  quantityDelta: number;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface InventoryProduct {
  id: string;
  name: string;
  stock: number;
  active: boolean;
  hasRecipe: boolean;
  availableQuantity: number | null;
}

export interface InventoryService {
  listMeasurementUnits(signal?: AbortSignal): Promise<MeasurementUnit[]>;
  listIngredientUnitConversions(ingredientId: string): Promise<Array<{ unitCode: string; quantityInBase: number }>>;
  saveIngredientUnitConversion(input: { ingredientId: string; unitCode: string; quantityInBase: number }): Promise<void>;
  deleteIngredientUnitConversion(ingredientId: string, unitCode: string): Promise<void>;
  listIngredientPresentations(ingredientId: string, includeInactive?: boolean): Promise<IngredientPresentation[]>;
  createIngredientPresentation(input: {
    ingredientId: string; name: string; unitCode: string; quantityInBase: number;
  }): Promise<IngredientPresentation>;
  updateIngredientPresentation(id: string, changes: {
    name?: string; quantityInBase?: number; active?: boolean;
  }): Promise<IngredientPresentation>;
  listIngredients(signal?: AbortSignal): Promise<Ingredient[]>;
  createIngredient(input: Pick<Ingredient, 'name' | 'unit' | 'minStock' | 'active'>): Promise<Ingredient>;
  updateIngredient(id: string, changes: Partial<Pick<Ingredient, 'name' | 'minStock' | 'active'>>): Promise<Ingredient>;
  listProducts(signal?: AbortSignal): Promise<InventoryProduct[]>;
  listRecipe(productId: string): Promise<RecipeLine[]>;
  replaceRecipe(productId: string, lines: Array<{ ingredientId: string; quantity: number; unitCode: string }>): Promise<number>;
  deleteRecipe(productId: string): Promise<void>;
  adjustIngredientStock(input: {
    ingredientId: string;
    delta: number;
    unitCode: string;
    type: IngredientAdjustmentType;
    idempotencyKey: string;
    reason?: string;
  }): Promise<number>;
  purchaseIngredientPresentation(input: {
    ingredientId: string; presentationId: string; quantity: number; idempotencyKey: string; reason?: string;
  }): Promise<number>;
  adjustProductStock(input: {
    productId: string;
    delta: number;
    type: IngredientAdjustmentType;
    idempotencyKey: string;
    reason?: string;
  }): Promise<number>;
  listInventoryMovements(filter: { ingredientId?: string; productId?: string }): Promise<InventoryMovement[]>;
}
