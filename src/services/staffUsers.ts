export type StaffRole = 'waiter' | 'cashier';

export interface StaffUser {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  active: boolean;
  createdAt: string;
  mustChangePassword: boolean;
}

export interface CreateStaffResponse {
  data: StaffUser & { temporaryPassword: string };
}

export interface StaffUsersPage {
  data: StaffUser[];
  nextCursor: string | null;
}

export class StaffUsersError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    requestId?: string,
  ) {
    super(message);
    this.name = 'StaffUsersError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

type StaffUserResponse = { data: StaffUser };
type StaffUsersResponse = StaffUsersPage;

const env = import.meta.env ?? {};
const baseUrl = (env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const publicKey = env.VITE_API_PUBLIC_KEY ?? '';
const endpoint = `${baseUrl}/functions/v1/staff-users`;

async function request<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  if (!baseUrl || !publicKey) {
    throw new StaffUsersError('El servicio de usuarios no está configurado.', 0, 'MISSING_CONFIGURATION');
  }
  if (!accessToken) {
    throw new StaffUsersError('Inicia sesión nuevamente para administrar el personal.', 401, 'UNAUTHENTICATED');
  }

  let response: Response;
  try {
    response = await fetch(`${endpoint}${path}`, {
      ...init,
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    });
  } catch {
    throw new StaffUsersError('No se pudo conectar con el servicio. Intenta de nuevo.', 0, 'NETWORK_ERROR');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      error?: { code?: unknown; message?: unknown };
    } | null;
    const code = typeof body?.error?.code === 'string' ? body.error.code : undefined;
    const message = typeof body?.error?.message === 'string'
      ? body.error.message
      : 'No se pudo completar la operación. Intenta de nuevo.';
    const requestId = response.headers.get('x-request-id') ?? undefined;
    console.error('[staff-users] request failed', {
      status: response.status,
      code,
      requestId,
    });
    throw new StaffUsersError(message, response.status, code, requestId);
  }

  if (response.status === 204) return undefined as T;
  try {
    return await response.json() as T;
  } catch {
    throw new StaffUsersError('El servicio devolvió una respuesta no válida.', response.status, 'INVALID_RESPONSE');
  }
}

export const staffUsers = {
  list(accessToken: string, options: { limit?: number; cursor?: string } = {}): Promise<StaffUsersPage> {
    const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
    if (options.cursor) query.set('cursor', options.cursor);
    return request<StaffUsersResponse>(accessToken, `?${query.toString()}`);
  },

  async create(accessToken: string, input: { email: string; displayName: string; role: StaffRole }): Promise<CreateStaffResponse['data']> {
    if (input.role !== 'waiter' && input.role !== 'cashier') {
      throw new StaffUsersError('El rol debe ser waiter o cashier.', 400, 'INVALID_ROLE');
    }
    const response = await request<CreateStaffResponse>(accessToken, '', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email.trim(),
        displayName: input.displayName.trim(),
        role: input.role,
      }),
    });
    return response.data;
  },

  async update(accessToken: string, id: string, changes: { displayName?: string; role?: StaffRole; active?: boolean }): Promise<StaffUser> {
    if (changes.role !== undefined && changes.role !== 'waiter' && changes.role !== 'cashier') {
      throw new StaffUsersError('El rol debe ser waiter o cashier.', 400, 'INVALID_ROLE');
    }
    const response = await request<StaffUserResponse>(accessToken, `/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    });
    return response.data;
  },

  async setActive(accessToken: string, id: string, active: boolean): Promise<StaffUser> {
    return this.update(accessToken, id, { active });
  },

  delete(accessToken: string, id: string): Promise<void> {
    return request<void>(accessToken, `/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
