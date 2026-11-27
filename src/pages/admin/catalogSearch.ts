import type { AdminCategory, AdminProduct } from '../../services/adminCatalog';

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-SV');
}

export function filterAdminProducts(
  products: AdminProduct[],
  categories: AdminCategory[],
  searchTerm: string,
): AdminProduct[] {
  const query = normalizeSearchText(searchTerm.trim());
  if (!query) return products;

  const categoryNames = new Map(categories.map(category => [category.id, category.name]));
  return products.filter(product => [
    product.name,
    product.description ?? '',
    categoryNames.get(product.categoryId) ?? '',
  ].some(value => normalizeSearchText(value).includes(query)));
}
