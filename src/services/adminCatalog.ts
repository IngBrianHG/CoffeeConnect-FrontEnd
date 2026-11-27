import { ApiError, type HttpClient } from './http/client.ts';

export interface AdminCategory {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface AdminProduct {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  active: boolean;
  stock?: number;
}

export type PromotionType = 'nxm' | 'percent';
export type PromotionScope = 'product' | 'category' | 'all_menu';

export interface AdminPromotion {
  id: string;
  name: string;
  description: string | null;
  type: PromotionType;
  scope: PromotionScope;
  buyQuantity: number | null;
  payQuantity: number | null;
  percent: number | null;
  productId: string | null;
  categoryId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
}

export interface CategoryInput {
  name: string;
  description?: string | null;
  active?: boolean;
}

export interface ProductInput {
  categoryId: string;
  name: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  active?: boolean;
}

export interface PromotionInput {
  name: string;
  description?: string | null;
  type: PromotionType;
  scope: PromotionScope;
  buyQuantity?: number | null;
  payQuantity?: number | null;
  percent?: number | null;
  productId?: string | null;
  categoryId?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  active?: boolean;
}

export interface AdminCatalogService {
  listCategories(signal?: AbortSignal): Promise<AdminCategory[]>;
  createCategory(input: CategoryInput): Promise<void>;
  updateCategory(id: string, input: CategoryInput): Promise<void>;
  listProducts(signal?: AbortSignal): Promise<AdminProduct[]>;
  createProduct(input: ProductInput): Promise<void>;
  updateProduct(id: string, input: ProductInput): Promise<void>;
  uploadProductImage(file: File): Promise<string>;
  listPromotions(signal?: AbortSignal): Promise<AdminPromotion[]>;
  createPromotion(input: PromotionInput): Promise<void>;
  updatePromotion(id: string, input: PromotionInput): Promise<void>;
  deactivatePromotion(id: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORY_SELECT = 'id,name,description,active,created_at,updated_at';
const PRODUCT_SELECT = 'id,category_id,name,description,price,image_url,active,stock,created_at,updated_at';
const PROMOTION_SELECT = 'id,name,description,type,scope,buy_quantity,pay_quantity,percent,product_id,category_id,starts_on,ends_on,active';
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Row = Record<string, unknown>;
function invalid(resource: string): never {
  throw new ApiError(200, `El servicio devolvió datos no válidos para ${resource}.`, 'INVALID_RESPONSE');
}
function object(value: unknown, resource: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(resource);
  return value as Row;
}
function string(value: unknown, resource: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') return invalid(resource);
  return value;
}
function uuid(value: unknown, resource: string, nullable = false): string | null {
  const parsed = string(value, resource, nullable);
  if (parsed === null && nullable) return null;
  if (!parsed || !UUID.test(parsed)) return invalid(resource);
  return parsed;
}
function boolean(value: unknown, resource: string): boolean {
  if (typeof value !== 'boolean') return invalid(resource);
  return value;
}
function nullableNumber(value: unknown, resource: string): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return invalid(resource);
  return parsed;
}
function parseList<T>(data: unknown, resource: string, parse: (row: unknown) => T): T[] {
  if (!Array.isArray(data)) return invalid(resource);
  return data.map(parse);
}
function parseCategory(value: unknown): AdminCategory {
  const row = object(value, 'categorías');
  const name = string(row.name, 'categorías') as string;
  if (!name.trim()) return invalid('categorías');
  return {
    id: uuid(row.id, 'categorías') as string,
    name,
    description: string(row.description, 'categorías', true),
    active: boolean(row.active, 'categorías'),
  };
}
function parseProduct(value: unknown): AdminProduct {
  const row = object(value, 'productos');
  const name = string(row.name, 'productos') as string;
  const price = nullableNumber(row.price, 'productos');
  const stock = row.stock === undefined ? undefined : nullableNumber(row.stock, 'productos');
  if (!name.trim() || price === null || price <= 0 || (stock !== undefined && (stock === null || stock < 0))) return invalid('productos');
  return {
    id: uuid(row.id, 'productos') as string,
    categoryId: uuid(row.category_id, 'productos') as string,
    name,
    description: string(row.description, 'productos', true),
    price,
    imageUrl: string(row.image_url, 'productos', true),
    active: boolean(row.active, 'productos'),
    ...(stock === undefined ? {} : { stock }),
  };
}
function parsePromotion(value: unknown): AdminPromotion {
  const row = object(value, 'promociones');
  const name = string(row.name, 'promociones') as string;
  if (!name.trim()) return invalid('promociones');
  if (row.type !== 'nxm' && row.type !== 'percent') return invalid('promociones');
  if (row.scope !== 'product' && row.scope !== 'category' && row.scope !== 'all_menu') return invalid('promociones');
  const buyQuantity = nullableNumber(row.buy_quantity, 'promociones');
  const payQuantity = nullableNumber(row.pay_quantity, 'promociones');
  const percent = nullableNumber(row.percent, 'promociones');
  const productId = uuid(row.product_id, 'promociones', true);
  const categoryId = uuid(row.category_id, 'promociones', true);
  if (row.scope === 'product' ? (!productId || categoryId) : row.scope === 'category' ? (!categoryId || productId) : (productId || categoryId)) return invalid('promociones');
  if (row.type === 'nxm' ? (buyQuantity === null || payQuantity === null || buyQuantity < 2 || payQuantity < 1 || payQuantity >= buyQuantity || percent !== null) : (percent === null || percent <= 0 || percent > 100 || buyQuantity !== null || payQuantity !== null)) return invalid('promociones');
  const startsOn = string(row.starts_on, 'promociones', true);
  const endsOn = string(row.ends_on, 'promociones', true);
  const validDate = (date: string | null) => date === null || (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)));
  if (!validDate(startsOn) || !validDate(endsOn)) return invalid('promociones');
  if (startsOn && endsOn && startsOn > endsOn) return invalid('promociones');
  return {
    id: uuid(row.id, 'promociones') as string,
    name,
    description: string(row.description, 'promociones', true),
    type: row.type,
    scope: row.scope,
    buyQuantity,
    payQuantity,
    percent,
    productId,
    categoryId,
    startsOn,
    endsOn,
    active: boolean(row.active, 'promociones'),
  };
}

