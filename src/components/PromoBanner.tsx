import { Gift } from 'lucide-react';
import type { Promotion } from '../types/Promotion';
import { promoLabel, promoScopeName } from '../utils/promotions';

/** Franja con las ofertas vigentes, visible arriba del menú */
export function PromoBanner({ promotions }: { promotions: Promotion[] }) {
  if (promotions.length === 0) return null;

  return (
    <div className="promo-banner">
      <div className="promo-banner-title"><Gift size={18} /> Ofertas de hoy</div>
      <div className="promo-banner-list">
        {promotions.map(p => (
          <div key={p.id} className="promo-banner-item">
            <span className="promo-badge">{promoLabel(p)}</span>
            <span className="promo-banner-text">
              <strong>{p.name}</strong>
              <small>
                {p.description || `En ${promoScopeName(p)}`}
                {p.end_date ? ` · hasta el ${p.end_date.split('-').reverse().join('/')}` : ''}
              </small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
