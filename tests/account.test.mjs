import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/services/http/client.ts';
import { createAccountService, accountErrorMessage } from '../src/features/orders/accountService.ts';

const tableId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const itemId = '55555555-5555-4555-8555-555555555555';
const paymentId = '66666666-6666-4666-8666-666666666666';
const key = '77777777-7777-4777-8777-777777777777';
const stamp = '2026-11-26T12:00:00.000Z';

function fakeService(handler) {
  const calls = [];
  const client = {
    get: async () => null,
    request: async (resource, options) => {
      calls.push({ resource, options });
      return handler(resource, options);
    },
  };
  return { api: createAccountService(client), calls };
}

function accountFixture() {
  return {
    table_sessions: [{
      id: sessionId, table_id: tableId, status: 'open', opened_at: stamp, closed_at: null,
    }],
    cafe_tables: [{ id: tableId, name: 'Mesa 1' }],
    orders: [{
      id: orderId, table_session_id: sessionId, table_id: tableId, created_by: null,
      status: 'served', payment_status: 'partial', subtotal: '10.00', discount_total: '0',
      total: '10.00', notes: 'Sin azúcar', created_at: stamp, confirmed_at: stamp, updated_at: stamp,
    }],
    order_items: [{
      id: itemId, order_id: orderId, product_id: '44444444-4444-4444-8444-444444444444',
      product_name_snapshot: 'Café', quantity: 1, unit_price: '10.00', discount_amount: 0,
      subtotal: '10.00', promotion_name: null, notes: null, uses_recipe: false,
    }],
    payments: [],
    payment_allocations: [],
  };
}

test('loads a complete session account and derives line and session balances', async () => {
  const fixture = accountFixture();
  fixture.payments = [{
    id: paymentId, table_session_id: sessionId, method: 'cash', amount: '4.00',
    payer_label: 'Ana', reference: null, received_by: null, created_at: stamp,
  }];
  fixture.payment_allocations = [{ payment_id: paymentId, order_item_id: itemId, amount: '4.00' }];
  fixture.orders[0].payment_status = 'partial';
  const { api } = fakeService(resource => fixture[resource.replace('rpc/', '')] ?? []);
  const account = await api.getSessionAccount(sessionId);
  assert.equal(account.tableName, 'Mesa 1');
  assert.equal(account.totalServed, 10);
  assert.equal(account.totalPaid, 4);
  assert.equal(account.balance, 6);
  assert.equal(account.lines[0].paidAmount, 4);
  assert.equal(account.lines[0].balance, 6);
});

test('rejects cross-session, cancelled and duplicate payment allocations before RPC', async () => {
  const fixture = accountFixture();
  const { api } = fakeService(resource => fixture[resource] ?? []);
  await assert.rejects(
    api.recordPayment(sessionId, 'cash', [
      { orderItemId: itemId, amount: 2 },
      { orderItemId: itemId, amount: 2 },
    ], key),
    { code: 'DUPLICATE_PAYMENT_ALLOCATION' },
  );
  await assert.rejects(
    api.recordPayment(sessionId, 'cash', [{ orderItemId: '88888888-8888-4888-8888-888888888888', amount: 2 }], key),
    { code: 'PAYMENT_ITEM_NOT_PAYABLE' },
  );
  await assert.rejects(
    api.recordPayment(sessionId, 'cash', [{ orderItemId: itemId, amount: 11 }], key),
    { code: 'PAYMENT_EXCEEDS_ITEM_BALANCE' },
  );
});

test('sends only the RPC for payment, with normalized allocations and a stable idempotency key', async () => {
  const fixture = accountFixture();
  let rpcPayload;
  const { api, calls } = fakeService((resource, options) => {
    if (resource === 'rpc/record_session_payment') {
      rpcPayload = options.body;
      return { payment_id: paymentId, amount: 10, method: 'card', session_closed: true };
    }
    return fixture[resource.replace('rpc/', '')] ?? [];
  });
  const result = await api.recordPayment(sessionId, 'card', [{ orderItemId: itemId, amount: 10 }], key, ' Ana ', ' ticket-1 ');
  assert.equal(result.paymentId, paymentId);
  assert.equal(result.sessionClosed, true);
  assert.equal(calls.some(call => call.resource !== 'rpc/record_session_payment'
    && ['payments', 'payment_allocations'].includes(call.resource) && call.options.method !== 'GET'), false);
  assert.deepEqual(rpcPayload, {
    p_table_session_id: sessionId,
    p_method: 'card',
    p_allocations: [{ order_item_id: itemId, amount: 10 }],
    p_idempotency_key: key,
    p_payer_label: 'Ana',
    p_reference: 'ticket-1',
  });
});

