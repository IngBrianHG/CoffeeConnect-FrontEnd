import { ApiError, type HttpClient } from '../../services/http/client.ts';
import type { CafeOrder, CafeOrderItem, OrderStatus, PaymentStatus } from './model.ts';
import type {
  AccountLine, CloseSessionResult, PaymentAllocation, PaymentMethod, RecordPaymentResult,
  SessionAccount, SessionOrderCancellation, SessionPayment,
} from './accountModel.ts';
import { UUID, validatePaymentAllocations } from './accountValidation.ts';

const PAGE_SIZE = 200;
const ORDER_STATUSES = new Set<OrderStatus>(['pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled']);
const PAYMENT_STATUSES = new Set<PaymentStatus>(['unpaid', 'partial', 'paid']);
const PAYMENT_METHODS = new Set<PaymentMethod>(['cash', 'card', 'transfer', 'other']);
type Row = Record<string, unknown>;

export interface AccountService {
  getSessionAccount(sessionId: string, signal?: AbortSignal): Promise<SessionAccount>;
  recordPayment(
    sessionId: string,
    method: PaymentMethod,
    allocations: PaymentAllocation[],
    idempotencyKey: string,
    payerLabel?: string | null,
    reference?: string | null,
  ): Promise<RecordPaymentResult>;
  closeSessionAndCancelUnservedOrders(
    sessionId: string,
    cancellations: SessionOrderCancellation[],
    idempotencyKey: string,
  ): Promise<CloseSessionResult>;
}

