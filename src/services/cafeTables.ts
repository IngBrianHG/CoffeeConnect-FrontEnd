import { ApiError, type HttpClient } from './http/client.ts';

export type TableStatus = 'available' | 'assigned' | 'occupied' | 'unavailable';
export type TableSessionStatus = 'open' | 'closed' | 'cancelled';

export interface CafeTable {
  id: string;
  name: string;
  status: TableStatus;
  active: boolean;
}

export interface TableSession {
  id: string;
  tableId: string;
  status: TableSessionStatus;
  openedBy: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface PublicTable {
  id: string;
  name: string;
}

export interface CafeTablesService {
  listTables(signal?: AbortSignal): Promise<CafeTable[]>;
  listOpenSessions(signal?: AbortSignal): Promise<TableSession[]>;
  createTable(name: string): Promise<CafeTable>;
  updateTable(id: string, changes: { name?: string; active?: boolean }): Promise<CafeTable>;
  setTableStatus(id: string, status: 'available' | 'unavailable'): Promise<TableStatus>;
  openSession(tableId: string, idempotencyKey: string): Promise<string>;
  closeSession(sessionId: string): Promise<void>;
  getPublicTable(tableId: string, signal?: AbortSignal): Promise<PublicTable | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TABLE_STATUSES = new Set<TableStatus>(['available', 'assigned', 'occupied', 'unavailable']);
const SESSION_STATUSES = new Set<TableSessionStatus>(['open', 'closed', 'cancelled']);
const TABLE_SELECT = 'id,name,status,active,created_at,updated_at';
const SESSION_SELECT = 'id,table_id,status,opened_by,opened_at,closed_at';

type Row = Record<string, unknown>;

function invalid(resource: string): never {
  throw new ApiError(200, `El servicio devolvió datos no válidos para ${resource}.`, 'INVALID_RESPONSE');
}

function record(value: unknown, resource: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(resource);
  return value as Row;
}

function parseUuid(value: unknown, resource: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) return invalid(resource);
  return value;
}

function parseTimestamp(value: unknown, resource: string): string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) return invalid(resource);
  return value;
}

function parseTable(value: unknown): CafeTable {
  const row = record(value, 'mesas');
  if (typeof row.name !== 'string' || !row.name.trim() || typeof row.active !== 'boolean' || !TABLE_STATUSES.has(row.status as TableStatus)) {
    return invalid('mesas');
  }
  parseTimestamp(row.created_at, 'mesas');
  parseTimestamp(row.updated_at, 'mesas');
  return {
    id: parseUuid(row.id, 'mesas') as string,
    name: row.name,
    status: row.status as TableStatus,
    active: row.active,
  };
}

function parseSession(value: unknown): TableSession {
  const row = record(value, 'sesiones');
  if (!SESSION_STATUSES.has(row.status as TableSessionStatus)) return invalid('sesiones');
  const status = row.status as TableSessionStatus;
  const closedAt = row.closed_at === null ? null : parseTimestamp(row.closed_at, 'sesiones');
  if ((status === 'open' && closedAt !== null) || (status !== 'open' && closedAt === null)) return invalid('sesiones');
  return {
    id: parseUuid(row.id, 'sesiones') as string,
    tableId: parseUuid(row.table_id, 'sesiones') as string,
    status,
    openedBy: parseUuid(row.opened_by, 'sesiones', true),
    openedAt: parseTimestamp(row.opened_at, 'sesiones'),
    closedAt,
  };
}

