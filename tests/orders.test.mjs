import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createHttpClient } from '../src/services/http/client.ts';
import { createCafeOrdersService, ordersErrorMessage } from '../src/features/orders/ordersService.ts';

const tableId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const productId = '44444444-4444-4444-8444-444444444444';
const itemId = '55555555-5555-4555-8555-555555555555';
const key = '66666666-6666-4666-8666-666666666666';
const cancelledOrderId = '77777777-7777-4777-8777-777777777777';
const secondItemId = '88888888-8888-4888-8888-888888888888';
const stamp = '2026-11-26T12:00:00.000Z';
const order = {
  id: orderId, table_session_id: sessionId, table_id: tableId, created_by: null,
  status: 'pending', payment_status: 'unpaid', subtotal: '8.5', discount_total: '0',
  total: 8.5, notes: null, created_at: stamp, confirmed_at: null, updated_at: stamp,
};
const item = {
  id: itemId, order_id: orderId, product_id: productId, product_name_snapshot: 'Café',
  quantity: 2, unit_price: '4.25', discount_amount: 0, subtotal: '8.5',
  promotion_name: null, notes: null, uses_recipe: false,
};
const tableAccount = {
  table_id: tableId, table_name: 'Mesa 1', table_session_id: sessionId, opened_at: stamp,
  orders: [
    { ...order, items: [{ ...item, product_name: item.product_name_snapshot, notes: 'Sin azúcar' }] },
    {
      ...order,
      id: cancelledOrderId,
      status: 'cancelled',
      subtotal: 2,
      total: 2,
      created_at: '2026-11-26T12:10:00.000Z',
      items: [{
        ...item,
        id: secondItemId,
        product_name: 'Té',
        quantity: 1,
        unit_price: 2,
        subtotal: 2,
      }],
    },
  ],
};

function fakeService(handler, token = undefined, refresh = async () => null) {
  const calls = [];
  const client = {
    get: async () => null,
    request: async (resource, options) => {
      calls.push({ resource, options });
      return handler(resource, options, calls.length);
    },
  };
  return { api: createCafeOrdersService(client, () => token, refresh), calls };
}

test('creates only through create_public_order with UUIDs, normalized lines and no client-authoritative totals', async () => {
  const { api, calls } = fakeService(() => orderId);
  assert.equal(await api.createOrder(tableId, [{ productId, quantity: 2, notes: ' Sin azúcar ' }], key), orderId);
  assert.equal(calls[0].resource, 'rpc/create_public_order');
  assert.deepEqual(calls[0].options.body, {
    p_table_id: tableId,
    p_items: [{ product_id: productId, quantity: 2, notes: 'Sin azúcar' }],
    p_idempotency_key: key,
  });
  assert.equal('total' in calls[0].options.body, false);
  await assert.rejects(api.createOrder('invalid', [{ productId, quantity: 1 }], key), { code: 'VALIDATION_ERROR' });
  await assert.rejects(api.createOrder(tableId, [{ productId, quantity: 0 }], key), { code: 'VALIDATION_ERROR' });
  await assert.rejects(api.createOrder(tableId, Array(51).fill({ productId, quantity: 1 }), key), { code: 'VALIDATION_ERROR' });
  await assert.rejects(api.createOrder(tableId, [{ productId, quantity: 1, notes: 'x'.repeat(201) }], key), { code: 'VALIDATION_ERROR' });
});

test('tracks only an order using its private kiosk idempotency key and validates the public summary', async () => {
  const summary = {
    order_id: orderId, status: 'preparing', created_at: stamp,
    items: [{ product_name: 'Café', quantity: 2 }],
  };
  const { api, calls } = fakeService(() => summary);
  assert.deepEqual(await api.getKioskOrderStatus(key), {
    orderId, status: 'preparing', createdAt: stamp,
    items: [{ productName: 'Café', quantity: 2 }],
  });
  assert.equal(calls[0].resource, 'rpc/get_public_kiosk_order_status');
  assert.deepEqual(calls[0].options.body, { p_idempotency_key: key });
  await assert.rejects(
    fakeService(() => ({ ...summary, items: [{ product_name: 'Café', quantity: 'many' }] })).api.getKioskOrderStatus(key),
    { code: 'INVALID_RESPONSE' },
  );
  await assert.rejects(
    fakeService(() => { throw new ApiError(404, 'missing function', 'PGRST202'); }).api.getKioskOrderStatus(key),
    { code: 'TRACKING_NOT_CONFIGURED' },
  );
});

