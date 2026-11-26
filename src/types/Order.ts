/**
 * OrderItem type representing an item in an order
 */
export interface OrderItem {
  product_id: number;
  quantity: number;
  unit_price: number;
  subtotal: number;
  /** Comentario del cliente sobre este producto (ej: "con 2 cucharadas de azúcar") */
  notes?: string | null;
  /** Descuento aplicado a esta línea por una promoción */
  discount?: number;
  promo_name?: string | null;
  product_name?: string;
}

/**
 * CartItem type representing a product in the shopping cart
 */
export interface CartItem {
  /** Identificador de la línea: permite tener el mismo producto con comentarios distintos */
  lineId: string;
  product: import('./Product').Product;
  quantity: number;
  /** Subtotal SIN descuento (el descuento se calcula aparte con calculateCartPricing) */
  subtotal: number;
  notes?: string;
}

/**
 * Order type representing a complete order
 */
export interface Order {
  id?: number;
  mesa_id: string;
  mesa_name?: string;
  pago_id?: number | null;
  customer_name?: string;
  items: OrderItem[];
  total: number;
  discount_total?: number;
  /** Cantidad de productos del pedido que traen comentario (lo envía la lista de pedidos) */
  notes_count?: number;
  status?: string;
  created_at?: string;
}

/**
 * API response for order creation
 */
export interface OrderResponse {
  id: number;
  mesa_id: string;
  pago_id?: number | null;
  total: number;
  status: string;
  created_at: string;
}