test('cancels unserved session orders and closes only through the dedicated RPC when served balance is zero', async () => {
  const fixture = accountFixture();
  fixture.orders[0].payment_status = 'paid';
  fixture.payments = [{
    id: paymentId, table_session_id: sessionId, method: 'cash', amount: '10.00',
    payer_label: null, reference: null, received_by: null, created_at: stamp,
  }];
  fixture.payment_allocations = [{ payment_id: paymentId, order_item_id: itemId, amount: '10.00' }];
  const pendingId = '88888888-8888-4888-8888-888888888888';
  const preparingId = '99999999-9999-4999-8999-999999999999';
  fixture.orders.push(
    { ...fixture.orders[0], id: pendingId, status: 'pending', payment_status: 'unpaid' },
    { ...fixture.orders[0], id: preparingId, status: 'preparing', payment_status: 'unpaid' },
  );
  let rpcRequest;
  const { api, calls } = fakeService((resource, options) => {
    if (resource === 'rpc/close_session_and_cancel_unserved_orders') {
      rpcRequest = options;
      return {
        table_session_id: sessionId, status: 'closed',
        cancelled_order_ids: [pendingId, preparingId], idempotent_replay: false,
      };
    }
    return fixture[resource.replace('rpc/', '')] ?? [];
  });
  const result = await api.closeSessionAndCancelUnservedOrders(sessionId, [
    { orderId: pendingId, preparedDisposition: null },
    { orderId: preparingId, preparedDisposition: 'reusable' },
  ], key);
  assert.equal(result.tableSessionId, sessionId);
  assert.deepEqual(result.cancelledOrderIds.sort(), [pendingId, preparingId].sort());
  assert.equal(rpcRequest.method, 'POST');
  assert.deepEqual(rpcRequest.body, {
    p_table_session_id: sessionId,
    p_cancellations: [
      { order_id: pendingId, prepared_disposition: null },
      { order_id: preparingId, prepared_disposition: 'reusable' },
    ],
    p_idempotency_key: key,
  });
  assert.equal(calls.some(call => call.resource === 'orders' && call.options.method !== 'GET'), false);
});

test('blocks closure while served balance remains and requires a prepared-order disposition', async () => {
  const unpaid = accountFixture();
  unpaid.orders[0].payment_status = 'partial';
  unpaid.payments = [{
    id: paymentId, table_session_id: sessionId, method: 'cash', amount: '4.00',
    payer_label: null, reference: null, received_by: null, created_at: stamp,
  }];
  unpaid.payment_allocations = [{ payment_id: paymentId, order_item_id: itemId, amount: '4.00' }];
  const activeId = '88888888-8888-4888-8888-888888888888';
  unpaid.orders.push({ ...unpaid.orders[0], id: activeId, status: 'preparing', payment_status: 'unpaid' });
  const { api, calls } = fakeService(resource => unpaid[resource.replace('rpc/', '')] ?? []);
  await assert.rejects(api.closeSessionAndCancelUnservedOrders(sessionId, [
    { orderId: activeId, preparedDisposition: 'waste' },
  ], key), { code: 'SESSION_HAS_UNPAID_SERVED_ORDERS' });
  assert.equal(calls.some(call => call.resource === 'rpc/close_session_and_cancel_unserved_orders'), false);

  const paid = accountFixture();
  paid.orders[0].payment_status = 'paid';
  paid.payments = [{
    id: paymentId, table_session_id: sessionId, method: 'cash', amount: '10.00',
    payer_label: null, reference: null, received_by: null, created_at: stamp,
  }];
  paid.payment_allocations = [{ payment_id: paymentId, order_item_id: itemId, amount: '10.00' }];
  paid.orders.push({ ...paid.orders[0], id: activeId, status: 'preparing', payment_status: 'unpaid' });
  const next = fakeService(resource => {
    if (resource === 'rpc/close_session_and_cancel_unserved_orders') {
      return {
        table_session_id: sessionId, status: 'closed',
        cancelled_order_ids: [activeId], idempotent_replay: false,
      };
    }
    return paid[resource.replace('rpc/', '')] ?? [];
  });
  await assert.rejects(next.api.closeSessionAndCancelUnservedOrders(sessionId, [
    { orderId: activeId, preparedDisposition: null },
  ], key), { code: 'INVALID_CANCEL_DISPOSITION' });
});

test('reports clearly when the incremental close RPC is not installed yet', async () => {
  const fixture = accountFixture();
  const pendingId = '88888888-8888-4888-8888-888888888888';
  fixture.orders = [{ ...fixture.orders[0], id: pendingId, status: 'pending', payment_status: 'unpaid' }];
  fixture.order_items = [];
  const { api } = fakeService(resource => {
    if (resource === 'rpc/close_session_and_cancel_unserved_orders') {
      throw new ApiError(404, 'missing function', 'PGRST202');
    }
    return fixture[resource.replace('rpc/', '')] ?? [];
  });
  await assert.rejects(api.closeSessionAndCancelUnservedOrders(sessionId, [
    { orderId: pendingId, preparedDisposition: null },
  ], key), { code: 'CLOSE_SESSION_NOT_CONFIGURED' });
});

test('maps ambiguous and idempotency failures without exposing internals', () => {
  assert.match(accountErrorMessage(new ApiError(0, 'network', 'NETWORK_ERROR')), /misma intención/);
  assert.match(accountErrorMessage(new ApiError(409, 'raw', 'IDEMPOTENCY_KEY_REUSED')), /clave ya se usó/);
  assert.match(accountErrorMessage(new ApiError(409, 'raw', 'SESSION_HAS_UNPAID_SERVED_ORDERS')), /todo lo que fue entregado/);
  assert.match(accountErrorMessage(new ApiError(404, 'raw', 'CLOSE_SESSION_NOT_CONFIGURED')), /migración incremental/);
  assert.doesNotMatch(accountErrorMessage(new ApiError(500, 'database secret')), /database secret/);
});
