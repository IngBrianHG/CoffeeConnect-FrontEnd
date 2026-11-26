/**
 * Promoción / oferta.
 *  - NXM:     lleva buy_qty y paga pay_qty (2x1, 3x2...)
 *  - PERCENT: porcentaje de descuento
 * Alcance: product_id (un producto), category_id (una categoría) o ninguno (todo el menú).
 */
export interface Promotion {
  id: number;
  name: string;
  description?: string | null;
  type: 'NXM' | 'PERCENT';
  buy_qty: number;
  pay_qty: number;
  percent: number | null;
  product_id: number | null;
  category_id: number | null;
  product_name?: string | null;
  category_name?: string | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
}
