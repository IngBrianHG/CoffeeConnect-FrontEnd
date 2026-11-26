import { getProductImage } from '../utils/productImage';
import type { Product } from '../types/Product';
import type { Promotion } from '../types/Promotion';
import { promoLabel } from '../utils/promotions';

interface ProductCardProps {
  product: Product;
  onAddToCart: (product: Product) => void;
  /** Promociones vigentes que aplican a este producto (se muestra una etiqueta, ej: 2x1) */
  promos?: Promotion[];
}

function formatPrice(price: unknown): string {
  if (price === undefined || price === null) return '0.00';
  const num = Number(price);
  if (isNaN(num)) return '0.00';
  return num.toFixed(2);
}

export function ProductCard({ product, onAddToCart, promos = [] }: ProductCardProps) {
  // Stock es de solo lectura en la vista de cliente

const imageUrl = product.image && product.image.trim() !== ''
  ? product.image
  : getProductImage(product.name);

  return (
    <div className={`product-card ${product.stock === 0 ? 'out-of-stock' : ''}`}>
      <div className="product-image-container">
        {promos.length > 0 && (
          <div className="product-promo-badges">
            {promos.map(p => (
              <span key={p.id} className="promo-badge" title={p.name}>{promoLabel(p)}</span>
            ))}
          </div>
        )}
        <img
          src={imageUrl}
          alt={product.name || 'Product'}
          className="product-image"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=500&auto=format&fit=crop&q=80';
          }}
        />
      </div>
      <div className="product-info">
        <h3 className="product-name">{product.name || 'Unnamed Product'}</h3>

        {/* Control de stock - Solo lectura */}
        {(product.stock !== undefined && product.stock !== null) && (
          <div className="stock-display" style={{ fontSize: '0.85rem', color: product.stock > 0 ? '#388E3C' : '#D32F2F', fontWeight: '500', marginBottom: '0.5rem' }}>
            {product.stock > 0 ? `Stock disponible: ${product.stock}` : 'Agotado'}
          </div>
        )}

        <div className="product-footer">
          <span className="product-price">${formatPrice(product.price)}</span>
          <button
            className="add-to-cart-btn"
            onClick={() => onAddToCart(product)}
            disabled={product.stock === 0}
            style={{ opacity: product.stock === 0 ? 0.5 : 1, cursor: product.stock === 0 ? 'not-allowed' : 'pointer' }}
          >
            <span className="btn-icon">+</span>
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
