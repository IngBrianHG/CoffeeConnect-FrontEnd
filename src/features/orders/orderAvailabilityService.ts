import { ApiError, type HttpClient } from '../../services/http/client.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PRODUCTS_PER_REQUEST = 100;

export interface OrderableProductAvailability {
  productId: string;
  availableQuantity: number;
  orderable: boolean;
  usesRecipe: boolean;
}

export interface OrderAvailabilityService {
  getAvailability(productIds: string[], signal?: AbortSignal): Promise<OrderableProductAvailability[]>;
}

type Row = Record<string, unknown>;

function invalid(): never {
  throw new ApiError(200, 'El servicio devolvió disponibilidad no válida.', 'INVALID_RESPONSE');
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAvailability(value: unknown, requestedIds: string[]): OrderableProductAvailability[] {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length !== requestedIds.length) return invalid();
  const requested = new Set(requestedIds);
  const seen = new Set<string>();
  const parsed = value.items.map(item => {
    if (!isRecord(item) || typeof item.product_id !== 'string' || !UUID.test(item.product_id)
      || !requested.has(item.product_id) || seen.has(item.product_id)
      || !Number.isInteger(item.available_quantity) || (item.available_quantity as number) < 0
      || typeof item.orderable !== 'boolean' || typeof item.uses_recipe !== 'boolean'
      || (!item.orderable && item.available_quantity !== 0)) return invalid();
    seen.add(item.product_id);
    return {
      productId: item.product_id,
      availableQuantity: item.available_quantity as number,
      orderable: item.orderable,
      usesRecipe: item.uses_recipe,
    };
  });
  if (seen.size !== requested.size || requestedIds.some(id => !seen.has(id))) return invalid();
  return parsed;
}

async function withRefresh<T>(
  operation: (token?: string) => Promise<T | null>,
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

export function createOrderAvailabilityService(
  client: HttpClient,
  getAccessToken: () => string | undefined = () => undefined,
  refreshAccessToken: () => Promise<string | null> = async () => null,
): OrderAvailabilityService {
  return {
    async getAvailability(productIds, signal) {
      if (!Array.isArray(productIds) || productIds.length < 1 || productIds.length > MAX_PRODUCTS_PER_REQUEST
        || productIds.some(id => typeof id !== 'string' || !UUID.test(id))
        || new Set(productIds).size !== productIds.length) {
        throw new ApiError(400, 'La selección de productos no es válida.', 'VALIDATION_ERROR');
      }
      const result = await withRefresh(
        token => client.request<unknown>('rpc/get_orderable_products_availability', {
          method: 'POST',
          body: { p_product_ids: productIds },
          accessToken: token,
          signal,
        }),
        getAccessToken,
        refreshAccessToken,
      );
      return parseAvailability(result, productIds);
    },
  };
}