test('loads every order in the active table session from the restricted public account RPC', async () => {
  const { api, calls } = fakeService(() => tableAccount);
  assert.deepEqual(await api.getPublicKioskTableAccount(tableId), {
    tableId, tableName: 'Mesa 1', tableSessionId: sessionId, openedAt: stamp,
    orders: [
      {
        id: orderId, tableId, tableSessionId: sessionId, status: 'pending',
        subtotal: 8.5, discountTotal: 0, total: 8.5, createdAt: stamp,
        items: [{
          id: itemId, productName: 'Café', quantity: 2, unitPrice: 4.25,
          discountAmount: 0, subtotal: 8.5, promotionName: null, notes: 'Sin azúcar',
        }],
      },
      {
        id: cancelledOrderId, tableId, tableSessionId: sessionId, status: 'cancelled',
        subtotal: 2, discountTotal: 0, total: 2, createdAt: '2026-11-26T12:10:00.000Z',
        items: [{
          id: secondItemId, productName: 'Té', quantity: 1, unitPrice: 2,
          discountAmount: 0, subtotal: 2, promotionName: null, notes: null,
        }],
      },
    ],
  });
  assert.equal(calls[0].resource, 'rpc/get_public_kiosk_table_account');
  assert.deepEqual(calls[0].options.body, { p_table_id: tableId });
  assert.equal(calls[0].options.accessToken, undefined);
  assert.equal(await fakeService(() => null).api.getPublicKioskTableAccount(tableId), null);
  await assert.rejects(api.getPublicKioskTableAccount('invalid'), { code: 'VALIDATION_ERROR' });
  await assert.rejects(
    fakeService(() => ({
      ...tableAccount,
      orders: [{ ...tableAccount.orders[0], table_session_id: cancelledOrderId }],
    })).api.getPublicKioskTableAccount(tableId),
    { code: 'INVALID_RESPONSE' },
  );
  await assert.rejects(
    fakeService(() => ({
      ...tableAccount,
      orders: [{ ...tableAccount.orders[0], items: [{ ...tableAccount.orders[0].items[0], notes: 42 }] }],
    })).api.getPublicKioskTableAccount(tableId),
    { code: 'INVALID_RESPONSE' },
  );
  await assert.rejects(
    fakeService(() => { throw new ApiError(404, 'missing function', 'PGRST202'); }).api.getPublicKioskTableAccount(tableId),
    { code: 'TABLE_ACCOUNT_NOT_CONFIGURED' },
  );
});

test('strictly parses order/item snapshots and rejects invalid enums, numeric, timestamp and relationships', async () => {
  const { api } = fakeService(resource => resource === 'orders' ? [order] : [item]);
  assert.deepEqual(await api.listOrders(), [{
    id: orderId, tableSessionId: sessionId, tableId, createdBy: null,
    status: 'pending', paymentStatus: 'unpaid', subtotal: 8.5, discountTotal: 0, total: 8.5,
    notes: null, createdAt: stamp, confirmedAt: null, updatedAt: stamp,
  }]);
  assert.equal((await api.getOrder(orderId)).items[0].productName, 'Café');
  await assert.rejects(fakeService(() => [{ ...order, status: 'created' }]).api.listOrders(), { code: 'INVALID_RESPONSE' });
  await assert.rejects(fakeService(() => [{ ...order, total: true }]).api.listOrders(), { code: 'INVALID_RESPONSE' });
  await assert.rejects(fakeService(() => [{ ...order, created_at: 'today' }]).api.listOrders(), { code: 'INVALID_RESPONSE' });
  await assert.rejects(fakeService(resource => resource === 'orders' ? [order] : [{ ...item, order_id: tableId }]).api.getOrder(orderId), { code: 'INVALID_RESPONSE' });
  await assert.rejects(fakeService(() => [{ ...order, total: 12 }]).api.listOrders(), { code: 'INVALID_RESPONSE' });
});

