import { ApiError, type HttpClient } from '../../services/http/client.ts';

export type SalesReport = {
  date_from: string;
  date_to: string;
  timezone: string;
  table_id: string | null;
  orders_summary: { order_count: number; charged_total: number; pending_total: number };
  orders: Array<{
    order_id: string;
    table_id: string;
    table_name: string;
    created_at: string;
    status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'cancelled';
    payment_status: 'unpaid' | 'partial' | 'paid';
    total: number;
    charged_total: number;
    pending_total: number;
  }>;
  sales: { order_count: number; items_count: number; gross_total: number; discount_total: number; total: number };
  collections: { payment_count: number; total: number };
  sales_by_day: Array<{ date: string; orders: number; gross_total: number; discount_total: number; sales_total: number }>;
  collections_by_day: Array<{ date: string; payments: number; collected_total: number }>;
  sales_by_table: Array<{ table_id: string; table_name: string; orders: number; gross_total: number; discount_total: number; sales_total: number }>;
  collections_by_method: Array<{ method: 'cash' | 'card' | 'transfer' | 'other'; payments: number; collected_total: number }>;
  products: Array<{ product_name: string; quantity: number; gross_total: number; discount_total: number; sales_total: number }>;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONES = new Set(['America/El_Salvador']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateRows(value: unknown[], resource: string, keys: string[]) {
  for (const row of value) {
    if (!isRecord(row) || keys.some(key => !(key in row))) {
      throw new ApiError(200, `El reporte contiene filas no válidas (${resource}).`, 'INVALID_RESPONSE');
    }
    for (const key of keys.filter(key => !['date', 'table_id', 'table_name', 'product_name', 'method'].includes(key))) {
      if (!finite(row[key])) throw new ApiError(200, `El reporte contiene importes no válidos (${resource}).`, 'INVALID_RESPONSE');
    }
  }
}

function parseReport(value: unknown): SalesReport {
  if (!isRecord(value) || !isRecord(value.sales) || !isRecord(value.collections)
    || !isRecord(value.orders_summary) || !Array.isArray(value.orders)
    || !Array.isArray(value.sales_by_day) || !Array.isArray(value.collections_by_day)
    || !Array.isArray(value.sales_by_table) || !Array.isArray(value.collections_by_method)
    || !Array.isArray(value.products)) {
    throw new ApiError(200, 'El reporte recibido no tiene el formato esperado.', 'INVALID_RESPONSE');
  }
  const ordersSummary = value.orders_summary;
  const sales = value.sales as Record<string, unknown>;
  const collections = value.collections as Record<string, unknown>;
  const numericKeys = ['order_count', 'items_count', 'gross_total', 'discount_total', 'total'] as const;
  if (!['order_count', 'charged_total', 'pending_total'].every(key => finite(ordersSummary[key]))
    || !numericKeys.every(key => finite(sales[key]))
    || !['payment_count', 'total'].every(key => finite(collections[key]))) {
    throw new ApiError(200, 'El reporte contiene totales no válidos.', 'INVALID_RESPONSE');
  }
  const orderStatuses = new Set(['pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled']);
  const paymentStatuses = new Set(['unpaid', 'partial', 'paid']);
  let chargedTotal = 0;
  let pendingTotal = 0;
  for (const order of value.orders) {
    if (!isRecord(order) || typeof order.order_id !== 'string' || !UUID.test(order.order_id)
      || typeof order.table_id !== 'string' || !UUID.test(order.table_id)
      || typeof order.table_name !== 'string' || !order.table_name.trim()
      || typeof order.created_at !== 'string' || !Number.isFinite(Date.parse(order.created_at))
      || !orderStatuses.has(String(order.status)) || !paymentStatuses.has(String(order.payment_status))
      || !['total', 'charged_total', 'pending_total'].every(key => finite(order[key]))) {
      throw new ApiError(200, 'El reporte contiene órdenes no válidas.', 'INVALID_RESPONSE');
    }
    if (Number(order.charged_total) > Number(order.total)
      || Number(order.pending_total) > Number(order.total)
      || (order.status === 'served' && Math.abs(
        Number(order.charged_total) + Number(order.pending_total) - Number(order.total),
      ) > 0.01)) {
      throw new ApiError(200, 'El reporte contiene saldos de órdenes no válidos.', 'INVALID_RESPONSE');
    }
    if (order.status === 'served') {
      chargedTotal += Number(order.charged_total);
      pendingTotal += Number(order.pending_total);
    }
  }
  if (!Number.isInteger(Number(ordersSummary.order_count)) || value.orders.length !== ordersSummary.order_count
    || Math.abs(chargedTotal - Number(ordersSummary.charged_total)) > 0.01
    || Math.abs(pendingTotal - Number(ordersSummary.pending_total)) > 0.01) {
    throw new ApiError(200, 'El reporte contiene totales de órdenes inconsistentes.', 'INVALID_RESPONSE');
  }
  validateRows(value.sales_by_day, 'día de venta', ['date', 'orders', 'gross_total', 'discount_total', 'sales_total']);
  validateRows(value.collections_by_day, 'día de cobro', ['date', 'payments', 'collected_total']);
  validateRows(value.sales_by_table, 'mesa', ['table_id', 'table_name', 'orders', 'gross_total', 'discount_total', 'sales_total']);
  validateRows(value.collections_by_method, 'método', ['method', 'payments', 'collected_total']);
  validateRows(value.products, 'producto', ['product_name', 'quantity', 'gross_total', 'discount_total', 'sales_total']);
  return value as unknown as SalesReport;
}

export function createReportService(
  client: HttpClient,
  getAccessToken: () => string | undefined = () => undefined,
  refreshAccessToken: () => Promise<string | null> = async () => null,
) {
  return {
    async getSalesReport(input: { from: string; to: string; timezone?: string; tableId?: string | null; signal?: AbortSignal }) {
      const timezone = input.timezone ?? 'America/El_Salvador';
      if (!ISO_DATE.test(input.from) || !ISO_DATE.test(input.to) || input.from > input.to
        || timezone.length > 80 || !TIMEZONES.has(timezone)
        || (input.tableId && !UUID.test(input.tableId))) {
        throw new ApiError(400, 'Revisa el período y los filtros del reporte.', 'INVALID_REPORT_FILTER');
      }
      const days = (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000;
      if (!Number.isInteger(days) || days > 365) {
        throw new ApiError(400, 'El período máximo permitido es de 366 días.', 'INVALID_REPORT_FILTER');
      }
      const options = {
        method: 'POST',
        accessToken: getAccessToken(),
        signal: input.signal,
        body: {
          p_date_from: input.from,
          p_date_to: input.to,
          p_timezone: timezone,
          p_table_id: input.tableId ?? null,
        },
      } as const;
      let result: unknown;
      try {
        result = await client.request<unknown>('rpc/get_sales_report', options);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        const refreshedToken = await refreshAccessToken().catch(() => null);
        if (!refreshedToken) throw error;
        result = await client.request<unknown>('rpc/get_sales_report', { ...options, accessToken: refreshedToken });
      }
      return parseReport(result);
    },
  };
}
