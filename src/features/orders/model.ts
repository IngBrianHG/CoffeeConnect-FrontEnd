export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface CafeOrder {
  id: string;
  tableSessionId: string;
  tableId: string;
  createdBy: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  discountTotal: number;
  total: number;
  notes: string | null;
  createdAt: string;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface CafeOrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  subtotal: number;
  promotionName: string | null;
  notes: string | null;
  usesRecipe: boolean;
}

export interface CreateOrderLine {
  productId: string;
  quantity: number;
  notes?: string | null;
}

export interface OrderWithItems extends CafeOrder {
  items: CafeOrderItem[];
}

export interface KioskOrderTracking {
  orderId: string;
  status: OrderStatus;
  createdAt: string;
  items: Array<{ productName: string; quantity: number }>;
}
