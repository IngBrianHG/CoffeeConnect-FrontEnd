import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createHttpClient } from '../src/services/http/client.ts';
import { createOrderAvailabilityService } from '../src/features/orders/orderAvailabilityService.ts';

const productA = '44444444-4444-4444-8444-444444444444';
const productB = '55555555-5555-4555-8555-555555555555';

function createService(handler, token = () => 'staff-jwt', refresh = async () => null) {
  const calls = [];
  const client = {
    get: async () => null,
    request: async (resource, options) => {
      calls.push({ resource, options });
      return handler(resource, options, calls.length);
    },
  };
  return { api: createOrderAvailabilityService(client, token, refresh), calls };
}

test('requests authenticated availability by batch and strictly parses its result', async () => {
  const { api, calls } = createService(() => ({
    items: [
      { product_id: productA, available_quantity: 4, orderable: true, uses_recipe: false },
      { product_id: productB, available_quantity: 0, orderable: false, uses_recipe: true },
    ],
  }));
  assert.deepEqual(await api.getAvailability([productA, productB]), [
    { productId: productA, availableQuantity: 4, orderable: true, usesRecipe: false },
    { productId: productB, availableQuantity: 0, orderable: false, usesRecipe: true },
  ]);
  assert.equal(calls[0].resource, 'rpc/get_orderable_products_availability');
  assert.deepEqual(calls[0].options.body, { p_product_ids: [productA, productB] });
  assert.equal(calls[0].options.accessToken, 'staff-jwt');
});

test('rejects malformed, missing, duplicate and unrequested availability rows', async () => {
  const valid = { product_id: productA, available_quantity: 3, orderable: true, uses_recipe: false };
  await assert.rejects(createService(() => ({ items: [{ ...valid, available_quantity: '3' }] })).api.getAvailability([productA]), { code: 'INVALID_RESPONSE' });
  await assert.rejects(createService(() => ({ items: [] })).api.getAvailability([productA]), { code: 'INVALID_RESPONSE' });
  await assert.rejects(createService(() => ({ items: [valid, valid] })).api.getAvailability([productA]), { code: 'INVALID_RESPONSE' });
  await assert.rejects(createService(() => ({ items: [{ ...valid, product_id: productB }] })).api.getAvailability([productA]), { code: 'INVALID_RESPONSE' });
  await assert.rejects(createService(() => ({ items: [{ ...valid, orderable: false }] })).api.getAvailability([productA]), { code: 'INVALID_RESPONSE' });
});

test('validates input UUIDs and uniqueness before calling the API', async () => {
  const { api, calls } = createService(() => ({ items: [] }));
  await assert.rejects(api.getAvailability([]), { code: 'VALIDATION_ERROR' });
  await assert.rejects(api.getAvailability([productA, productA]), { code: 'VALIDATION_ERROR' });
  await assert.rejects(api.getAvailability(['not-a-uuid']), { code: 'VALIDATION_ERROR' });
  assert.equal(calls.length, 0);
});

test('refreshes a 401 once and preserves safe API errors', async () => {
  let refreshes = 0;
  const { api, calls } = createService((_resource, options, attempt) => {
    if (attempt === 1) throw new ApiError(401, 'unauthorized');
    assert.equal(options.accessToken, 'renewed-jwt');
    return { items: [{ product_id: productA, available_quantity: 1, orderable: true, uses_recipe: true }] };
  }, () => 'expired-jwt', async () => {
    refreshes++;
    return 'renewed-jwt';
  });
  assert.equal((await api.getAvailability([productA]))[0].availableQuantity, 1);
  assert.equal(refreshes, 1);
  assert.equal(calls.length, 2);
});

test('uses the publishable key and staff JWT without exposing database error details', async () => {
  const seen = [];
  const client = createHttpClient({
    baseUrl: 'https://coffee.example',
    publicKey: 'publishable-key',
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), init });
      return Response.json({
        code: '42501',
        message: 'private SQL detail',
      }, { status: 403 });
    },
  });
  const api = createOrderAvailabilityService(client, () => 'staff-jwt');
  await assert.rejects(api.getAvailability([productA]), error => {
    assert.equal(error.code, '42501');
    assert.doesNotMatch(error.message, /private SQL detail/);
    return true;
  });
  assert.equal(seen[0].url, 'https://coffee.example/rest/v1/rpc/get_orderable_products_availability');
  assert.equal(seen[0].init.headers.apikey, 'publishable-key');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer staff-jwt');
});
