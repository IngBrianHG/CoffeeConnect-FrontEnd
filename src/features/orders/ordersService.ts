import { ApiError, type HttpClient } from '../../services/http/client.ts';
import type {
  CafeOrder, CafeOrderItem, CreateOrderLine, KioskOrderTracking, KioskTableAccount, KioskTableAccountItem,
  OrderStatus, PaymentStatus, OrderWithItems,
} from './model';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_STATUSES = new Set<OrderStatus>(['pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled']);
const PAYMENT_STATUSES = new Set<PaymentStatus>(['unpaid', 'partial', 'paid']);
const ORDER_SELECT = 'id,table_session_id,table_id,created_by,status,payment_status,subtotal,discount_total,total,notes,created_at,confirmed_at,updated_at';
const ITEM_SELECT = 'id,order_id,product_id,product_name_snapshot,quantity,unit_price,discount_amount,subtotal,promotion_name,notes,uses_recipe';
type Row = Record<string, unknown>;

export interface CafeOrdersService {
  createOrder(tableId: string, items: CreateOrderLine[], idempotencyKey: string): Promise<string>;
  getKioskOrderStatus(idempotencyKey: string, signal?: AbortSignal): Promise<KioskOrderTracking | null>;
  getPublicKioskTableAccount(tableId: string, signal?: AbortSignal): Promise<KioskTableAccount | null>;
  listOrders(options?: { offset?: number; status?: OrderStatus; statusGroup?: 'active' | 'terminal'; tableId?: string; tableSessionId?: string; signal?: AbortSignal }): Promise<CafeOrder[]>;
  listOrderItems(orderIds: string[], signal?: AbortSignal): Promise<CafeOrderItem[]>;
  getOrder(id: string, signal?: AbortSignal): Promise<OrderWithItems>;
  confirmOrder(id: string): Promise<OrderStatus>;
  advanceOrder(id: string, nextStatus: Extract<OrderStatus, 'preparing' | 'ready' | 'served'>): Promise<OrderStatus>;
  cancelOrder(id: string, reason?: string | null): Promise<OrderStatus>;
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
function numeric(value: unknown, resource: string): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return invalid(resource);
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result)) return invalid(resource);
  return result;
}
function timestamp(value: unknown, resource: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) return invalid(resource);
  return value;
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
  const row = record(value, 'líneas de órdenes');
  if (typeof row.product_name_snapshot !== 'string' || !row.product_name_snapshot.trim()
    || !(row.promotion_name === null || typeof row.promotion_name === 'string')
    || !(row.notes === null || typeof row.notes === 'string') || typeof row.uses_recipe !== 'boolean') return invalid('líneas de órdenes');
  const quantity = numeric(row.quantity, 'líneas de órdenes');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return invalid('líneas de órdenes');
  const unitPrice = numeric(row.unit_price, 'líneas de órdenes');
  const discountAmount = numeric(row.discount_amount, 'líneas de órdenes');
  const subtotal = numeric(row.subtotal, 'líneas de órdenes');
  if (unitPrice < 0 || discountAmount < 0 || subtotal < 0
    || Math.abs(subtotal - (unitPrice * quantity - discountAmount)) > 0.011) return invalid('líneas de órdenes');
  return {
    id: uuid(row.id, 'líneas de órdenes') as string,
    orderId: uuid(row.order_id, 'líneas de órdenes') as string,
    productId: uuid(row.product_id, 'líneas de órdenes') as string,
    productName: row.product_name_snapshot,
    quantity, unitPrice, discountAmount, subtotal,
    promotionName: row.promotion_name, notes: row.notes, usesRecipe: row.uses_recipe,
  };
}
function parseArray<T>(value: unknown, resource: string, parse: (row: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalid(resource);
  const parsed = value.map(parse);
  const ids = new Set<string>();
  for (const item of parsed) {
    const id = (item as { id: string }).id;
    if (ids.has(id)) return invalid(resource);
    ids.add(id);
  }
  return parsed;
}
function parseRpcStatus(value: unknown, expectedOrderId: string): OrderStatus {
  const row = record(value, 'estado de orden');
  if (uuid(row.order_id, 'estado de orden') !== expectedOrderId || !ORDER_STATUSES.has(row.status as OrderStatus)) return invalid('estado de orden');
  return row.status as OrderStatus;
}

function parseKioskOrderTracking(value: unknown): KioskOrderTracking {
  const row = record(value, 'seguimiento del pedido');
  if (!ORDER_STATUSES.has(row.status as OrderStatus) || !Array.isArray(row.items)) return invalid('seguimiento del pedido');
  const items = row.items.map(value => {
    const item = record(value, 'seguimiento del pedido');
    const quantity = numeric(item.quantity, 'seguimiento del pedido');
    if (typeof item.product_name !== 'string' || !item.product_name.trim()
      || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return invalid('seguimiento del pedido');
    return { productName: item.product_name, quantity };
  });
  if (items.length < 1 || items.length > 50) return invalid('seguimiento del pedido');
  return {
    orderId: uuid(row.order_id, 'seguimiento del pedido') as string,
    status: row.status as OrderStatus,
    createdAt: timestamp(row.created_at, 'seguimiento del pedido') as string,
    items,
  };
}

function parseKioskTableAccount(value: unknown): KioskTableAccount {
  const row = record(value, 'cuenta pública de mesa');
  const tableId = uuid(row.table_id, 'cuenta pública de mesa') as string;
  const tableSessionId = uuid(row.table_session_id, 'cuenta pública de mesa') as string;
  if (typeof row.table_name !== 'string' || !row.table_name.trim() || !Array.isArray(row.orders)) {
    return invalid('cuenta pública de mesa');
  }
  const orders = row.orders.map(value => {
    const order = record(value, 'cuenta pública de mesa');
    if (!ORDER_STATUSES.has(order.status as OrderStatus) || !Array.isArray(order.items)
      || uuid(order.table_id, 'cuenta pública de mesa') !== tableId
      || uuid(order.table_session_id, 'cuenta pública de mesa') !== tableSessionId) return invalid('cuenta pública de mesa');
    const subtotal = numeric(order.subtotal, 'cuenta pública de mesa');
    const discountTotal = numeric(order.discount_total, 'cuenta pública de mesa');
    const total = numeric(order.total, 'cuenta pública de mesa');
    if (subtotal < 0 || discountTotal < 0 || discountTotal > subtotal
      || Math.abs(total - (subtotal - discountTotal)) > 0.011
      || order.items.length < 1 || order.items.length > 50) return invalid('cuenta pública de mesa');
    const items: KioskTableAccountItem[] = order.items.map(value => {
      const item = record(value, 'cuenta pública de mesa');
      if (typeof item.product_name !== 'string' || !item.product_name.trim()
        || !(item.promotion_name === null || typeof item.promotion_name === 'string')
        || !(item.notes === null || typeof item.notes === 'string')) return invalid('cuenta pública de mesa');
      const quantity = numeric(item.quantity, 'cuenta pública de mesa');
      const unitPrice = numeric(item.unit_price, 'cuenta pública de mesa');
      const discountAmount = numeric(item.discount_amount, 'cuenta pública de mesa');
      const itemSubtotal = numeric(item.subtotal, 'cuenta pública de mesa');
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99 || unitPrice <= 0
        || discountAmount < 0 || itemSubtotal < 0
        || Math.abs(itemSubtotal - (unitPrice * quantity - discountAmount)) > 0.011) return invalid('cuenta pública de mesa');
      return {
        id: uuid(item.id, 'cuenta pública de mesa') as string,
        productName: item.product_name,
        quantity,
        unitPrice,
        discountAmount,
        subtotal: itemSubtotal,
        promotionName: item.promotion_name,
        notes: item.notes,
      };
    });
    if (Math.abs(items.reduce((sum, item) => sum + item.subtotal, 0) - total) > 0.011) return invalid('cuenta pública de mesa');
    return {
      id: uuid(order.id, 'cuenta pública de mesa') as string,
      tableId,
      tableSessionId,
      status: order.status as OrderStatus,
      subtotal,
      discountTotal,
      total,
      createdAt: timestamp(order.created_at, 'cuenta pública de mesa') as string,
      items,
    };
  });
  const orderIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const order of orders) {
    if (orderIds.has(order.id)) return invalid('cuenta pública de mesa');
    orderIds.add(order.id);
    for (const item of order.items) {
      if (itemIds.has(item.id)) return invalid('cuenta pública de mesa');
      itemIds.add(item.id);
    }
  }
  return {
    tableId,
    tableName: row.table_name,
    tableSessionId,
    openedAt: timestamp(row.opened_at, 'cuenta pública de mesa') as string,
    orders,
  };
}

