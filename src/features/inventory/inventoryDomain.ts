import type {
  Ingredient,
  IngredientAdjustmentType,
  InventoryUnit,
  MeasurementUnit,
} from './model';

export type RecipeDraftRow = {
  id: string;
  ingredientId: string;
  quantity: string;
  unitCode: string;
};

export const adjustmentTypes: { value: IngredientAdjustmentType; label: string; sign: 1 | -1 | 0 }[] = [
  { value: 'opening_balance', label: 'Saldo inicial', sign: 1 },
  { value: 'purchase', label: 'Reposición / compra', sign: 1 },
  { value: 'expiration', label: 'Vencimiento', sign: -1 },
  { value: 'spill', label: 'Derrame', sign: -1 },
  { value: 'damage', label: 'Daño', sign: -1 },
  { value: 'count_correction', label: 'Corrección de conteo', sign: 0 },
  { value: 'return_to_stock', label: 'Devolución a stock', sign: 1 },
  { value: 'manual_adjustment', label: 'Ajuste manual', sign: 0 },
];

export const movementLabels: Record<string, string> = {
  opening_balance: 'Saldo inicial',
  purchase: 'Compra / reposición',
  expiration: 'Vencimiento',
  spill: 'Derrame',
  damage: 'Daño',
  count_correction: 'Corrección de conteo',
  return_to_stock: 'Devolución a existencias',
  manual_adjustment: 'Ajuste manual',
  order_consumption: 'Consumo por pedido',
  order_reversal: 'Devolución por pedido',
};

export function formatQuantity(value: number): string {
  return value.toLocaleString('es', { maximumFractionDigits: 3 });
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function newRecipeRow(): RecipeDraftRow {
  return { id: crypto.randomUUID(), ingredientId: '', quantity: '', unitCode: '' };
}

export function adjustmentDelta(type: IngredientAdjustmentType, quantity: number): number {
  const sign = adjustmentTypes.find(item => item.value === type)?.sign ?? 0;
  return sign < 0 ? -Math.abs(quantity) : sign > 0 ? Math.abs(quantity) : quantity;
}

export function isSignedAdjustment(type: IngredientAdjustmentType): boolean {
  return type === 'manual_adjustment' || type === 'count_correction';
}

export function compatibleUnits(
  ingredient: Ingredient | undefined,
  units: MeasurementUnit[],
  conversions: Record<string, Record<string, number>>,
): Set<string> {
  if (!ingredient) return new Set();
  return new Set(units.filter(unit =>
    unit.category !== 'purchase' && (unit.baseUnit === ingredient.unit
      || conversions[ingredient.id]?.[unit.code] !== undefined),
  ).map(unit => unit.code));
}

export function estimateRecipeQuantity(
  quantityText: string,
  unitCode: string,
  ingredient: Ingredient | undefined,
  units: MeasurementUnit[],
  conversions: Record<string, Record<string, number>>,
): number | null {
  if (!ingredient || !unitCode || !quantityText.trim()) return null;
  const unit = units.find(item => item.code === unitCode);
  const quantity = Number(quantityText);
  if (!unit || !Number.isFinite(quantity) || quantity <= 0) return null;
  const factor = unit.baseUnit === ingredient.unit
    ? unit.conversionFactor
    : conversions[ingredient.id]?.[unit.code];
  return factor ? Math.round(quantity * factor * 1000) / 1000 : null;
}

export function estimateRecipeRow(
  row: RecipeDraftRow,
  ingredient: Ingredient | undefined,
  units: MeasurementUnit[],
  conversions: Record<string, Record<string, number>>,
): number | null {
  return estimateRecipeQuantity(row.quantity, row.unitCode, ingredient, units, conversions);
}

export function inventoryUnitName(unit: InventoryUnit): string {
  return unit === 'g' ? 'gramos' : unit === 'ml' ? 'mililitros' : 'unidades';
}
