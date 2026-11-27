import { ApiError } from '../../services/http/client.ts';
import type { AccountLine, PaymentAllocation, PaymentMethod } from './accountModel';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PAYMENT_METHODS = new Set<PaymentMethod>(['cash', 'card', 'transfer', 'other']);

export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function validatePaymentAllocations(
  allocations: PaymentAllocation[],
  lines: AccountLine[],
  method: PaymentMethod,
): void {
  if (!PAYMENT_METHODS.has(method)) throw new ApiError(400, 'Selecciona un método de pago válido.', 'INVALID_PAYMENT_ALLOCATIONS');
  if (allocations.length < 1 || allocations.length > 100) {
    throw new ApiError(400, 'Incluye al menos una línea y como máximo 100.', 'INVALID_PAYMENT_ALLOCATIONS');
  }
  const ids = new Set<string>();
  for (const allocation of allocations) {
    if (!UUID.test(allocation.orderItemId) || ids.has(allocation.orderItemId)) {
      throw new ApiError(400, 'No repitas una línea ni uses identificadores inválidos.', 'DUPLICATE_PAYMENT_ALLOCATION');
    }
    ids.add(allocation.orderItemId);
    if (!Number.isFinite(allocation.amount) || allocation.amount <= 0) {
      throw new ApiError(400, 'El importe debe ser mayor que cero.', 'INVALID_PAYMENT_AMOUNT');
    }
    if (Math.abs(money(allocation.amount) - allocation.amount) > 0.000001) {
      throw new ApiError(400, 'Los importes deben tener máximo dos decimales.', 'INVALID_PAYMENT_PRECISION');
    }
    const line = lines.find(candidate => candidate.orderItemId === allocation.orderItemId);
    if (!line || line.orderStatus !== 'served') {
      throw new ApiError(409, 'Una línea seleccionada ya no está disponible para cobrar.', 'PAYMENT_ITEM_NOT_PAYABLE');
    }
    if (allocation.amount > line.balance + 0.000001) {
      throw new ApiError(409, 'El importe supera el saldo de la línea. Actualiza la cuenta.', 'PAYMENT_EXCEEDS_ITEM_BALANCE');
    }
  }
}
