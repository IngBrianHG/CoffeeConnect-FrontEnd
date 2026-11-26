/**
 * Ingrediente del inventario (leche, café, harina...). Se comparte entre todas las recetas.
 */
export interface Ingredient {
  id: number;
  name: string;
  /** Unidad de medida: ml, g, unidad... */
  unit: string;
  stock: number;
  /** Por debajo (o igual) a este valor se muestra alerta de poco inventario */
  min_stock: number;
  /** true si stock <= min_stock */
  low: boolean;
  /** En cuántas recetas se usa */
  used_in?: number;
}

/** Una línea de receta: cuánto de un ingrediente lleva UNA porción del producto */
export interface RecipeLine {
  ingredient_id: number;
  quantity: number;
  name?: string;
  unit?: string;
}
