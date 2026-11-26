import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createHttpClient } from '../src/services/http/client.ts';
import { createInventoryService } from '../src/features/inventory/inventoryService.ts';
import { parseQuantity } from '../src/features/inventory/inventoryValidation.ts';

const BASE_URL = 'https://inventory.example.supabase.co';
const PUBLIC_KEY = 'public-test-key';
const TOKEN = 'test-access-token';
const INGREDIENT_ID = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174001';
const KEY = '123e4567-e89b-12d3-a456-426614174002';

function createService(fetchImpl) {
  const client = createHttpClient({ baseUrl: BASE_URL, publicKey: PUBLIC_KEY, fetchImpl });
  return createInventoryService(client, () => TOKEN);
}

test('inventory form quantity parsing rejects empty, zero, non-finite and excess precision values', () => {
  assert.equal(parseQuantity(''), null);
  assert.equal(parseQuantity('0'), null);
  assert.equal(parseQuantity('Infinity'), null);
  assert.equal(parseQuantity('1.0001'), null);
  assert.equal(parseQuantity('2.125'), 2.125);
  assert.equal(parseQuantity('-2'), null);
  assert.equal(parseQuantity('-2', { allowNegative: true }), -2);
});

test('ingredient and recipe responses transform UUID data to camelCase domain models', async () => {
  const service = createService(async url => {
    const requestUrl = new URL(url);
    if (requestUrl.pathname.endsWith('/ingredients')) {
      return Response.json([{
        id: INGREDIENT_ID, name: 'Café', unit: 'g', stock: 1200, min_stock: 250, active: true,
      }]);
    }
    if (requestUrl.pathname.endsWith('/product_ingredients')) {
      return Response.json([{
        product_id: PRODUCT_ID,
        ingredient_id: INGREDIENT_ID,
        quantity_per_portion: 18.5,
        ingredient: { id: INGREDIENT_ID, name: 'Café', unit: 'g', active: true },
      }]);
    }
    throw new Error(`Unexpected request ${requestUrl}`);
  });

  assert.deepEqual(await service.listIngredients(), [{
    id: INGREDIENT_ID, name: 'Café', unit: 'g', stock: 1200, minStock: 250, active: true,
  }]);
  assert.deepEqual(await service.listRecipe(PRODUCT_ID), [{
    ingredientId: INGREDIENT_ID, ingredientName: 'Café', unit: 'g', ingredientActive: true, quantityPerPortion: 18.5,
    preparationQuantity: null, preparationUnitCode: null,
  }]);
});

test('ingredient listing requests subsequent pages beyond the first 200 rows', async () => {
  const offsets = [];
  const rows = Array.from({ length: 200 }, (_, index) => ({
    id: `123e4567-e89b-12d3-a456-${String(index).padStart(12, '0')}`,
    name: `Ingrediente ${index}`, unit: 'g', stock: 1, min_stock: 0, active: true,
  }));
  const service = createService(async url => {
    const requestUrl = new URL(url);
    offsets.push(requestUrl.searchParams.get('offset'));
    return Response.json(requestUrl.searchParams.get('offset') === '0' ? rows : [{
      id: '123e4567-e89b-12d3-a456-000000000200',
      name: 'Ingrediente adicional', unit: 'g', stock: 1, min_stock: 0, active: true,
    }]);
  });
  const ingredients = await service.listIngredients();
  assert.equal(ingredients.length, 201);
  assert.deepEqual(offsets, ['0', '200']);
});

test('malformed inventory data and null collection payloads are not treated as zero or empty', async () => {
  const malformedService = createService(async () => Response.json([{
    id: INGREDIENT_ID, name: 'Café', unit: 'g', stock: 12, min_stock: null, active: true,
  }]));
  await assert.rejects(malformedService.listIngredients(), error => error.code === 'INVALID_RESPONSE');

  const nullService = createService(async () => new Response('null', { status: 200 }));
  await assert.rejects(nullService.listIngredients(), error => error.code === 'INVALID_RESPONSE');
});

test('products expose recipe-derived availability and direct-stock eligibility', async () => {
  const service = createService(async url => {
    const requestUrl = new URL(url);
    if (requestUrl.pathname.endsWith('/products')) {
      return Response.json([{ id: PRODUCT_ID, name: 'Pastel', stock: 7, active: true }]);
    }
    if (requestUrl.pathname.endsWith('/product_ingredients')) {
      return Response.json([{
        product_id: PRODUCT_ID, quantity_per_portion: 2,
        ingredient: { stock: 11, active: true },
      }]);
    }
    throw new Error(`Unexpected request ${requestUrl}`);
  });
  assert.deepEqual(await service.listProducts(), [{
    id: PRODUCT_ID, name: 'Pastel', stock: 7, active: true, hasRecipe: true, availableQuantity: 5,
  }]);
});