function invalid(resource: string): never {
  throw new ApiError(200, `El servicio devolvió datos no válidos para ${resource}.`, 'INVALID_RESPONSE');
}
function record(value: unknown, resource: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(resource);
  return value as Row;
}
function uuid(value: unknown, resource: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) return invalid(resource);
  return value;
}
function timestamp(value: unknown, resource: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) return invalid(resource);
  return value;
}
function numeric(value: unknown, resource: string): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return invalid(resource);
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return invalid(resource);
  return parsed;
}
function parseSession(value: unknown): { id: string; tableId: string; status: 'open' | 'closed' | 'cancelled'; openedAt: string; closedAt: string | null } {
  const row = record(value, 'sesión');
  if (!['open', 'closed', 'cancelled'].includes(String(row.status))) return invalid('sesión');
  const status = row.status as 'open' | 'closed' | 'cancelled';
  const closedAt = row.closed_at === null ? null : timestamp(row.closed_at, 'sesión');
  if ((status === 'open' && closedAt !== null) || (status !== 'open' && closedAt === null)) return invalid('sesión');
  return {
    id: uuid(row.id, 'sesión') as string,
    tableId: uuid(row.table_id, 'sesión') as string,
    status,
    openedAt: timestamp(row.opened_at, 'sesión') as string,
    closedAt,
  };
}
function parseOrder(value: unknown): CafeOrder {
  const row = record(value, 'órdenes');
  if (!ORDER_STATUSES.has(row.status as OrderStatus) || !PAYMENT_STATUSES.has(row.payment_status as PaymentStatus)
    || !(row.notes === null || typeof row.notes === 'string')) return invalid('órdenes');
  const subtotal = numeric(row.subtotal, 'órdenes');
  const discountTotal = numeric(row.discount_total, 'órdenes');
  const total = numeric(row.total, 'órdenes');
  if (Math.abs(total - (subtotal - discountTotal)) > 0.011) return invalid('órdenes');
  return {
    id: uuid(row.id, 'órdenes') as string,
    tableSessionId: uuid(row.table_session_id, 'órdenes') as string,
    tableId: uuid(row.table_id, 'órdenes') as string,
    createdBy: uuid(row.created_by, 'órdenes', true),
    status: row.status as OrderStatus,
    paymentStatus: row.payment_status as PaymentStatus,
    subtotal, discountTotal, total, notes: row.notes,
    createdAt: timestamp(row.created_at, 'órdenes') as string,
    confirmedAt: timestamp(row.confirmed_at, 'órdenes', true),
    updatedAt: timestamp(row.updated_at, 'órdenes') as string,
  };
}
function parseItem(value: unknown): CafeOrderItem {
  const row = record(value, 'líneas');
  if (typeof row.product_name_snapshot !== 'string' || !row.product_name_snapshot.trim()
    || !(row.promotion_name === null || typeof row.promotion_name === 'string')
    || !(row.notes === null || typeof row.notes === 'string') || typeof row.uses_recipe !== 'boolean') return invalid('líneas');
  const quantity = numeric(row.quantity, 'líneas');
  const unitPrice = numeric(row.unit_price, 'líneas');
  const discountAmount = numeric(row.discount_amount, 'líneas');
  const subtotal = numeric(row.subtotal, 'líneas');
  if (!Number.isInteger(quantity) || quantity < 1 || unitPrice < 0 || discountAmount < 0 || subtotal < 0
    || Math.abs(subtotal - (unitPrice * quantity - discountAmount)) > 0.011) return invalid('líneas');
  return {
    id: uuid(row.id, 'líneas') as string,
    orderId: uuid(row.order_id, 'líneas') as string,
    productId: uuid(row.product_id, 'líneas') as string,
    productName: row.product_name_snapshot,
    quantity, unitPrice, discountAmount, subtotal,
    promotionName: row.promotion_name, notes: row.notes, usesRecipe: row.uses_recipe,
  };
}
export function createAccountService(
  client: HttpClient,
  getAccessToken: () => string | undefined = () => undefined,
  refreshAccessToken: () => Promise<string | null> = async () => null,
): AccountService {
  async function request<T>(resource: string, options: Parameters<HttpClient['request']>[1] = {}): Promise<T | null> {
    try {
      return await client.request<T>(resource, { ...options, accessToken: getAccessToken() });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      const token = await refreshAccessToken().catch(() => null);
      if (!token) throw error;
      return client.request<T>(resource, { ...options, accessToken: token });
    }
  }

  return {
    async getSessionAccount(sessionId, signal) {
      if (!UUID.test(sessionId)) throw new ApiError(400, 'La sesión seleccionada no es válida.', 'VALIDATION_ERROR');
      const sessions = await request<unknown[]>('table_sessions', {
        method: 'GET',
        query: { select: 'id,table_id,status,opened_at,closed_at', id: `eq.${sessionId}`, limit: '2' },
        signal,
      });
      if (!Array.isArray(sessions) || sessions.length !== 1) throw new ApiError(404, 'No se encontró la sesión.', 'SESSION_NOT_FOUND');
      const session = parseSession(sessions[0]);
      if (session.id !== sessionId) return invalid('relación sesión');

      const tables = await request<unknown[]>('cafe_tables', {
        method: 'GET', query: { select: 'id,name', id: `eq.${session.tableId}`, limit: '2' }, signal,
      });
      if (!Array.isArray(tables) || tables.length !== 1) return invalid('mesa');
      const tableRow = record(tables[0], 'mesa');
      if (uuid(tableRow.id, 'mesa') !== session.tableId || typeof tableRow.name !== 'string' || !tableRow.name.trim()) return invalid('mesa');
      const tableName = tableRow.name;

      const orders: CafeOrder[] = [];
      let offset = 0;
      let hasMoreOrders = true;
      while (hasMoreOrders) {
        const page = await request<unknown[]>('orders', {
          method: 'GET',
          query: {
            select: 'id,table_session_id,table_id,created_by,status,payment_status,subtotal,discount_total,total,notes,created_at,confirmed_at,updated_at',
            table_session_id: `eq.${sessionId}`, order: 'created_at.asc,id.asc',
            limit: String(PAGE_SIZE), offset: String(offset),
          },
          signal,
        });
        if (!Array.isArray(page)) return invalid('órdenes');
        const parsed = page.map(parseOrder);
        if (parsed.some(order => order.tableSessionId !== sessionId || order.tableId !== session.tableId)) return invalid('relación orden/sesión');
        if (new Set(parsed.map(order => order.id)).size !== parsed.length) return invalid('órdenes');
        orders.push(...parsed);
        hasMoreOrders = page.length === PAGE_SIZE;
        offset += page.length;
      }

      const items: CafeOrderItem[] = [];
      for (let i = 0; i < orders.length; i += 200) {
        const batch = orders.slice(i, i + 200);
        if (!batch.length) break;
        let itemOffset = 0;
        while (true) {
          const page = await request<unknown[]>('order_items', {
            method: 'GET',
            query: { select: 'id,order_id,product_id,product_name_snapshot,quantity,unit_price,discount_amount,subtotal,promotion_name,notes,uses_recipe',
              order_id: `in.(${batch.map(order => order.id).join(',')})`, order: 'id.asc',
              limit: String(PAGE_SIZE), offset: String(itemOffset) },
            signal,
          });
          if (!Array.isArray(page)) return invalid('líneas');
          const parsed = page.map(parseItem);
          items.push(...parsed);
          itemOffset += parsed.length;
          if (page.length < PAGE_SIZE) break;
        }
      }
      const orderIds = new Set(orders.map(order => order.id));
      if (items.some(item => !orderIds.has(item.orderId))) return invalid('relación orden/línea');
      if (new Set(items.map(item => item.id)).size !== items.length) return invalid('líneas');

      const payments: SessionPayment[] = [];
      const paymentRows: Array<Row & { id: string }> = [];
      offset = 0;
      while (true) {
        const page = await request<unknown[]>('payments', {
          method: 'GET',
          query: { select: 'id,table_session_id,method,amount,payer_label,reference,received_by,created_at',
            table_session_id: `eq.${sessionId}`, order: 'created_at.desc,id.desc',
            limit: String(PAGE_SIZE), offset: String(offset) }, signal,
        });
        if (!Array.isArray(page)) return invalid('pagos');
        paymentRows.push(...page.map(row => {
          const parsed = record(row, 'pagos');
          return { ...parsed, id: uuid(parsed.id, 'pagos') as string };
        }));
        offset += page.length;
        if (page.length < PAGE_SIZE) break;
      }
      for (let i = 0; i < paymentRows.length; i += 200) {
        const batch = paymentRows.slice(i, i + 200);
        const allocationRows: unknown[] = [];
        let allocationOffset = 0;
        while (true) {
          const allocationPage = await request<unknown[]>('payment_allocations', {
            method: 'GET',
            query: { select: 'payment_id,order_item_id,amount', payment_id: `in.(${batch.map(payment => payment.id).join(',')})`,
              order: 'payment_id.asc,order_item_id.asc', limit: String(PAGE_SIZE), offset: String(allocationOffset) }, signal,
          });
          if (!Array.isArray(allocationPage)) return invalid('asignaciones');
          allocationRows.push(...allocationPage);
          allocationOffset += allocationPage.length;
          if (allocationPage.length < PAGE_SIZE) break;
        }
        const paymentIdSet = new Set(batch.map(payment => payment.id));
        const itemIdSet = new Set(items.map(item => item.id));
        for (const row of allocationRows) {
          const allocation = record(row, 'asignaciones');
          if (!UUID.test(String(allocation.payment_id)) || !paymentIdSet.has(String(allocation.payment_id))
            || !UUID.test(String(allocation.order_item_id)) || !itemIdSet.has(String(allocation.order_item_id))) return invalid('relación asignación');
        }
        for (const payment of batch) {
          if (payment.table_session_id !== sessionId) return invalid('relación pago/sesión');
          if (!PAYMENT_METHODS.has(payment.method as PaymentMethod)) return invalid('pagos');
          const allocations = allocationRows
            .map(row => record(row, 'asignaciones'))
            .filter(row => row.payment_id === payment.id)
            .map(row => ({ orderItemId: uuid(row.order_item_id, 'asignaciones') as string, amount: numeric(row.amount, 'asignaciones') }));
          if (!allocations.length) return invalid('asignaciones');
          const allocationSum = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
          const amount = numeric(payment.amount, 'pagos');
          if (Math.abs(allocationSum - amount) > 0.011) return invalid('pagos/asignaciones');
          payments.push({
            id: payment.id,
            method: payment.method as PaymentMethod,
            amount,
            payerLabel: payment.payer_label === null ? null : typeof payment.payer_label === 'string' ? payment.payer_label : invalid('pagos'),
            reference: payment.reference === null ? null : typeof payment.reference === 'string' ? payment.reference : invalid('pagos'),
            createdAt: timestamp(payment.created_at, 'pagos') as string,
            allocations,
          });
        }
      }

      const paidByItem = new Map<string, number>();
      for (const payment of payments) {
        for (const allocation of payment.allocations) {
          paidByItem.set(allocation.orderItemId, (paidByItem.get(allocation.orderItemId) ?? 0) + allocation.amount);
        }
      }
      const orderMap = new Map(orders.map(order => [order.id, order]));
      const lines: AccountLine[] = items.map(item => {
        const order = orderMap.get(item.orderId);
        if (!order) return invalid('relación orden/línea');
        const paidAmount = paidByItem.get(item.id) ?? 0;
        const balance = item.subtotal - paidAmount;
        if (balance < -0.000001) return invalid('saldo de línea');
        return {
          orderId: item.orderId, orderItemId: item.id, orderStatus: order.status,
          productName: item.productName, quantity: item.quantity, unitPrice: item.unitPrice,
          lineTotal: item.subtotal, paidAmount, balance: Math.max(0, balance),
        };
      });
      const payableLines = lines.filter(line => line.orderStatus === 'served');
      const totalServed = payableLines.reduce((sum, line) => sum + line.lineTotal, 0);
      const totalPaid = payableLines.reduce((sum, line) => sum + line.paidAmount, 0);
      const balance = payableLines.reduce((sum, line) => sum + line.balance, 0);
      const complete = session.status === 'open'
        && !orders.some(order => !['served', 'cancelled'].includes(order.status))
        && balance <= 0.000001;
      return {
        tableSessionId: session.id, tableId: session.tableId, tableName, sessionStatus: session.status,
        openedAt: session.openedAt, closedAt: session.closedAt,
        lines, totalServed: Math.round(totalServed * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100, balance: Math.round(balance * 100) / 100,
        orders: orders.map(order => ({ ...order, items: items.filter(item => item.orderId === order.id) })),
        payments, complete, hasIncompleteRead: false,
      };
    },

    async recordPayment(sessionId, method, allocations, idempotencyKey, payerLabel = null, reference = null) {
      if (!UUID.test(sessionId) || !UUID.test(idempotencyKey)) {
        throw new ApiError(400, 'La sesión o la clave de pago no es válida.', 'VALIDATION_ERROR');
      }
      // La cuenta autoritativa se valida nuevamente contra el formulario antes de enviar.
      const account = await this.getSessionAccount(sessionId);
      validatePaymentAllocations(allocations, account.lines, method);
      const normalized = allocations.map(allocation => ({
        order_item_id: allocation.orderItemId,
        amount: Math.round(allocation.amount * 100) / 100,
      })).sort((a, b) => a.order_item_id.localeCompare(b.order_item_id));
      const value = await request<unknown>('rpc/record_session_payment', {
        method: 'POST',
        body: {
          p_table_session_id: sessionId, p_method: method, p_allocations: normalized,
          p_idempotency_key: idempotencyKey,
          p_payer_label: payerLabel?.trim() || null,
          p_reference: reference?.trim() || null,
        },
      });
      const row = record(value, 'registro de pago');
      const paymentId = uuid(row.payment_id, 'registro de pago') as string;
      if (row.idempotent_replay === true) {
        const replayAccount = await this.getSessionAccount(sessionId);
        const replay = replayAccount.payments.find(payment => payment.id === paymentId);
        if (!replay) return invalid('registro de pago repetido');
        return {
          paymentId,
          amount: replay.amount,
          method: replay.method,
          sessionClosed: replayAccount.sessionStatus === 'closed',
          idempotentReplay: true,
        };
      }
      const amount = numeric(row.amount, 'registro de pago');
      if (!PAYMENT_METHODS.has(row.method as PaymentMethod) || typeof row.session_closed !== 'boolean'
        || row.idempotent_replay !== undefined && typeof row.idempotent_replay !== 'boolean') return invalid('registro de pago');
      return {
        paymentId, amount, method: row.method as PaymentMethod,
        sessionClosed: row.session_closed, idempotentReplay: row.idempotent_replay === true,
      };
    },
    async closeSessionAndCancelUnservedOrders(sessionId, cancellations, idempotencyKey) {
      if (!UUID.test(sessionId) || !UUID.test(idempotencyKey)) {
        throw new ApiError(400, 'La sesión o clave de cierre no es válida.', 'VALIDATION_ERROR');
      }
      if (!Array.isArray(cancellations) || cancellations.length < 1 || cancellations.length > 200) {
        throw new ApiError(400, 'No hay órdenes pendientes válidas para cancelar.', 'INVALID_SESSION_CANCELLATIONS');
      }
      const account = await this.getSessionAccount(sessionId);
      if (account.sessionStatus === 'open') {
        if (account.balance !== 0) {
          throw new ApiError(409, 'No se puede cerrar: aún hay saldo de órdenes entregadas.', 'SESSION_HAS_UNPAID_SERVED_ORDERS');
        }
        const pendingOrders = account.orders.filter(order => ['pending', 'confirmed', 'preparing', 'ready'].includes(order.status));
        const expected = new Set(pendingOrders.map(order => order.id));
        if (cancellations.length !== pendingOrders.length
          || new Set(cancellations.map(item => item.orderId)).size !== cancellations.length
          || cancellations.some(item => !expected.has(item.orderId))) {
          throw new ApiError(400, 'La selección de órdenes pendientes cambió. Actualiza la cuenta.', 'INVALID_SESSION_CANCELLATIONS');
        }
        const statusById = new Map(pendingOrders.map(order => [order.id, order.status]));
        for (const cancellation of cancellations) {
          const status = statusById.get(cancellation.orderId);
          const prepared = status === 'preparing' || status === 'ready';
          const disposition = cancellation.preparedDisposition;
          if (prepared && disposition !== 'waste' && disposition !== 'reusable') {
            throw new ApiError(400, 'Selecciona merma o reutilizable para cada orden en preparación o lista.', 'INVALID_CANCEL_DISPOSITION');
          }
          if (!prepared && disposition !== null) {
            throw new ApiError(400, 'La opción de merma solo aplica a órdenes en preparación o listas.', 'INVALID_CANCEL_DISPOSITION');
          }
        }
      }
      let value: unknown;
      try {
        value = await request<unknown>('rpc/close_session_and_cancel_unserved_orders', {
          method: 'POST',
          body: {
            p_table_session_id: sessionId,
            p_cancellations: cancellations
              .map(item => ({ order_id: item.orderId, prepared_disposition: item.preparedDisposition }))
              .sort((a, b) => a.order_id.localeCompare(b.order_id)),
            p_idempotency_key: idempotencyKey,
          },
        });
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.code === 'PGRST202')) {
          throw new ApiError(error.status, 'El cierre de cuenta aún no está habilitado en Supabase. Se requiere aplicar la migración aprobada.', 'CLOSE_SESSION_NOT_CONFIGURED');
        }
        throw error;
      }
      const row = record(value, 'cierre de cuenta');
      if (uuid(row.table_session_id, 'cierre de cuenta') !== sessionId
        || row.status !== 'closed' || typeof row.idempotent_replay !== 'boolean'
        || !Array.isArray(row.cancelled_order_ids)) return invalid('cierre de cuenta');
      if (account.sessionStatus !== 'open' && row.idempotent_replay !== true) {
        return invalid('reintento de cierre');
      }
      const cancelledOrderIds = row.cancelled_order_ids.map(id => uuid(id, 'cierre de cuenta') as string);
      const expectedIds = new Set(cancellations.map(item => item.orderId));
      if (cancelledOrderIds.length !== expectedIds.size
        || new Set(cancelledOrderIds).size !== cancelledOrderIds.length
        || cancelledOrderIds.some(id => !expectedIds.has(id))) return invalid('cierre de cuenta');
      return { tableSessionId: sessionId, cancelledOrderIds, idempotentReplay: row.idempotent_replay };
    },
  };
}

