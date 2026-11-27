import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createHttpClient } from '../src/services/http/client.ts';
import {
  cafeTablesErrorMessage, createCafeTablesService,
} from '../src/services/cafeTables.ts';

const tableId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const key = '33333333-3333-4333-8333-333333333333';
const stamp = '2026-11-26T12:00:00.000Z';
const table = {
  id: tableId, name: 'Mesa 1', status: 'available', active: true,
  created_at: stamp, updated_at: stamp,
};
const session = {
  id: sessionId, table_id: tableId, status: 'open', opened_by: null,
  opened_at: stamp, closed_at: null,
};

function service(handler, refresh = async () => null) {
  const calls = [];
  const client = {
    get: async () => null,
    request: async (resource, options) => {
      calls.push({ resource, options });
      return handler(resource, options, calls.length);
    },
  };
  return { api: createCafeTablesService(client, () => 'user-jwt', refresh), calls };
}

test('maps table/session fields and rejects malformed UUIDs, enums, timestamps and closures', async () => {
  const { api } = service(resource => resource === 'cafe_tables' ? [table] : [session]);
  assert.deepEqual(await api.listTables(), [{
    id: tableId, name: 'Mesa 1', status: 'available', active: true,
  }]);
  assert.deepEqual(await api.listOpenSessions(), [{
    id: sessionId, tableId, status: 'open', openedBy: null, openedAt: stamp, closedAt: null,
  }]);
  await assert.rejects(service(() => [{ ...table, id: 'not-a-uuid' }]).api.listTables(), { code: 'INVALID_RESPONSE' });
  await assert.rejects(service(() => [{ ...table, status: 'unknown' }]).api.listTables(), { code: 'INVALID_RESPONSE' });
  await assert.rejects(service(() => [{ ...table, created_at: 'bad-time' }]).api.listTables(), { code: 'INVALID_RESPONSE' });
  await assert.rejects(service(() => [{ ...session, closed_at: stamp }]).api.listOpenSessions(), { code: 'INVALID_RESPONSE' });
  await assert.rejects(service(() => [session, { ...session, id: '44444444-4444-4444-8444-444444444444' }]).api.listOpenSessions(), { code: 'INVALID_RESPONSE' });
});

test('sends only allowed table fields and the exact RPC payloads', async () => {
  const { api, calls } = service(resource => {
    if (resource === 'cafe_tables') return [{ ...table, name: 'Mesa nueva' }];
    if (resource === 'rpc/set_table_status') return 'unavailable';
    if (resource === 'rpc/open_table_session') return sessionId;
    if (resource === 'rpc/close_empty_table_session') return { table_session_id: sessionId, status: 'closed' };
    return null;
  });
  await api.createTable(' Mesa nueva ');
  await api.updateTable(tableId, { name: 'Mesa editada', active: false });
  assert.equal(await api.setTableStatus(tableId, 'unavailable'), 'unavailable');
  assert.equal(await api.openSession(tableId, key), sessionId);
  await api.closeSession(sessionId);
  assert.deepEqual(calls[0].options.body, { name: 'Mesa nueva', active: true });
  assert.deepEqual(calls[1].options.body, { name: 'Mesa editada', active: false });
  assert.equal('status' in calls[1].options.body, false);
  assert.deepEqual(calls[2].options.body, { p_table_id: tableId, p_status: 'unavailable' });
  assert.deepEqual(calls[3].options.body, { p_table_id: tableId, p_idempotency_key: key });
  assert.deepEqual(calls[4].options.body, { p_table_session_id: sessionId });
  assert.equal(calls.some(call => call.resource === 'table_sessions' && call.options.method !== 'GET'), false);
  await assert.rejects(api.createTable('  '), { code: 'VALIDATION_ERROR' });
  await assert.rejects(api.updateTable(tableId, { status: 'occupied' }), { code: 'VALIDATION_ERROR' });
});

