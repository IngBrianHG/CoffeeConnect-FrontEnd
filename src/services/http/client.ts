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
  const code = (body as { code?: unknown }).code;
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

  return {
    get<T>(resource: string, query: Record<string, string> = {}, signal?: AbortSignal) {
      return request<T>(resource, { method: 'GET', query, signal });
    },
    request,
  };
}

const env = import.meta.env ?? {};
const defaultClient = createHttpClient({
  baseUrl: env.VITE_API_BASE_URL ?? '',
  publicKey: env.VITE_API_PUBLIC_KEY ?? '',
});

export const httpClient = defaultClient;