function logOrderApi(
  phase: 'solicitud' | 'respuesta' | 'error',
  resource: string,
  options: Parameters<HttpClient['request']>[1],
  detail: unknown,
  attempt: number,
) {
  if (!import.meta.env?.DEV) return;
  const method = options?.method ?? (options?.body === undefined ? 'GET' : 'POST');
  const label = `[API órdenes] ${phase.toUpperCase()} ${method} /rest/v1/${resource} (intento ${attempt})`;
  if (phase === 'solicitud') {
    const body = options?.body && typeof options.body === 'object' && !Array.isArray(options.body)
      ? { ...(options.body as Record<string, unknown>), ...(Object.hasOwn(options.body, 'p_idempotency_key') ? { p_idempotency_key: '[oculta]' } : {}) }
      : options?.body ?? null;
    console.info(label, {
      query: options?.query ?? null,
      body,
      userTokenAttached: Boolean(options?.accessToken),
    });
  } else if (phase === 'error' && detail instanceof ApiError) {
    console.error(label, {
      status: detail.status,
      code: detail.code ?? null,
      message: detail.message,
      userMessage: ordersErrorMessage(detail),
    });
  } else if (phase === 'error') {
    console.error(label, detail);
  } else {
    console.info(label, detail);
  }
}

export function createCafeOrdersService(
  client: HttpClient,
  getAccessToken: () => string | undefined = () => undefined,
  refreshAccessToken: () => Promise<string | null> = async () => null,
): CafeOrdersService {
  async function send<T>(
    resource: string,
    options: Parameters<HttpClient['request']>[1],
    accessToken?: string,
    attempt: number = 1,
  ): Promise<T | null> {
    const requestOptions = { ...options, accessToken };
    logOrderApi('solicitud', resource, requestOptions, null, attempt);
    try {
      const result = await client.request<T>(resource, requestOptions);
      logOrderApi('respuesta', resource, requestOptions, result, attempt);
      return result;
    } catch (error) {
      logOrderApi('error', resource, requestOptions, error, attempt);
      throw error;
    }
  }
  async function request<T>(resource: string, options: Parameters<HttpClient['request']>[1] = {}): Promise<T | null> {
    try {
      return await send<T>(resource, options, getAccessToken());
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      const token = await refreshAccessToken().catch(() => null);
      if (!token) throw error;
      return send<T>(resource, options, token, 2);
    }
  }
  return {
    async createOrder(tableId, items, idempotencyKey) {
      if (!UUID.test(tableId) || !UUID.test(idempotencyKey) || !Array.isArray(items) || items.length < 1 || items.length > 50) {
        throw new ApiError(400, 'Revisa la mesa y los productos del pedido.', 'VALIDATION_ERROR');
      }
      const normalized = items.map(item => {
      if (!item || !UUID.test(item.productId) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
          || (item.notes != null && (typeof item.notes !== 'string' || item.notes.length > 200))) {
          if (import.meta.env?.DEV) console.error('[API órdenes] VALIDACIÓN POST /rest/v1/rpc/create_public_order', {
            productId: item?.productId ?? null,
            quantity: item?.quantity ?? null,
            notesLength: typeof item?.notes === 'string' ? item.notes.length : null,
          });
          throw new ApiError(400, 'Revisa las cantidades y comentarios del pedido.', 'VALIDATION_ERROR');
        }
        return { product_id: item.productId, quantity: item.quantity, notes: item.notes?.trim() || null };
      });
      const result = await request<unknown>('rpc/create_public_order', {
        method: 'POST', body: { p_table_id: tableId, p_items: normalized, p_idempotency_key: idempotencyKey },
      });
      return uuid(result, 'creación de orden') as string;
    },
    async getKioskOrderStatus(idempotencyKey, signal) {
      if (!UUID.test(idempotencyKey)) throw new ApiError(400, 'La clave de seguimiento no es válida.', 'VALIDATION_ERROR');
      try {
        const result = await request<unknown>('rpc/get_public_kiosk_order_status', {
          method: 'POST', body: { p_idempotency_key: idempotencyKey }, signal,
        });
        return result === null ? null : parseKioskOrderTracking(result);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.code === 'PGRST202')) {
          throw new ApiError(error.status, 'El seguimiento del pedido todavía no está habilitado en el servidor.', 'TRACKING_NOT_CONFIGURED');
        }
        throw error;
      }
    },
    async getPublicKioskTableAccount(tableId, signal) {
      if (!UUID.test(tableId)) throw new ApiError(400, 'El identificador de mesa no es válido.', 'VALIDATION_ERROR');
      try {
        const result = await request<unknown>('rpc/get_public_kiosk_table_account', {
          method: 'POST', body: { p_table_id: tableId }, signal,
        });
        return result === null ? null : parseKioskTableAccount(result);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.code === 'PGRST202')) {
          throw new ApiError(error.status, 'La consulta de cuenta de mesa aún no está habilitada en el servidor.', 'TABLE_ACCOUNT_NOT_CONFIGURED');
        }
        throw error;
      }
    },
    async listOrders(options = {}) {
      const offset = options.offset ?? 0;
      if (!Number.isInteger(offset) || offset < 0 || (options.tableId && !UUID.test(options.tableId))
        || (options.tableSessionId && !UUID.test(options.tableSessionId))) {
        throw new ApiError(400, 'El filtro de órdenes no es válido.', 'VALIDATION_ERROR');
      }
      const query: Record<string, string> = { select: ORDER_SELECT, order: 'created_at.asc,id.asc', limit: '200', offset: String(offset) };
      if (options.status) {
        if (!ORDER_STATUSES.has(options.status) || options.statusGroup) throw new ApiError(400, 'El filtro de estado no es válido.', 'VALIDATION_ERROR');
        query.status = `eq.${options.status}`;
      } else if (options.statusGroup === 'active') {
        query.status = 'not.in.(served,cancelled)';
      } else if (options.statusGroup === 'terminal') {
        query.status = 'in.(served,cancelled)';
      } else if (options.statusGroup !== undefined) {
        throw new ApiError(400, 'El filtro de estado no es válido.', 'VALIDATION_ERROR');
      }
      if (options.tableId) query.table_id = `eq.${options.tableId}`;
      if (options.tableSessionId) query.table_session_id = `eq.${options.tableSessionId}`;
      return parseArray(await request<unknown>('orders', { method: 'GET', query, signal: options.signal }), 'órdenes', parseOrder);
    },
    async listOrderItems(orderIds, signal) {
      if (!Array.isArray(orderIds) || orderIds.length < 1 || orderIds.length > 200 || orderIds.some(id => !UUID.test(id))) {
        throw new ApiError(400, 'La selección de órdenes no es válida.', 'VALIDATION_ERROR');
      }
      const result = parseArray(await request<unknown>('order_items', {
        method: 'GET', query: { select: ITEM_SELECT, order_id: `in.(${orderIds.join(',')})`, limit: '10000' }, signal,
      }), 'líneas de órdenes', parseItem);
      const expected = new Set(orderIds);
      if (result.some(item => !expected.has(item.orderId))) return invalid('relación orden/línea');
      return result;
    },
    async getOrder(id, signal) {
      if (!UUID.test(id)) throw new ApiError(400, 'El identificador de orden no es válido.', 'VALIDATION_ERROR');
      const orders = parseArray(await request<unknown>('orders', {
        method: 'GET', query: { select: ORDER_SELECT, id: `eq.${id}`, limit: '2' }, signal,
      }), 'órdenes', parseOrder);
      if (orders.length !== 1) throw new ApiError(404, 'No se encontró la orden.', 'ORDER_NOT_FOUND');
      const items = await this.listOrderItems([id], signal);
      return { ...orders[0], items: items.filter(item => item.orderId === id) };
    },
    async confirmOrder(id) {
      if (!UUID.test(id)) throw new ApiError(400, 'El identificador de orden no es válido.', 'VALIDATION_ERROR');
      return parseRpcStatus(await request<unknown>('rpc/confirm_order', { method: 'POST', body: { p_order_id: id } }), id);
    },
    async advanceOrder(id, nextStatus) {
      if (!UUID.test(id) || !['preparing', 'ready', 'served'].includes(nextStatus)) throw new ApiError(400, 'La transición solicitada no es válida.', 'VALIDATION_ERROR');
      return parseRpcStatus(await request<unknown>('rpc/advance_order', {
        method: 'POST', body: { p_order_id: id, p_next_status: nextStatus },
      }), id);
    },
    async cancelOrder(id, reason = null) {
      if (!UUID.test(id) || (reason !== null && typeof reason !== 'string')) throw new ApiError(400, 'La solicitud de cancelación no es válida.', 'VALIDATION_ERROR');
      return parseRpcStatus(await request<unknown>('rpc/cancel_order', {
        method: 'POST', body: { p_order_id: id, p_reason: reason?.trim().slice(0, 250) || null },
      }), id);
    },
  };
}

