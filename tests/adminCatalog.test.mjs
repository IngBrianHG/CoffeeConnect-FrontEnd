import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createHttpClient } from '../src/services/http/client.ts';
import { adminCatalogErrorMessage, createAdminCatalogService } from '../src/services/adminCatalog.ts';

const catId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const rowCategory = { id: catId, name: 'Café', description: null, active: true };
const rowProduct = { id: productId, category_id: catId, name: 'Latte', description: null, price: '4.50', image_url: null, active: true, stock: '2.000' };

function service(handler) {
  const calls = [];
  const client = {
    get: async () => null,
    request: async (resource, options) => {
      calls.push({ resource, options });
      return handler(resource, options, calls.length);
    },
  };
  return { api: createAdminCatalogService(client, () => 'user-access-token', async () => null), calls };
}

test('maps PostgREST product fields to camelCase and validates UUID/price/stock', async () => {
  const { api } = service(() => [rowProduct]);
  assert.deepEqual(await api.listProducts(), [{
    id: productId, categoryId: catId, name: 'Latte', description: null,
    price: 4.5, imageUrl: null, active: true, stock: 2,
  }]);
  const malformed = service(() => [{ ...rowProduct, price: 'NaN' }]);
  await assert.rejects(malformed.api.listProducts(), { code: 'INVALID_RESPONSE' });
  const invalidId = service(() => [{ ...rowProduct, id: '1' }]);
  await assert.rejects(invalidId.api.listProducts(), { code: 'INVALID_RESPONSE' });
});

test('trims category/product input and never writes stock', async () => {
  const { api, calls } = service(() => null);
  await api.createCategory({ name: '  Café  ', description: ' x ' });
  await api.createProduct({ categoryId: catId, name: ' Latte ', description: ' fresh ', price: 4.5 });
  assert.deepEqual(calls[0].options.body, { name: 'Café', description: 'x', active: true });
  assert.deepEqual(calls[1].options.body, {
    category_id: catId, name: 'Latte', description: 'fresh', price: 4.5, image_url: null, active: true,
  });
  assert.equal('stock' in calls[1].options.body, false);
  await assert.rejects(api.createProduct({ categoryId: catId, name: 'No', price: 0 }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(api.createCategory({ name: '  ' }), { code: 'VALIDATION_ERROR' });
});

test('validates promotion invariants and only deactivates rather than deleting', async () => {
  const { api, calls } = service(() => null);
  await assert.rejects(api.createPromotion({
    name: 'Deal', type: 'nxm', scope: 'all_menu', buyQuantity: 2, payQuantity: 2,
  }), { code: 'VALIDATION_ERROR' });
  await api.createPromotion({
    name: 'Deal', type: 'percent', scope: 'all_menu', percent: 15,
  });
  await api.deactivatePromotion(productId);
  assert.equal(calls[0].options.body.percent, 15);
  assert.equal(calls[0].options.body.buy_quantity, null);
  assert.equal(calls[1].options.body.active, false);
  assert.equal(calls.some(({ options }) => options.method === 'DELETE'), false);
});

test('retries one 401 with refreshed user token and translates safe errors', async () => {
  let refreshCalls = 0;
  let requestCalls = 0;
  const client = {
    get: async () => null,
    request: async (_resource, options) => {
      requestCalls++;
      if (requestCalls === 1) throw new ApiError(401, 'unauthorized');
      assert.equal(options.accessToken, 'renewed-token');
      return [rowCategory];
    },
  };
  const api = createAdminCatalogService(client, () => 'expired-token', async () => {
    refreshCalls++;
    return 'renewed-token';
  });
  assert.equal((await api.listCategories()).length, 1);
  assert.equal(refreshCalls, 1);
  assert.equal(requestCalls, 2);
  assert.equal(adminCatalogErrorMessage(new ApiError(403, 'forbidden', '42501')), 'No tienes permisos para realizar este cambio.');
  assert.match(adminCatalogErrorMessage(new ApiError(409, 'duplicate', '23505')), /Ya existe/);
  assert.match(adminCatalogErrorMessage(new Error('network')), /conectar/);
});

test('uses the simulated fetch transport with publishable/user credentials and PostgREST path', async () => {
  const seen = [];
  const client = createHttpClient({
    baseUrl: 'https://coffee.example',
    publicKey: 'publishable-key',
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    },
  });
  const api = createAdminCatalogService(client, () => 'user-jwt', async () => null);
  await api.createProduct({ categoryId: catId, name: 'Latte', price: 4.5 });
  assert.match(seen[0].url, /\/rest\/v1\/products$/);
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.apikey, 'publishable-key');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer user-jwt');
  assert.equal(seen[0].init.headers.Prefer, 'return=minimal');
  assert.equal(seen[0].init.body.includes('"stock"'), false);
});
