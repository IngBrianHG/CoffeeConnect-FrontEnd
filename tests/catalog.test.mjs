import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttpClient, ApiError } from '../src/services/http/client.ts';
import { createCatalogService } from '../src/services/catalog.ts';

const BASE_URL = 'https://sample-project.supabase.co/';
const PUBLIC_KEY = 'publishable-test-key';
const CATEGORY_ID = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174001';

test('catalog sends public requests to the configured REST root and maps only menu fields', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: new URL(url), options });
    if (new URL(url).pathname.endsWith('/categories')) {
      return Response.json([{ id: CATEGORY_ID, name: 'Café', description: null }]);
    }
    return Response.json([{
      id: PRODUCT_ID,
      category_id: CATEGORY_ID,
      category_name: 'Café',
      name: 'Latte',
      description: null,
      price: 3.5,
      image_url: 'https://images.example/latte.png',
      stock: 9,
    }]);
  };
  const catalog = createCatalogService(createHttpClient({ baseUrl: BASE_URL, publicKey: PUBLIC_KEY, fetchImpl }));

  const categories = await catalog.listPublicCategories();
  const menu = await catalog.listPublicMenu();

  assert.deepEqual(categories, [{ id: CATEGORY_ID, name: 'Café', description: null }]);
  assert.deepEqual(menu, [{
    id: PRODUCT_ID,
    categoryId: CATEGORY_ID,
    categoryName: 'Café',
    name: 'Latte',
    description: null,
    price: 3.5,
    imageUrl: 'https://images.example/latte.png',
  }]);
  assert.equal(requests[0].url.href, 'https://sample-project.supabase.co/rest/v1/categories?select=id%2Cname%2Cdescription&active=eq.true&order=name.asc');
  assert.equal(requests[1].url.href, 'https://sample-project.supabase.co/rest/v1/public_menu?select=id%2Ccategory_id%2Ccategory_name%2Cname%2Cdescription%2Cprice%2Cimage_url&order=name.asc');
  for (const { options } of requests) {
    assert.equal(options.headers.apikey, PUBLIC_KEY);
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(options.headers.Authorization, undefined);
  }
  assert.equal(JSON.stringify(menu).includes('stock'), false);
});

test('empty successful response produces an empty collection', async () => {
  const catalog = createCatalogService(createHttpClient({
    baseUrl: BASE_URL,
    publicKey: PUBLIC_KEY,
    fetchImpl: async () => new Response(null, { status: 204 }),
  }));

  assert.deepEqual(await catalog.listPublicMenu(), []);
});

test('generic transport adds auth and JSON body only when supplied', async () => {
  const requests = [];
  const client = createHttpClient({
    baseUrl: BASE_URL,
    publicKey: PUBLIC_KEY,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      return new Response(null, { status: 204 });
    },
  });

  await client.request('resource');
  await client.request('resource', {
    method: 'POST',
    accessToken: 'access-token',
    body: { name: 'Latte' },
  });

  assert.equal(requests[0].body, undefined);
  assert.equal(requests[0].headers['Content-Type'], undefined);
  assert.equal(requests[1].headers.Authorization, 'Bearer access-token');
  assert.equal(requests[1].headers['Content-Type'], 'application/json');
  assert.equal(requests[1].body, '{"name":"Latte"}');
});

test('HTTP access, missing-resource and server failures remain distinguishable', async (t) => {
  for (const [status, expectedCode] of [[401, undefined], [403, undefined], [404, undefined], [500, undefined]]) {
    await t.test(`HTTP ${status}`, async () => {
      const catalog = createCatalogService(createHttpClient({
        baseUrl: BASE_URL,
        publicKey: PUBLIC_KEY,
        fetchImpl: async () => Response.json({ message: 'sensitive upstream detail' }, { status }),
      }));
      await assert.rejects(catalog.listPublicCategories(), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, status);
        assert.equal(error.code, expectedCode);
        assert.equal(error.message.includes('sensitive upstream detail'), false);
        return true;
      });
    });
  }
});

test('malformed JSON and malformed catalog data are rejected', async () => {
  const invalidJson = createCatalogService(createHttpClient({
    baseUrl: BASE_URL,
    publicKey: PUBLIC_KEY,
    fetchImpl: async () => new Response('{'),
  }));
  await assert.rejects(invalidJson.listPublicCategories(), (error) => error.code === 'INVALID_JSON');

  const invalidData = createCatalogService(createHttpClient({
    baseUrl: BASE_URL,
    publicKey: PUBLIC_KEY,
    fetchImpl: async () => Response.json([{ id: PRODUCT_ID, name: 'Sin descripción' }]),
  }));
  await assert.rejects(invalidData.listPublicCategories(), (error) => error.code === 'INVALID_RESPONSE');
});

test('cancellation propagates as AbortError, not as a recoverable API error', async () => {
  const catalog = createCatalogService(createHttpClient({
    baseUrl: BASE_URL,
    publicKey: PUBLIC_KEY,
    fetchImpl: async () => { throw new DOMException('Aborted', 'AbortError'); },
  }));

  await assert.rejects(catalog.listPublicMenu(new AbortController().signal), (error) => error.name === 'AbortError');
});

test('network failures are normalized without exposing request details', async () => {
  const catalog = createCatalogService(createHttpClient({
    baseUrl: BASE_URL,
    publicKey: PUBLIC_KEY,
    fetchImpl: async () => { throw new TypeError('connection failed for https://private.example'); },
  }));

  await assert.rejects(catalog.listPublicMenu(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.message.includes('private.example'), false);
    return true;
  });
});