function requiredName(value: string): string {
  const name = value.trim();
  if (!name) throw new ApiError(400, 'Escribe un nombre para continuar.', 'VALIDATION_ERROR');
  return name;
}
function validateProduct(input: ProductInput) {
  if (!UUID.test(input.categoryId)) throw new ApiError(400, 'Selecciona una categoría válida.', 'VALIDATION_ERROR');
  const cents = input.price * 100;
  if (!Number.isFinite(input.price) || input.price <= 0 || Math.abs(cents - Math.round(cents)) > 1e-8) {
    throw new ApiError(400, 'El precio debe ser positivo y tener como máximo dos decimales.', 'VALIDATION_ERROR');
  }
  return {
    category_id: input.categoryId,
    name: requiredName(input.name),
    description: input.description?.trim() || null,
    price: input.price,
    image_url: input.imageUrl ?? null,
    active: input.active ?? true,
  };
}
function validatePromotion(input: PromotionInput) {
  const productId = input.productId ?? null;
  const categoryId = input.categoryId ?? null;
  if (input.scope === 'product' ? (!productId || !UUID.test(productId) || categoryId !== null) : input.scope === 'category' ? (!categoryId || !UUID.test(categoryId) || productId !== null) : input.scope === 'all_menu' ? (productId !== null || categoryId !== null) : true) {
    throw new ApiError(400, 'El objetivo no coincide con el alcance de la promoción.', 'VALIDATION_ERROR');
  }
  if (input.type === 'nxm') {
    if (!Number.isInteger(input.buyQuantity) || (input.buyQuantity ?? 0) < 2 || !Number.isInteger(input.payQuantity) || (input.payQuantity ?? 0) < 1 || (input.payQuantity ?? 0) >= (input.buyQuantity ?? 0) || input.percent != null) {
      throw new ApiError(400, 'Para N×M, las cantidades deben cumplir 1 ≤ paga < lleva y llevar debe ser al menos 2.', 'VALIDATION_ERROR');
    }
  } else if (input.type === 'percent') {
    if (!Number.isFinite(input.percent) || (input.percent ?? 0) <= 0 || (input.percent ?? 101) > 100 || input.buyQuantity != null || input.payQuantity != null) {
      throw new ApiError(400, 'El porcentaje debe ser mayor que 0 y no superar 100.', 'VALIDATION_ERROR');
    }
  } else throw new ApiError(400, 'El tipo de promoción no es válido.', 'VALIDATION_ERROR');
  if (input.startsOn && input.endsOn && input.startsOn > input.endsOn) throw new ApiError(400, 'La fecha inicial no puede ser posterior a la final.', 'VALIDATION_ERROR');
  return {
    name: requiredName(input.name),
    description: input.description?.trim() || null,
    type: input.type,
    scope: input.scope,
    buy_quantity: input.type === 'nxm' ? input.buyQuantity : null,
    pay_quantity: input.type === 'nxm' ? input.payQuantity : null,
    percent: input.type === 'percent' ? input.percent : null,
    product_id: productId,
    category_id: categoryId,
    starts_on: input.startsOn ?? null,
    ends_on: input.endsOn ?? null,
    active: input.active ?? true,
  };
}