test('uses paginated filtered order queries and never reads for anonymous callers without a user token', async () => {
  const { api, calls } = fakeService(resource => resource === 'orders' ? [] : []);
  assert.deepEqual(await api.listOrders({ offset: 200, status: 'ready', tableId }), []);
  assert.equal(calls[0].options.query.limit, '200');
  assert.equal(calls[0].options.query.offset, '200');
  assert.equal(calls[0].options.query.status, 'eq.ready');
  assert.equal(calls[0].options.accessToken, undefined);
  await assert.rejects(api.listOrderItems([tableId, 'bad']), { code: 'VALIDATION_ERROR' });
});

test('uses staff RPCs only, retries a 401 once, and preserves state-specific results', async () => {
  let calls = 0;
  let refreshes = 0;
  const { api } = fakeService((resource, options) => {
    calls++;
    if (calls === 1) throw new ApiError(401, 'unauthorized');
    if (calls === 2) assert.equal(options.accessToken, 'renewed-jwt');
    if (resource === 'rpc/confirm_order') return { order_id: orderId, status: 'confirmed' };
    if (resource === 'rpc/advance_order') return { order_id: orderId, status: 'preparing' };
    if (resource === 'rpc/cancel_order') return { order_id: orderId, status: 'cancelled' };
    return null;
  }, 'expired-jwt', async () => { refreshes++; return 'renewed-jwt'; });
  assert.equal(await api.confirmOrder(orderId), 'confirmed');
  assert.equal(refreshes, 1);
  assert.equal(await api.advanceOrder(orderId, 'preparing'), 'preparing');
  assert.equal(await api.cancelOrder(orderId, ' cancel '), 'cancelled');
  await assert.rejects(api.advanceOrder(orderId, 'pending'), { code: 'VALIDATION_ERROR' });
});

test('maps business failures without exposing SQL details and keeps ambiguous retries on the same intent', async () => {
  let attempt = 0;
  const sent = [];
  const { api } = fakeService((resource, options) => {
    if (resource !== 'rpc/create_public_order') throw new Error('unexpected request');
    sent.push(options.body);
    if (++attempt === 1) throw new ApiError(0, 'network');
    return orderId;
  });
  const payload = [{ productId, quantity: 1, notes: null }];
  await assert.rejects(api.createOrder(tableId, payload, key));
  assert.equal(await api.createOrder(tableId, payload, key), orderId);
  assert.deepEqual(sent[0], sent[1]);
  assert.match(ordersErrorMessage(new ApiError(400, 'raw SQL', 'NO_OPEN_TABLE_SESSION')), /sesión abierta/);
  assert.match(ordersErrorMessage(new ApiError(400, 'raw SQL', 'INSUFFICIENT_PRODUCT_STOCK')), /existencias/);
  assert.doesNotMatch(ordersErrorMessage(new ApiError(500, 'secret database statement')), /secret database statement/);
});

test('PostgREST anon creation sends publishable key and omits Authorization', async () => {
  const seen = [];
  const client = createHttpClient({
    baseUrl: 'https://coffee.example',
    publicKey: 'publishable-key',
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), init });
      return Response.json(orderId);
    },
  });
  const api = createCafeOrdersService(client);
  assert.equal(await api.createOrder(tableId, [{ productId, quantity: 1 }], key), orderId);
  assert.equal(seen[0].url, 'https://coffee.example/rest/v1/rpc/create_public_order');
  assert.equal(seen[0].init.headers.apikey, 'publishable-key');
  assert.equal(seen[0].init.headers.Authorization, undefined);
});

test('concurrent requests preserve one idempotency key and payload; conflicting reuse is shown safely', async () => {
  const sent = [];
  const client = createHttpClient({
    baseUrl: 'https://coffee.example',
    publicKey: 'publishable-key',
    fetchImpl: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return Response.json(orderId);
    },
  });
  const api = createCafeOrdersService(client);
  const request = () => api.createOrder(tableId, [{ productId, quantity: 1, notes: 'sin leche' }], key);
  assert.deepEqual(await Promise.all([request(), request()]), [orderId, orderId]);
  assert.deepEqual(sent[0], sent[1]);
  await assert.rejects(
    createCafeOrdersService({
      get: async () => null,
      request: async () => { throw new ApiError(400, 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_REUSED'); },
    }).createOrder(tableId, [{ productId, quantity: 2 }], key),
    error => {
      assert.match(ordersErrorMessage(error), /otro pedido/);
      assert.doesNotMatch(ordersErrorMessage(error), /SQL|token|headers/i);
      return true;
    },
  );
});