export function accountErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No se pudo conectar con el servicio. Revisa la conexión e intenta de nuevo.';
  const messages: Record<string, string> = {
    VALIDATION_ERROR: error.message,
    INVALID_RESPONSE: 'El servicio devolvió datos no válidos. Actualiza la cuenta antes de cobrar.',
    SESSION_NOT_FOUND: 'La sesión ya no existe. Actualiza la vista.',
    SESSION_NOT_OPEN: 'La cuenta ya se cerró. Actualiza antes de otra operación.',
    PAYMENT_ITEM_NOT_PAYABLE: 'Una orden cambió o la línea ya no está servida. Actualiza la cuenta.',
    PAYMENT_EXCEEDS_ITEM_BALANCE: 'El saldo cambió. Actualiza la cuenta y vuelve a revisar el importe.',
    INVALID_PAYMENT_ALLOCATIONS: 'Corrige las líneas seleccionadas.',
    DUPLICATE_PAYMENT_ALLOCATION: 'Una línea aparece repetida. Consolida su importe.',
    INVALID_PAYMENT_AMOUNT: 'Los importes deben ser positivos.',
    INVALID_PAYMENT_PRECISION: 'Los importes pueden tener máximo dos decimales.',
    IDEMPOTENCY_KEY_REUSED: 'Esta clave ya se usó con otra intención. Confirma el intento previo y crea uno nuevo.',
    SESSION_HAS_UNPAID_SERVED_ORDERS: 'No se puede cerrar: primero debe cobrarse todo lo que fue entregado.',
    INVALID_SESSION_CANCELLATIONS: 'La lista de órdenes por cancelar cambió. Actualiza la cuenta.',
    INVALID_CANCEL_DISPOSITION: 'Selecciona cómo se manejarán las órdenes en preparación o listas.',
    ORDER_HAS_PAYMENT: 'No se puede cancelar una orden que ya tiene pagos asignados. Actualiza la cuenta.',
    CLOSE_SESSION_NOT_CONFIGURED: 'El cierre con cancelación aún no está habilitado en Supabase. Se requiere aplicar la migración incremental aprobada.',
    FORBIDDEN: 'No tienes permisos para registrar pagos.',
    '42501': 'No tienes permisos para registrar pagos.',
  };
  if (messages[error.code ?? '']) return messages[error.code ?? ''];
  if (error.status === 401) return 'La sesión expiró. Inicia sesión nuevamente.';
  if (error.status === 403) return 'No tienes permisos para registrar pagos.';
  if (error.status === 0 || error.status >= 500) return 'El servicio no confirmó el resultado. Reintenta con la misma intención.';
  return 'No se pudo completar la operación de cuenta.';
}
