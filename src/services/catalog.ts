import { ApiError, httpClient, type HttpClient } from './http/client.ts';
import { FIXED_KIOSK_CATEGORY_NAMES } from '../features/catalog/categoryNames.ts';

export interface PublicCategory {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
}

export interface PublicMenuItem {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
}

export interface CatalogService {
  listPublicCategories(signal?: AbortSignal): Promise<PublicCategory[]>;
  listPublicMenu(signal?: AbortSignal): Promise<PublicMenuItem[]>;
}

interface CategoryResponse {
  id: unknown;
  name: unknown;
  description: unknown;
  display_order: unknown;
}

interface MenuResponse {
  id: unknown;
  category_id: unknown;
  category_name: unknown;
  name: unknown;
  description: unknown;
  price: unknown;
  image_url: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIXED_CATEGORY_NAMES = new Set<string>(FIXED_KIOSK_CATEGORY_NAMES);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function invalidResponse(resource: string): never {
  throw new ApiError(200, `El servicio devolvió datos no válidos para ${resource}.`, 'INVALID_RESPONSE');
}

function parseArray<T>(data: unknown, resource: string, parseItem: (item: unknown) => T): T[] {
  if (data === null) return [];
  if (!Array.isArray(data)) return invalidResponse(resource);
  return data.map(parseItem);
}

function parseCategory(value: unknown): PublicCategory {
  if (!value || typeof value !== 'object') return invalidResponse('categorías');
  const row = value as CategoryResponse;
  if (
    typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)
    || typeof row.name !== 'string'
    || !isNullableString(row.description)
    || !FIXED_CATEGORY_NAMES.has(row.name)
    || typeof row.display_order !== 'number' || !Number.isInteger(row.display_order) || row.display_order < 0
  ) return invalidResponse('categorías');
  return { id: row.id, name: row.name, description: row.description, displayOrder: row.display_order };
}

function parseMenuItem(value: unknown): PublicMenuItem {
  if (!value || typeof value !== 'object') return invalidResponse('menú');
  const row = value as MenuResponse;
  if (
    typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)
    || typeof row.category_id !== 'string' || !UUID_PATTERN.test(row.category_id)
    || typeof row.category_name !== 'string'
    || !FIXED_CATEGORY_NAMES.has(row.category_name)
    || typeof row.name !== 'string'
    || !isNullableString(row.description)
    || typeof row.price !== 'number' || !Number.isFinite(row.price)
    || !isNullableString(row.image_url)
  ) return invalidResponse('menú');

  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    name: row.name,
    description: row.description,
    price: row.price,
    imageUrl: row.image_url,
  };
}

export function createCatalogService(client: HttpClient): CatalogService {
  return {
    async listPublicCategories(signal) {
      const data = await client.get<unknown>('categories', {
        select: 'id,name,description,display_order',
        active: 'eq.true',
        order: 'display_order.asc,name.asc',
      }, signal);
      return parseArray(data, 'categorías', parseCategory);
    },

    async listPublicMenu(signal) {
      const data = await client.get<unknown>('public_menu', {
        select: 'id,category_id,category_name,name,description,price,image_url',
        order: 'name.asc',
      }, signal);
      return parseArray(data, 'menú', parseMenuItem);
    },
  };
}

export const catalogService = createCatalogService(httpClient);
