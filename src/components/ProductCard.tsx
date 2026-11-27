import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
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
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = product.image?.trim() || null;

  return (
    <div className={`product-card ${product.stock === 0 ? 'out-of-stock' : ''}`}>
      <div className={`product-image-container ${!imageUrl || imageFailed ? 'product-image-container-placeholder' : ''}`}>
        {promos.length > 0 && (
          <div className="product-promo-badges">
            {promos.map(p => (
              <span key={p.id} className="promo-badge" title={p.name}>{promoLabel(p)}</span>
            ))}
          </div>
        )}
        {imageUrl && !imageFailed
          ? <img src={imageUrl} alt={product.name || 'Producto'} className="product-image" onError={() => setImageFailed(true)} />
          : <div className="product-image-placeholder" role="img" aria-label={`Imagen no disponible para ${product.name || 'este producto'}`}>
            <Sparkles size={28} aria-hidden="true" />
            <span>Hecho con cariño</span>
          </div>}
      </div>
      <div className="product-info">
        <h3 className="product-name">{product.name || 'Unnamed Product'}</h3>
        <span className="product-availability">Disponible en el menú</span>

        <div className="product-footer">
          <span className="product-price">${formatPrice(product.price)}</span>
          <button
            type="button"
            className="add-to-cart-btn"
            onClick={() => onAddToCart(product)}
            aria-label={`Agregar ${product.name} al carrito`}
          >
            <Plus size={17} className="btn-icon" aria-hidden="true" />
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