function parseList<T>(value: unknown, resource: string, parse: (row: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalid(resource);
  const parsed = value.map(parse);
  const ids = new Set<string>();
  for (const row of parsed) {
    const id = (row as { id?: unknown }).id;
    if (typeof id !== 'string' || ids.has(id)) return invalid(resource);
    ids.add(id);
  }
  return parsed;
}

function representation(value: unknown, resource: string): CafeTable {
  if (!Array.isArray(value) || value.length !== 1) return invalid(resource);
  return parseTable(value[0]);
}

async function refreshOnUnauthorized<T>(
  operation: (accessToken?: string) => Promise<T | null>,
  getAccessToken: () => string | undefined,
  refreshAccessToken: () => Promise<string | null>,
): Promise<T | null> {
  try {
    return await operation(getAccessToken());
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const token = await refreshAccessToken().catch(() => null);
    if (!token) throw error;
    return operation(token);
  }
}

export function createCafeTablesService(
  client: HttpClient,
  getAccessToken: () => string | undefined = () => undefined,
  refreshAccessToken: () => Promise<string | null> = async () => null,
): CafeTablesService {
  const request = <T>(resource: string, options: Parameters<HttpClient['request']>[1] = {}) =>
    refreshOnUnauthorized(token => client.request<T>(resource, { ...options, accessToken: token }), getAccessToken, refreshAccessToken);
  const rpc = <T>(name: string, body: unknown, accessToken?: string, signal?: AbortSignal) =>
    client.request<T>(`rpc/${name}`, { method: 'POST', body, accessToken, signal });

  return {
    async listTables(signal) {
      const value = await request<unknown>('cafe_tables', {
        method: 'GET',
        query: { select: TABLE_SELECT, order: 'name.asc', limit: '200' },
        signal,
      });
      return parseList(value, 'mesas', parseTable);
    },
    async listOpenSessions(signal) {
      const value = await request<unknown>('table_sessions', {
        method: 'GET',
        query: { select: SESSION_SELECT, status: 'eq.open', order: 'opened_at.desc', limit: '200' },
        signal,
      });
      const items = parseList(value, 'sesiones', parseSession);
      const tableIds = new Set<string>();
      for (const item of items) {
        if (tableIds.has(item.tableId)) return invalid('sesiones');
        tableIds.add(item.tableId);
      }
      return items;
    },
    async createTable(name) {
      const normalized = name.trim();
      if (!normalized) throw new ApiError(400, 'Escribe un nombre para la mesa.', 'VALIDATION_ERROR');
      const value = await request<unknown>('cafe_tables', {
        method: 'POST',
        body: { name: normalized, active: true },
        prefer: 'return=representation',
      });
      return representation(value, 'mesas');
    },
    async updateTable(id, changes) {
      if (!UUID.test(id) || Object.keys(changes).length === 0
        || Object.keys(changes).some(key => key !== 'name' && key !== 'active')) {
        throw new ApiError(400, 'Los datos de la mesa no son válidos.', 'VALIDATION_ERROR');
      }
      const body: { name?: string; active?: boolean } = {};
      if (changes.name !== undefined) {
        const name = changes.name.trim();
        if (!name) throw new ApiError(400, 'Escribe un nombre para la mesa.', 'VALIDATION_ERROR');
        body.name = name;
      }
      if (changes.active !== undefined) body.active = changes.active;
      const value = await request<unknown>('cafe_tables', {
        method: 'PATCH',
        query: { id: `eq.${id}` },
        body,
        prefer: 'return=representation',
      });
      return representation(value, 'mesas');
    },
    async setTableStatus(id, status) {
      if (!UUID.test(id) || (status !== 'available' && status !== 'unavailable')) {
        throw new ApiError(400, 'La disponibilidad solicitada no es válida.', 'VALIDATION_ERROR');
      }
      const value = await request<unknown>('rpc/set_table_status', {
        method: 'POST', body: { p_table_id: id, p_status: status },
      });
      if (typeof value !== 'string' || !TABLE_STATUSES.has(value as TableStatus)) return invalid('disponibilidad');
      return value as TableStatus;
    },
    async openSession(tableId, idempotencyKey) {
      if (!UUID.test(tableId) || !UUID.test(idempotencyKey)) {
        throw new ApiError(400, 'La mesa o clave de apertura no es válida.', 'VALIDATION_ERROR');
      }
      const value = await request<unknown>('rpc/open_table_session', {
        method: 'POST',
        body: { p_table_id: tableId, p_idempotency_key: idempotencyKey },
      });
      return parseUuid(value, 'sesión') as string;
    },
    async closeSession(sessionId) {
      if (!UUID.test(sessionId)) throw new ApiError(400, 'La sesión seleccionada no es válida.', 'VALIDATION_ERROR');
      const value = await request<unknown>('rpc/close_empty_table_session', {
        method: 'POST', body: { p_table_session_id: sessionId },
      });
      const row = record(value, 'cierre de sesión');
      if (parseUuid(row.table_session_id, 'cierre de sesión') !== sessionId || row.status !== 'closed') return invalid('cierre de sesión');
    },
    async getPublicTable(tableId, signal) {
      if (!UUID.test(tableId)) throw new ApiError(400, 'El código QR no contiene un UUID válido.', 'VALIDATION_ERROR');
      const value = await rpc<unknown>('get_public_table', { p_table_id: tableId }, undefined, signal);
      if (value === null) return null;
      const row = record(value, 'mesa pública');
      if (parseUuid(row.id, 'mesa pública') !== tableId || typeof row.name !== 'string' || !row.name.trim()) return invalid('mesa pública');
      return { id: tableId, name: row.name };
    },
  };
}

export function cafeTablesErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No se pudo conectar con el servicio. Revisa la conexión e intenta de nuevo.';
  const messages: Record<string, string> = {
    VALIDATION_ERROR: error.message,
    '23505': 'Ya existe una mesa con ese nombre. Elige otro nombre.',
    '23503': 'La mesa está relacionada con sesiones o historial y no se puede eliminar.',
    '22P02': 'El formato del identificador o estado no es válido. Actualiza la vista e intenta de nuevo.',
    TABLE_NOT_FOUND: 'La mesa ya no existe o está inactiva. Actualiza la lista.',
    SESSION_NOT_FOUND: 'La sesión ya no existe. Actualiza la lista.',
    TABLE_ALREADY_OPEN: 'Esta mesa ya tiene una sesión abierta. Actualiza la lista.',
    TABLE_UNAVAILABLE: 'La mesa no está disponible para abrir una sesión.',
    TABLE_HAS_OPEN_SESSION: 'No se puede cambiar la disponibilidad mientras la mesa tenga una sesión abierta.',
    OPEN_SESSION_REQUIRED: 'Solo se puede marcar ocupada una mesa con una sesión abierta.',
    SESSION_NOT_OPEN: 'La sesión ya no está abierta. Actualiza la lista.',
    SESSION_HAS_UNFINISHED_OR_UNPAID_ORDERS: 'No se puede cerrar: primero deben terminarse y cobrarse las órdenes pendientes.',
    IDEMPOTENCY_KEY_REUSED: 'La clave de apertura ya se usó con otra mesa. Actualiza la lista e inicia una nueva apertura.',
    FORBIDDEN: 'No tienes permisos para realizar esta operación.',
    '42501': 'No tienes permisos para realizar esta operación.',
    '23514': 'La operación no cumple las reglas actuales de la mesa.',
    INVALID_RESPONSE: 'El servicio devolvió datos no válidos. Actualiza la vista e intenta de nuevo.',
  };
  if (messages[error.code ?? '']) return messages[error.code ?? ''];
  if (error.status === 401) return 'La sesión expiró. Inicia sesión nuevamente.';
  if (error.status === 403 || error.code === '42501') return 'No tienes permisos para realizar esta operación.';
  if (error.status >= 500 || error.status === 0) return 'El servicio no está disponible. Puedes reintentar.';
  return 'No se pudo completar la operación. Revisa los datos e intenta de nuevo.';
}