test('retries one 401 with refreshed user JWT and translates business errors safely', async () => {
  let calls = 0;
  let refreshes = 0;
  const client = {
    get: async () => null,
    request: async (_resource, options) => {
      calls++;
      if (calls === 1) throw new ApiError(401, 'unauthorized');
      assert.equal(options.accessToken, 'renewed-jwt');
      return [table];
    },
  };
  const api = createCafeTablesService(client, () => 'expired-jwt', async () => {
    refreshes++;
    return 'renewed-jwt';
  });
  assert.equal((await api.listTables()).length, 1);
  assert.equal(calls, 2);
  assert.equal(refreshes, 1);
  assert.match(cafeTablesErrorMessage(new ApiError(400, 'database detail', 'SESSION_HAS_UNFINISHED_OR_UNPAID_ORDERS')), /terminarse y cobrarse/);
  assert.match(cafeTablesErrorMessage(new ApiError(403, 'forbidden', '42501')), /No tienes permisos/);
  assert.doesNotMatch(cafeTablesErrorMessage(new ApiError(500, 'secret SQL')), /secret SQL/);
});

test('preserves the exact idempotency key on ambiguous retry and translates conflicts', async () => {
  const sent = [];
  let attempt = 0;
  const api = createCafeTablesService({
    get: async () => null,
    request: async (resource, options) => {
      if (resource === 'rpc/open_table_session') {
        sent.push(options.body);
        attempt++;
        if (attempt === 1) throw new ApiError(0, 'network', 'NETWORK_ERROR');
        return sessionId;
      }
      throw new ApiError(409, 'conflict', 'TABLE_ALREADY_OPEN');
    },
  }, () => 'user-jwt');
  await assert.rejects(api.openSession(tableId, key), { code: 'NETWORK_ERROR' });
  assert.equal(await api.openSession(tableId, key), sessionId);
  assert.deepEqual(sent, [
    { p_table_id: tableId, p_idempotency_key: key },
    { p_table_id: tableId, p_idempotency_key: key },
  ]);
  await assert.rejects(api.setTableStatus(tableId, 'available'), { code: 'TABLE_ALREADY_OPEN' });
  assert.match(cafeTablesErrorMessage(new ApiError(409, '', 'TABLE_ALREADY_OPEN')), /ya tiene una sesión abierta/);
  assert.match(cafeTablesErrorMessage(new ApiError(409, '', '23505')), /otro nombre/);
});

test('resolves only the QR UUID/name through the public RPC with publishable key and no user JWT', async () => {
  const seen = [];
  const client = createHttpClient({
    baseUrl: 'https://coffee.example',
    publicKey: 'publishable-key',
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), init });
      return Response.json({ id: tableId, name: 'Mesa 1' });
    },
  });
  const api = createCafeTablesService(client);
  assert.deepEqual(await api.getPublicTable(tableId), { id: tableId, name: 'Mesa 1' });
  assert.equal(seen[0].url, 'https://coffee.example/rest/v1/rpc/get_public_table');
  assert.deepEqual(JSON.parse(seen[0].init.body), { p_table_id: tableId });
  assert.equal(seen[0].init.headers.apikey, 'publishable-key');
  assert.equal(seen[0].init.headers.Authorization, undefined);
});

test('simulated PostgREST errors expose safe business tokens without raw database details', async () => {
  const client = createHttpClient({
    baseUrl: 'https://coffee.example',
    publicKey: 'publishable-key',
    fetchImpl: async () => Response.json({
      code: 'P0001', message: 'TABLE_UNAVAILABLE', details: 'private SQL detail',
    }, { status: 400 }),
  });
  const api = createCafeTablesService(client, () => 'user-jwt');
  await assert.rejects(api.openSession(tableId, key), error => {
    assert.equal(error.code, 'TABLE_UNAVAILABLE');
    assert.match(cafeTablesErrorMessage(error), /no está disponible/);
    assert.doesNotMatch(error.message, /private SQL detail/);
    return true;
  });
});
