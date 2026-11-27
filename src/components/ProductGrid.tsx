import type { Product } from '../types/Product';
import type { Promotion } from '../types/Promotion';
import { ProductCard } from './ProductCard';
import { getProductPromos } from '../utils/promotions';
import { SearchX } from 'lucide-react';

interface ProductGridProps {
  products: Product[];
  onAddToCart: (product: Product) => void;
  promotions?: Promotion[];
}

/**
 * ProductGrid Component
 * Displays a grid of product cards
 * Defensive: handles undefined or non-array products
 */
export function ProductGrid({ products, onAddToCart, promotions = [] }: ProductGridProps) {
  // Defensive: ensure products is always an array
  const safeProducts = Array.isArray(products) ? products : [];
  
  if (safeProducts.length === 0) {
    return (
        <div className="product-grid-empty" role="status">
          <div className="empty-icon"><SearchX size={32} aria-hidden="true" /></div>
          <p className="empty-message">No encontramos productos</p>
          <p className="empty-submessage">Prueba otra búsqueda o selecciona una categoría diferente.</p>
      </div>
    );
  }

  return (
    <div className="product-grid">
      {safeProducts.map((product) => (
        <ProductCard 
          key={product?.id} 
          product={product} 
          onAddToCart={onAddToCart}
          promos={getProductPromos(product, promotions)}
        />
      ))}
    </div>
  );
}
