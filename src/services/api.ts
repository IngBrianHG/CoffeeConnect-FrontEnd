import type { Category } from '../types/Category';
import type { Product } from '../types/Product';
import type { Order, OrderResponse } from '../types/Order';
import type { Promotion } from '../types/Promotion';
import type { Ingredient, RecipeLine } from '../types/Ingredient';

export interface User {
  id: number;
  username: string;
  role: string;
  active: number;
  created_at: string;
}

const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export interface Mesa {
  id: string;
  name: string;
  status: 'DISPONIBLE' | 'ASIGNADA' | 'OCUPADA' | 'NO_DISPONIBLE';
}

function getHeaders() {
  return { 'Content-Type': 'application/json' };
}

async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: { ...getHeaders(), ...options.headers },
    credentials: 'include'
  });
  if (!response.ok) {
    // Si el servidor explica el error (ej: validación de una promoción), usamos ese mensaje
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

function extractData<T>(response: unknown): T[] {
  if (Array.isArray(response)) return response as T[];
  if (response && typeof response === 'object' && 'data' in response) {
    const data = (response as { data: unknown }).data;
    if (Array.isArray(data)) return data as T[];
  }
  return [];
}

function convertPrice(price: unknown): number {
  if (price === undefined || price === null) return 0;
  const num = Number(price);
  return isNaN(num) ? 0 : num;
}

export async function fetchMesas(): Promise<Mesa[]> {
  const rawData = await apiFetch('/mesas');
  return extractData<Mesa>(rawData);
}

/** Kiosco (público): solo devuelve el nombre de SU mesa a partir del identificador del QR */
export async function fetchMesaPublic(mesa_id: string): Promise<Pick<Mesa, 'id' | 'name'> | null> {
  try {
    const raw = await apiFetch(`/mesas/${encodeURIComponent(mesa_id)}/public`);
    return (raw && typeof raw === 'object' && 'data' in raw) ? (raw as { data: Pick<Mesa, 'id' | 'name'> }).data : null;
  } catch {
    return null;
  }
}

export async function payTableOrders(mesa_id: string, payment_method: string) {
  return await apiFetch(`/pagos/mesa/${mesa_id}`, {
    method: 'POST',
    body: JSON.stringify({ payment_method })
  });
}

export async function fetchCategories(): Promise<Category[]> {
  const rawData = await apiFetch('/categories');
  return extractData<Category>(rawData);
}

export async function fetchProducts(): Promise<Product[]> {
  const rawData = await apiFetch('/products');
  return extractData<Product>(rawData).map(product => ({
    ...product,
    price: convertPrice(product.price),
  }));
}

export async function createOrder(order: Record<string, unknown>): Promise<OrderResponse> {
  const rawData = await apiFetch('/orders', {
    method: 'POST',
    body: JSON.stringify(order),
  });
  if (rawData && typeof rawData === 'object' && 'data' in rawData) {
    return (rawData as { data: OrderResponse }).data;
  }
  return rawData as OrderResponse;
}

export async function fetchOrders(): Promise<Order[]> {
  const data = await apiFetch('/orders');
  return extractData<Order>(data);
}

export async function fetchOrderById(id: number): Promise<Order> {
  return await apiFetch(`/orders/${id}`);
}

export async function fetchOrdersByMesa(mesa_id: string): Promise<Order[]> {
  const data = await apiFetch(`/orders/mesa/${mesa_id}`);
  return extractData<Order>(data);
}

export async function updateOrderStatus(id: number, status: string): Promise<Order> {
  const rawData = await apiFetch(`/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  if (rawData && typeof rawData === 'object' && 'data' in rawData) {
    return (rawData as { data: Order }).data;
  }
  return rawData as Order;
}

export async function updateProductStock(id: number, stock: number): Promise<void> {
  await apiFetch(`/products/${id}/stock`, {
    method: 'PATCH',
    body: JSON.stringify({ stock }),
  });
}

export async function createProduct(product: Record<string, unknown>): Promise<Product> {
  const rawData = await apiFetch('/products', {
    method: 'POST',
    body: JSON.stringify({ ...product, active: 1 }),
  });
  if (rawData && typeof rawData === 'object' && 'data' in rawData) {
    return (rawData as { data: Product }).data;
  }
  return rawData as Product;
}

export async function updateProduct(id: number, product: Record<string, unknown>): Promise<Product> {
  const rawData = await apiFetch(`/products/${id}`, {
    method: 'PUT',
    body: JSON.stringify(product),
  });
  if (rawData && typeof rawData === 'object' && 'data' in rawData) {
    return (rawData as { data: Product }).data;
  }
  return rawData as Product;
}

export async function deleteProduct(id: number) {
  return await apiFetch(`/products/${id}`, { method: 'DELETE' });
}

// ── Promociones ──
/** Promociones vigentes hoy (público: las ve el cliente) */
export async function fetchActivePromotions(): Promise<Promotion[]> {
  const rawData = await apiFetch('/promotions/active');
  return extractData<Promotion>(rawData);
}

/** Todas las promociones, incluso inactivas (solo admin) */
export async function fetchPromotions(): Promise<Promotion[]> {
  const rawData = await apiFetch('/promotions');
  return extractData<Promotion>(rawData);
}

export async function createPromotion(promo: Record<string, unknown>) {
  return await apiFetch('/promotions', { method: 'POST', body: JSON.stringify(promo) });
}

export async function updatePromotion(id: number, promo: Record<string, unknown>) {
  return await apiFetch(`/promotions/${id}`, { method: 'PUT', body: JSON.stringify(promo) });
}

export async function deletePromotion(id: number) {
  return await apiFetch(`/promotions/${id}`, { method: 'DELETE' });
}

// ── Inventario de ingredientes y recetas (solo admin) ──
export async function fetchIngredients(): Promise<Ingredient[]> {
  const rawData = await apiFetch('/ingredients');
  return extractData<Ingredient>(rawData);
}

export async function createIngredient(ingredient: { name: string; unit: string; stock: number; min_stock: number }) {
  return await apiFetch('/ingredients', { method: 'POST', body: JSON.stringify(ingredient) });
}

export async function updateIngredient(id: number, ingredient: { name: string; unit: string; min_stock: number }) {
  return await apiFetch(`/ingredients/${id}`, { method: 'PUT', body: JSON.stringify(ingredient) });
}

/** Fija el stock exacto (conteo físico) */
export async function setIngredientStock(id: number, stock: number) {
  return await apiFetch(`/ingredients/${id}/stock`, { method: 'PATCH', body: JSON.stringify({ stock }) });
}

/** Suma (reposición, +) o resta (merma, -) al stock actual */
export async function adjustIngredientStock(id: number, delta: number) {
  return await apiFetch(`/ingredients/${id}/stock`, { method: 'PATCH', body: JSON.stringify({ delta }) });
}

export async function deleteIngredient(id: number) {
  return await apiFetch(`/ingredients/${id}`, { method: 'DELETE' });
}

export async function fetchRecipe(productId: number): Promise<RecipeLine[]> {
  const rawData = await apiFetch(`/products/${productId}/recipe`);
  return extractData<RecipeLine>(rawData);
}

/** Reemplaza la receta completa. Lista vacía = quitar la receta (el producto vuelve a su stock propio) */
export async function saveRecipe(productId: number, ingredients: { ingredient_id: number; quantity: number }[]) {
  return await apiFetch(`/products/${productId}/recipe`, { method: 'PUT', body: JSON.stringify({ ingredients }) });
}

export interface ReportData {
  total_income: number | string;
  total_transactions: number | string;
  income_efectivo: number | string;
  income_tarjeta: number | string;
  income_transferencia: number | string;
  count_efectivo: number | string;
  count_tarjeta: number | string;
  count_transferencia: number | string;
  total_items_sold: number;
  items_breakdown: { product_name: string; total_qty: number | string; total_revenue: number | string }[];
}

export async function fetchReport(from?: string, to?: string): Promise<ReportData> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const rawData = await apiFetch(`/pagos/report?${params.toString()}`);
  if (rawData && typeof rawData === 'object' && 'data' in rawData) {
    return (rawData as { data: ReportData }).data;
  }
  return rawData as ReportData;
}

export async function fetchUsers(): Promise<User[]> {
  const data = await apiFetch('/users');
  return extractData<User>(data);
}

export async function createUser(userData: Record<string, unknown>): Promise<User> {
  const data = await apiFetch('/users', {
    method: 'POST',
    body: JSON.stringify(userData),
  });
  if (data && typeof data === 'object' && 'data' in data) {
    return (data as { data: User }).data;
  }
  return data as User;
}

export async function updateUser(id: number, userData: Record<string, unknown>): Promise<User> {
  const data = await apiFetch(`/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(userData),
  });
  if (data && typeof data === 'object' && 'data' in data) {
    return (data as { data: User }).data;
  }
  return data as User;
}

export async function deleteUser(id: number) {
  return await apiFetch(`/users/${id}`, { method: 'DELETE' });
}
