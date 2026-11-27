import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportService } from '../src/features/reports/reportService.ts';

const tableId = '11111111-1111-4111-8111-111111111111';
const payload = {
  date_from: '2026-11-27', date_to: '2026-11-27', timezone: 'America/El_Salvador', table_id: null,
  orders_summary: { order_count: 2, charged_total: 24, pending_total: 0 },
  orders: [
    {
      order_id: '22222222-2222-4222-8222-222222222222', table_id: tableId, table_name: 'Mesa 1',
      created_at: '2026-11-27T18:00:00Z', status: 'served', payment_status: 'paid',
      total: 15, charged_total: 15, pending_total: 0,
    },
    {
      order_id: '33333333-3333-4333-8333-333333333333', table_id: tableId, table_name: 'Mesa 1',
      created_at: '2026-11-27T18:10:00Z', status: 'served', payment_status: 'paid',
      total: 9, charged_total: 9, pending_total: 0,
    },
  ],
  sales: { order_count: 2, items_count: 4, gross_total: 25, discount_total: 1, total: 24 },
  collections: { payment_count: 2, total: 24 },
  sales_by_day: [{ date: '2026-11-27', orders: 2, gross_total: 25, discount_total: 1, sales_total: 24 }],
  collections_by_day: [{ date: '2026-11-27', payments: 2, collected_total: 24 }],
  sales_by_table: [{ table_id: tableId, table_name: 'Mesa 1', orders: 2, gross_total: 25, discount_total: 1, sales_total: 24 }],
  collections_by_method: [{ method: 'cash', payments: 2, collected_total: 24 }],
  products: [{ product_name: 'Café', quantity: 4, gross_total: 25, discount_total: 1, sales_total: 24 }],
};

test('requests the secure report RPC using explicit business dates, zone and optional table', async () => {
  const calls = [];
  const service = createReportService({
    request: async (resource, options) => {
      calls.push({ resource, options });
      return payload;
    },
  }, () => 'jwt');
  assert.deepEqual(await service.getSalesReport({ from: '2026-11-27', to: '2026-11-27', tableId }), payload);
  assert.equal(calls[0].resource, 'rpc/get_sales_report');
  assert.equal(calls[0].options.accessToken, 'jwt');
  assert.deepEqual(calls[0].options.body, {
    p_date_from: '2026-11-27', p_date_to: '2026-11-27',
    p_timezone: 'America/El_Salvador', p_table_id: tableId,
  });
});

test('rejects invalid date ranges and malformed report totals/rows', async () => {
  const service = createReportService({ request: async () => payload });
  await assert.rejects(service.getSalesReport({ from: '2026-11-28', to: '2026-11-27' }), { code: 'INVALID_REPORT_FILTER' });
  await assert.rejects(service.getSalesReport({ from: '2025-11-26', to: '2026-11-28' }), { code: 'INVALID_REPORT_FILTER' });
  await assert.rejects(createReportService({ request: async () => ({ ...payload, sales: { ...payload.sales, total: '24' } }) })
    .getSalesReport({ from: '2026-11-27', to: '2026-11-27' }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(createReportService({ request: async () => ({ ...payload, products: [{ product_name: 'Café', quantity: -1 }] }) })
    .getSalesReport({ from: '2026-11-27', to: '2026-11-27' }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(createReportService({ request: async () => ({
    ...payload, orders: payload.orders.map((order, index) => index === 0 ? { ...order, charged_total: 16 } : order),
  }) }).getSalesReport({ from: '2026-11-27', to: '2026-11-27' }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(createReportService({ request: async () => ({
    ...payload, orders_summary: { ...payload.orders_summary, charged_total: 23 },
  }) }).getSalesReport({ from: '2026-11-27', to: '2026-11-27' }), { code: 'INVALID_RESPONSE' });
});

test('accepts order-level paid and pending balances for the daily orders report', async () => {
  const partiallyPaid = {
    ...payload,
    orders_summary: { order_count: 1, charged_total: 2, pending_total: 3 },
    orders: [{
      ...payload.orders[0], payment_status: 'partial', total: 5, charged_total: 2, pending_total: 3,
    }],
  };
  const report = await createReportService({ request: async () => partiallyPaid })
    .getSalesReport({ from: '2026-11-27', to: '2026-11-27' });
  assert.equal(report.orders[0].charged_total, 2);
  assert.equal(report.orders_summary.pending_total, 3);
});