export function adminCatalogErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No se pudo conectar con el servicio. Revisa la conexión e intenta de nuevo.';
  if (error.code === '23505') return 'Ya existe un registro con ese nombre en este alcance.';
  if (error.code === '23503') return 'La categoría, producto u objetivo relacionado ya no existe o está protegido por el historial.';
  if (error.code === '23514') return 'Los datos no cumplen una regla del catálogo. Revisa el alcance, las cantidades y las fechas.';
  if (error.code === '22P02') return 'El formato de algún dato no es válido. Revisa los campos e inténtalo de nuevo.';
  if (error.code === 'VALIDATION_ERROR') return error.message;
  if (error.code === 'IMAGE_TOO_LARGE' || error.status === 413) return 'La imagen no puede superar 5 MB.';
  if (error.code === 'INVALID_IMAGE') return 'Selecciona una imagen JPG, PNG o WebP válida de hasta 5 MB.';
  if (error.code === 'STORAGE_FAILURE') return 'No se pudo guardar la imagen. Puedes reintentar sin perder el formulario.';
  if (error.status === 401) return 'La sesión expiró. Inicia sesión nuevamente.';
  if (error.status === 403 || error.code === '42501') return 'No tienes permisos para realizar este cambio.';
  if (error.status >= 500 || error.status === 0) return 'El servicio no está disponible. Puedes reintentar.';
  return 'No se pudo completar la operación. Revisa los datos e intenta de nuevo.';
}