test('ingredient creation omits stock, sends auth, and requests the created representation', async () => {
  let captured;
  const service = createService(async (url, options) => {
    captured = { url: new URL(url), options };
    return Response.json([{
      id: INGREDIENT_ID, name: 'Café molido', unit: 'g', stock: 0, min_stock: 500, active: true,
    }], { status: 201 });
  });

  const ingredient = await service.createIngredient({ name: ' Café molido ', unit: 'g', minStock: 500, active: true });
  assert.equal(captured.options.headers.apikey, PUBLIC_KEY);
  assert.equal(captured.options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(captured.options.headers.Prefer, 'return=representation');
  assert.deepEqual(JSON.parse(captured.options.body), {
    name: 'Café molido', unit: 'g', min_stock: 500, active: true,
  });
  assert.equal('stock' in JSON.parse(captured.options.body), false);
  assert.equal(ingredient.stock, 0);
});

test('measurement catalog reads purchase-category units from PostgreSQL', async () => {
  let captured;
  const service = createService(async (url, options) => {
    captured = { url: new URL(url), options };
    return Response.json([
      { code: 'kg', name: 'Kilogramo', abbreviation: 'kg', category: 'weight', base_unit: 'g', conversion_factor: 1000, active: true, sort_order: 20 },
      { code: 'carton', name: 'Cartón', abbreviation: 'cartón', category: 'purchase', base_unit: null, conversion_factor: null, active: true, sort_order: 270 },
    ]);
  });
  const units = await service.listMeasurementUnits();
  assert.equal(captured.url.pathname, '/rest/v1/measurement_units');
  assert.equal(captured.url.searchParams.get('active'), 'eq.true');
  assert.equal(units[0].conversionFactor, 1000);
  assert.equal(units[1].category, 'purchase');
  assert.equal(units[1].baseUnit, null);
});

test('ingredient measurement adjustment sends original kg quantity to the server RPC', async () => {
  let captured;
  const service = createService(async (url, options) => {
    captured = { url: new URL(url), body: JSON.parse(options.body) };
    return Response.json(1000);
  });
  assert.equal(await service.adjustIngredientStock({
    ingredientId: INGREDIENT_ID, delta: 1, unitCode: 'kg', type: 'purchase', idempotencyKey: KEY,
  }), 1000);
  assert.equal(captured.url.pathname, '/rest/v1/rpc/adjust_ingredient_stock_measurement');
  assert.equal(captured.body.p_quantity, 1);
  assert.equal(captured.body.p_unit_code, 'kg');
});

test('configured package purchase sends package count and presentation id to its RPC', async () => {
  let captured;
  const service = createService(async (url, options) => {
    captured = { url: new URL(url), body: JSON.parse(options.body) };
    return Response.json(12);
  });
  assert.equal(await service.purchaseIngredientPresentation({
    ingredientId: INGREDIENT_ID, presentationId: PRODUCT_ID, quantity: 1, idempotencyKey: KEY,
  }), 12);
  assert.equal(captured.url.pathname, '/rest/v1/rpc/record_ingredient_presentation_purchase');
  assert.equal(captured.body.p_quantity, 1);
  assert.equal(captured.body.p_presentation_id, PRODUCT_ID);
});

test('recipe replacement uses one RPC with snake_case lines and rejects duplicate or imprecise quantities', async () => {
  let captured;
  const service = createService(async (url, options) => {
    captured = { url: new URL(url), options };
    return Response.json(2);
  });

  assert.equal(await service.replaceRecipe(PRODUCT_ID, [{ ingredientId: INGREDIENT_ID, quantity: 0.018, unitCode: 'kg' }]), 2);
  assert.equal(captured.url.pathname, '/rest/v1/rpc/replace_product_recipe');
  assert.equal(captured.options.method, 'POST');
  assert.deepEqual(JSON.parse(captured.options.body), {
    p_product_id: PRODUCT_ID,
    p_lines: [{ ingredient_id: INGREDIENT_ID, quantity: 0.018, unit_code: 'kg' }],
  });
  await assert.rejects(
    service.replaceRecipe(PRODUCT_ID, [
      { ingredientId: INGREDIENT_ID, quantity: 1, unitCode: 'g' },
      { ingredientId: INGREDIENT_ID, quantity: 2, unitCode: 'g' },
    ]),
    error => error.code === 'INVALID_RECIPE',
  );
  await assert.rejects(
    service.replaceRecipe(PRODUCT_ID, [{ ingredientId: INGREDIENT_ID, quantity: 1.0001, unitCode: 'g' }]),
    error => error.code === 'INVALID_RECIPE',
  );
  await assert.rejects(
    service.replaceRecipe(PRODUCT_ID, []),
    error => error.code === 'INVALID_RECIPE',
  );
});

test('recipe deletion is a distinct explicit service operation', async () => {
  let captured;
  const service = createService(async (url, options) => {
    captured = { url: new URL(url), body: JSON.parse(options.body) };
    return Response.json(0);
  });
  await service.deleteRecipe(PRODUCT_ID);
  assert.equal(captured.url.pathname, '/rest/v1/rpc/replace_product_recipe');
  assert.deepEqual(captured.body, { p_product_id: PRODUCT_ID, p_lines: [] });
});

test('recipe RPC receives decimal preparation units without client-side conversion', async () => {
  let captured;
  const service = createService(async (_url, options) => {
    captured = JSON.parse(options.body);
    return Response.json(2);
  });
  await service.replaceRecipe(PRODUCT_ID, [
    { ingredientId: INGREDIENT_ID, quantity: 0.5, unitCode: 'cup' },
    { ingredientId: '123e4567-e89b-12d3-a456-426614174003', quantity: 1, unitCode: 'tbsp' },
  ]);
  assert.deepEqual(captured.p_lines.map(line => [line.quantity, line.unit_code]), [[0.5, 'cup'], [1, 'tbsp']]);
});

test('stock adjustment uses RPC idempotency and rejects invalid directions before network access', async () => {
  const calls = [];
  const service = createService(async (url, options) => {
    calls.push({ url: new URL(url), body: JSON.parse(options.body) });
    return Response.json(1200);
  });

  assert.equal(await service.adjustIngredientStock({
    ingredientId: INGREDIENT_ID, delta: 1000, unitCode: 'g', type: 'purchase', idempotencyKey: KEY, reason: 'Compra',
  }), 1200);
  assert.equal(calls[0].url.pathname, '/rest/v1/rpc/adjust_ingredient_stock_measurement');
  assert.equal(calls[0].body.p_idempotency_key, KEY);
  assert.equal(calls[0].body.p_quantity, 1000);
  assert.equal(calls[0].body.p_unit_code, 'g');
  await assert.rejects(
    service.adjustIngredientStock({
      ingredientId: INGREDIENT_ID, delta: -1, unitCode: 'g', type: 'purchase', idempotencyKey: KEY,
    }),
    error => error.code === 'ADJUSTMENT_DIRECTION_INVALID',
  );
  await assert.rejects(
    service.adjustIngredientStock({
      ingredientId: INGREDIENT_ID, delta: Number.POSITIVE_INFINITY, unitCode: 'g', type: 'manual_adjustment', idempotencyKey: KEY,
    }),
    error => error.code === 'INVALID_INVENTORY_ADJUSTMENT',
  );
  assert.equal(calls.length, 1);
});

test('finished product stock adjustment uses its RPC and returns the server balance', async () => {
  let captured;
  const service = createService(async (url, options) => {
    captured = { url: new URL(url), body: JSON.parse(options.body) };
    return Response.json(8);
  });
  assert.equal(await service.adjustProductStock({
    productId: PRODUCT_ID, delta: -2, type: 'damage', idempotencyKey: KEY, reason: 'Producto dañado',
  }), 8);
  assert.equal(captured.url.pathname, '/rest/v1/rpc/adjust_product_stock');
  assert.deepEqual(captured.body, {
    p_product_id: PRODUCT_ID, p_delta: -2, p_type: 'damage',
    p_idempotency_key: KEY, p_reason: 'Producto dañado',
  });
});

test('movement service only reads the immutable movement ledger', async () => {
  let captured;
  const service = createService(async (url, options) => {
    captured = { url: new URL(url), options };
    return Response.json([{
      id: KEY, ingredient_id: INGREDIENT_ID, product_id: null, type: 'purchase',
      quantity_delta: 100, reason: 'Compra', created_by: 'staff', created_at: '2026-01-01T00:00:00Z',
    }]);
  });

  assert.deepEqual(await service.listInventoryMovements({ ingredientId: INGREDIENT_ID }), [{
    id: KEY, ingredientId: INGREDIENT_ID, productId: null, type: 'purchase',
    quantityDelta: 100, reason: 'Compra', createdBy: 'staff', createdAt: '2026-01-01T00:00:00Z',
  }]);
  assert.equal(captured.options.method, 'GET');
  assert.equal(captured.url.searchParams.get('ingredient_id'), `eq.${INGREDIENT_ID}`);
});

test('server errors keep safe contract codes without exposing SQL details', async () => {
  const service = createService(async () => Response.json({
    code: 'INSUFFICIENT_STOCK',
    message: 'private SQL detail',
  }, { status: 400 }));

  await assert.rejects(service.adjustIngredientStock({
    ingredientId: INGREDIENT_ID, delta: -10, unitCode: 'g', type: 'damage', idempotencyKey: KEY,
  }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'INSUFFICIENT_STOCK');
    assert.equal(error.message.includes('private SQL detail'), false);
    return true;
  });
});
