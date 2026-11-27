import type { OrderWithItems, OrderStatus } from './model.ts';

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'other';
export type PreparedOrderDisposition = 'waste' | 'reusable';

export interface SessionOrderCancellation {
  orderId: string;
  preparedDisposition: PreparedOrderDisposition | null;
}

export interface CloseSessionResult {
  tableSessionId: string;
  cancelledOrderIds: string[];
  idempotentReplay: boolean;
}

export interface AccountLine {
  orderId: string;
  orderItemId: string;
  orderStatus: OrderStatus;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  paidAmount: number;
  balance: number;
}

export interface SessionPayment {
  id: string;
  method: PaymentMethod;
  amount: number;
  payerLabel: string | null;
  reference: string | null;
  createdAt: string;
  allocations: Array<{ orderItemId: string; amount: number }>;
}

export interface SessionAccount {
  tableSessionId: string;
  tableId: string;
  tableName: string;
  sessionStatus: 'open' | 'closed' | 'cancelled';
  openedAt: string;
  closedAt: string | null;
  lines: AccountLine[];
  totalServed: number;
  totalPaid: number;
  balance: number;
  orders: OrderWithItems[];
  payments: SessionPayment[];
  complete: boolean;
  hasIncompleteRead: boolean;
}

export interface PaymentAllocation {
  orderItemId: string;
  amount: number;
}

export interface RecordPaymentResult {
  paymentId: string;
  amount: number;
  method: PaymentMethod;
  sessionClosed: boolean;
  idempotentReplay: boolean;
}