export function createAdminCatalogService(
  client: HttpClient,
  getAccessToken: () => string | undefined,
  refreshAccessToken: () => Promise<string | null>,
): AdminCatalogService {
  const request = async <T>(resource: string, options: Parameters<HttpClient['request']>[1] = {}): Promise<T | null> => {
    const send = (accessToken: string | undefined) => client.request<T>(resource, { ...options, accessToken });
    try {
      return await send(getAccessToken());
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      const token = await refreshAccessToken().catch(() => null);
      if (!token) throw error;
      return send(token);
    }
  };
  const invoke = async <T>(functionName: string, body: FormData): Promise<T | null> => {
    const send = (accessToken: string | undefined) => client.invoke<T>(functionName, body, accessToken);
    try {
      return await send(getAccessToken());
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      const token = await refreshAccessToken().catch(() => null);
      if (!token) throw error;
      return send(token);
    }
  };
  const list = async <T>(resource: string, select: string, parse: (value: unknown) => T, signal?: AbortSignal) =>
    parseList(await request<unknown>(resource, { method: 'GET', query: { select, order: 'name.asc', limit: '200' }, signal }), resource, parse);
  return {
    async listCategories(signal) { return list('categories', CATEGORY_SELECT, parseCategory, signal); },
    async createCategory(input) {
      await request('categories', { method: 'POST', body: { name: requiredName(input.name), description: input.description?.trim() || null, active: input.active ?? true }, prefer: 'return=minimal' });
    },
    async updateCategory(id, input) {
      if (!UUID.test(id)) throw new ApiError(400, 'El identificador de categoría no es válido.', 'VALIDATION_ERROR');
      await request('categories', { method: 'PATCH', query: { id: `eq.${id}` }, body: { name: requiredName(input.name), description: input.description?.trim() || null, active: input.active ?? true }, prefer: 'return=minimal' });
    },
    async listProducts(signal) { return list('products', PRODUCT_SELECT, parseProduct, signal); },
    async createProduct(input) { await request('products', { method: 'POST', body: validateProduct(input), prefer: 'return=minimal' }); },
    async updateProduct(id, input) {
      if (!UUID.test(id)) throw new ApiError(400, 'El identificador de producto no es válido.', 'VALIDATION_ERROR');
      await request('products', { method: 'PATCH', query: { id: `eq.${id}` }, body: validateProduct(input), prefer: 'return=minimal' });
    },
    async uploadProductImage(file) {
      if (!(file instanceof File) || file.size <= 0 || file.size > MAX_PRODUCT_IMAGE_BYTES || !PRODUCT_IMAGE_TYPES.has(file.type)) {
        throw new ApiError(400, 'Selecciona una imagen JPG, PNG o WebP de hasta 5 MB.', 'VALIDATION_ERROR');
      }
      const form = new FormData();
      form.append('file', file);
      const result = await invoke<unknown>('product-image-upload', form);
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new ApiError(200, 'El servicio devolvió una respuesta no válida para la imagen.', 'INVALID_RESPONSE');
      }
      const imageUrl = (result as Record<string, unknown>).imageUrl;
      if (typeof imageUrl !== 'string') {
        throw new ApiError(200, 'El servicio devolvió una respuesta no válida para la imagen.', 'INVALID_RESPONSE');
      }
      try {
        const parsed = new URL(imageUrl);
        const validObjectPath = /^\/storage\/v1\/object\/public\/product-images\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(parsed.pathname);
        if (parsed.protocol !== 'https:' || !validObjectPath || parsed.search || parsed.hash) throw new Error('invalid URL');
      } catch {
        throw new ApiError(200, 'El servicio devolvió una URL de imagen no válida.', 'INVALID_RESPONSE');
      }
      return imageUrl;
    },
    async listPromotions(signal) { return list('promotions', PROMOTION_SELECT, parsePromotion, signal); },
    async createPromotion(input) { await request('promotions', { method: 'POST', body: validatePromotion(input), prefer: 'return=minimal' }); },
    async updatePromotion(id, input) {
      if (!UUID.test(id)) throw new ApiError(400, 'El identificador de promoción no es válido.', 'VALIDATION_ERROR');
      await request('promotions', { method: 'PATCH', query: { id: `eq.${id}` }, body: validatePromotion(input), prefer: 'return=minimal' });
    },
    async deactivatePromotion(id) {
      if (!UUID.test(id)) throw new ApiError(400, 'El identificador de promoción no es válido.', 'VALIDATION_ERROR');
      await request('promotions', { method: 'PATCH', query: { id: `eq.${id}` }, body: { active: false }, prefer: 'return=minimal' });
    },
  };
}
