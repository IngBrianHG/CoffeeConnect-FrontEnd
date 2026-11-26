/**
 * Product type representing a menu item
 */
export interface Product {
  id: number;
  name: string;
  price: number;
  category_id: number;
  image?: string;
  description?: string;
  active?: boolean;
  created_at?: string;
  /** Sin receta: stock propio. Con receta: porciones que alcanzan con el inventario de ingredientes */
  stock?: number;
  /** true si el stock se calcula a partir de una receta de ingredientes */
  has_recipe?: boolean;
  /** Con receta: ingrediente que limita cuántas porciones se pueden preparar (ej: "Leche") */
  limited_by?: string | null;
}
