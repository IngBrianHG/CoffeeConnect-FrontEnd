export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface HttpClient {
  get<T>(resource: string, query?: Record<string, string>, signal?: AbortSignal): Promise<T | null>;
  request<T>(resource: string, options?: HttpRequestOptions): Promise<T | null>;
  invoke<T>(functionName: string, body: FormData, accessToken?: string): Promise<T | null>;
}

export interface HttpRequestOptions {
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
  accessToken?: string;
  prefer?: string;
  signal?: AbortSignal;
}

interface HttpClientOptions {
  baseUrl: string;
  publicKey: string;
  fetchImpl?: typeof fetch;
}

function apiMessage(status: number): string {
  if (status === 401 || status === 403) return 'No se pudo acceder al catálogo. Verifica la configuración de acceso.';
  if (status === 404) return 'No se encontró el recurso del catálogo. Verifica la configuración del servicio.';
  if (status >= 500) return 'El servicio no está disponible temporalmente. Intenta de nuevo.';
  return 'No se pudo completar la solicitud al catálogo.';
}

function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('code' in body)) return undefined;
  const payload = body as { code?: unknown; message?: unknown; error?: unknown };
  const safeCodes = new Set([
    '23505', '23503', '23514', '22P02', '42501',
    'TABLE_NOT_FOUND', 'SESSION_NOT_FOUND', 'TABLE_ALREADY_OPEN', 'TABLE_UNAVAILABLE',
    'TABLE_HAS_OPEN_SESSION', 'OPEN_SESSION_REQUIRED', 'SESSION_NOT_OPEN',
    'SESSION_HAS_UNFINISHED_OR_UNPAID_ORDERS', 'IDEMPOTENCY_KEY_REUSED', 'FORBIDDEN',
    'NO_OPEN_TABLE_SESSION', 'PRODUCT_UNAVAILABLE', 'PRODUCT_RECIPE_HAS_INACTIVE_INGREDIENT',
    'INSUFFICIENT_PRODUCT_STOCK', 'INSUFFICIENT_INGREDIENT_STOCK', 'INVALID_ORDER',
    'INVALID_QUANTITY', 'INVALID_PRODUCT_SELECTION', 'ORDER_NOT_FOUND', 'ORDER_NOT_PENDING', 'INVALID_ORDER_TRANSITION',
    'ORDER_TOO_LATE_TO_CANCEL', 'ORDER_HAS_PAYMENT',
  ]);
  const message = typeof payload.message === 'string' ? payload.message : '';
  const nestedError = typeof payload.error === 'string' ? payload.error : '';
  const nestedToken = nestedError.match(/^[A-Z0-9_]+/)?.[0] ?? '';
  const messageToken = message.match(/^[A-Z0-9_]+/)?.[0] ?? '';
  const token = safeCodes.has(messageToken) ? messageToken : safeCodes.has(nestedToken) ? nestedToken : '';
  if (safeCodes.has(token)) return token;
  const code = payload.code;
  return typeof code === 'string' ? code : undefined;
}

export function createHttpClient({ baseUrl, publicKey, fetchImpl = fetch }: HttpClientOptions): HttpClient {
  const normalizedBase = baseUrl.replace(/\/+$/, '');

  const request = async <T>(resource: string, options: HttpRequestOptions = {}): Promise<T | null> => {
    if (!normalizedBase || !publicKey) {
      throw new ApiError(0, 'El servicio de catálogo no está configurado.', 'MISSING_CONFIGURATION');
    }
    const path = resource.replace(/^\/+/, '');
    let url: URL;
    try {
      url = new URL(`${normalizedBase}/rest/v1/${path}`);
    } catch {
      throw new ApiError(0, 'La URL del servicio de catálogo no es válida.', 'INVALID_CONFIGURATION');
    }
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      apikey: publicKey,
      Accept: 'application/json',
    };
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
    if (options.prefer) headers.Prefer = options.prefer;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new ApiError(0, 'No se pudo conectar con el servicio. Intenta de nuevo.', 'NETWORK_ERROR');
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null) as unknown;
      throw new ApiError(response.status, apiMessage(response.status), errorCode(body));
    }

    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(response.status, 'El servicio devolvió una respuesta no válida.', 'INVALID_JSON');
    }
  };

  const invoke = async <T>(functionName: string, body: FormData, accessToken?: string): Promise<T | null> => {
    if (!normalizedBase || !publicKey) {
      throw new ApiError(0, 'El servicio de catálogo no está configurado.', 'MISSING_CONFIGURATION');
    }
    if (!/^[a-z0-9-]+$/i.test(functionName)) {
      throw new ApiError(0, 'La función solicitada no es válida.', 'INVALID_FUNCTION');
    }
    let response: Response;
    try {
      response = await fetchImpl(`${normalizedBase}/functions/v1/${functionName}`, {
        method: 'POST',
        headers: {
          apikey: publicKey,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new ApiError(0, 'No se pudo conectar con el servicio. Intenta de nuevo.', 'NETWORK_ERROR');
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as unknown;
      const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const nested = root.error && typeof root.error === 'object' ? root.error as Record<string, unknown> : root;
      const code = typeof nested.code === 'string' ? nested.code : errorCode(payload);
      throw new ApiError(response.status, apiMessage(response.status), code);
    }
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(response.status, 'El servicio devolvió una respuesta no válida.', 'INVALID_JSON');
    }
  };

  return {
    get<T>(resource: string, query: Record<string, string> = {}, signal?: AbortSignal) {
      return request<T>(resource, { method: 'GET', query, signal });
    },
    request,
    invoke,
  };
}

const env = import.meta.env ?? {};
const defaultClient = createHttpClient({
  baseUrl: env.VITE_API_BASE_URL ?? '',
  publicKey: env.VITE_API_PUBLIC_KEY ?? '',
});

export const httpClient = defaultClient;