export function ordersErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No se pudo conectar con el servicio. Revisa la conexión e intenta de nuevo.';
  const messages: Record<string, string> = {
    VALIDATION_ERROR: error.message,
    INVALID_RESPONSE: 'El servicio devolvió datos no válidos. Actualiza la vista e intenta de nuevo.',
    FORBIDDEN: 'No tienes permisos para realizar esta operación.',
    '42501': 'No tienes permisos para realizar esta operación.',
    ORDER_NOT_FOUND: 'La orden ya no existe. Actualiza la lista.',
    SESSION_NOT_FOUND: 'La sesión de mesa ya no existe. Actualiza la lista.',
    NO_OPEN_TABLE_SESSION: 'La mesa no tiene una sesión abierta. El personal debe abrirla antes de aceptar pedidos.',
    TABLE_NOT_FOUND: 'La mesa no existe o está inactiva. Actualiza la lista de mesas.',
    TABLE_UNAVAILABLE: 'La mesa no está disponible para recibir pedidos.',
    TABLE_ALREADY_OPEN: 'La mesa ya tiene una sesión abierta. Actualiza las sesiones e inténtalo de nuevo.',
    IDEMPOTENCY_KEY_REUSED: 'Esta clave ya se usó para otro pedido. No reenvíes este carrito con esa clave.',
    PRODUCT_UNAVAILABLE: 'Un producto ya no está disponible. Actualiza el menú y edita tu carrito.',
    PRODUCT_RECIPE_HAS_INACTIVE_INGREDIENT: 'Un producto no está disponible temporalmente. Actualiza el menú y edita tu carrito.',
    INSUFFICIENT_PRODUCT_STOCK: 'No hay existencias suficientes de un producto. Actualiza los productos antes de volver a intentarlo.',
    INSUFFICIENT_INGREDIENT_STOCK: 'No hay existencias suficientes para preparar un producto. Actualiza los productos antes de volver a intentarlo.',
    INVALID_ORDER: 'Los datos del pedido no son válidos. Revisa las líneas sin borrar el carrito.',
    INVALID_QUANTITY: 'Una cantidad no es válida. Revisa las líneas del carrito.',
    '22023': 'Los datos del pedido no son válidos. Revisa las cantidades y vuelve a intentarlo.',
    '22P02': 'Un identificador o dato no es válido. Revisa el pedido sin borrar el carrito.',
    ORDER_NOT_PENDING: 'La orden cambió de estado. Actualiza la lista antes de continuar.',
    INVALID_ORDER_TRANSITION: 'La orden cambió de estado. Actualiza la lista antes de continuar.',
    SESSION_NOT_OPEN: 'La sesión de mesa ya no está abierta. Actualiza la lista.',
    ORDER_TOO_LATE_TO_CANCEL: 'La preparación ya inició; esta orden requiere el flujo operativo autorizado.',
    ORDER_HAS_PAYMENT: 'La orden tiene un pago asignado y debe continuar por el flujo de pagos.',
    TRACKING_NOT_CONFIGURED: 'El seguimiento del pedido todavía no está habilitado en el servidor.',
    TABLE_ACCOUNT_NOT_CONFIGURED: 'La consulta de cuenta de mesa todavía requiere habilitar la migración segura en el servidor.',
    INVALID_PRODUCT_SELECTION: 'No se pudo validar la disponibilidad de los productos. Actualiza el menú.',
  };
  if (messages[error.code ?? '']) return messages[error.code ?? ''];
  if (error.status === 401) return 'La sesión expiró. Inicia sesión nuevamente.';
  if (error.status === 403) return 'No tienes permisos para realizar esta operación.';
  if (error.status === 0 || error.status >= 500) return 'El servicio no está disponible temporalmente. Puedes reintentar.';
  return 'No se pudo completar la operación. Revisa los datos e intenta de nuevo.';
}
