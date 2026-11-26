import type { Category } from '../../types/Category';
import { Coffee, IceCreamCone, Cake, Sandwich, UtensilsCrossed } from 'lucide-react';

interface SidebarProps {
  categories: Category[];
  selectedCategory: number | null;
  onSelectCategory: (categoryId: number | null) => void;
}

function getCategoryIcon(categoryName: string) {
  const name = categoryName.toLowerCase();
  if (name.includes('pastel') || name.includes('tarta')) return <Cake size={18} />;
  if (name.includes('postre') || name.includes('dulce') || name.includes('mousse') || name.includes('cheesecake')) return <Cake size={18} />;
  if (name.includes('repostería') || name.includes('hojaldre') || name.includes('pan') || name.includes('snack') || name.includes('sandwich')) return <Sandwich size={18} />;
  if (name.includes('caliente') || name.includes('café') || name.includes('bebida') || name.includes('té')) return <Coffee size={18} />;
  if (name.includes('fría') || name.includes('frappé') || name.includes('helado')) return <IceCreamCone size={18} />;
  return <UtensilsCrossed size={18} />;
}

/**
 * Sidebar - Lista de categorías fija
 * Extraído de CategoryList, vive dentro de KioskLayout.
 */
export function Sidebar({ categories, selectedCategory, onSelectCategory }: SidebarProps) {
  return (
    <div className="category-list">
      <div className="sidebar-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem', paddingBottom: '1.25rem', marginBottom: '1.25rem' }}>
        <img 
          src="/turron-logo.jpg" 
          alt="TURRÓN Pastelería" 
          style={{ width: '70px', height: '70px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #E0247D', background: '#fff', boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }} 
        />
        <div style={{ textAlign: 'center' }}>
          <h2 className="kiosk-title" style={{ fontSize: '1.4rem', margin: 0, fontWeight: '800' }}>TURRÓN</h2>
          <p className="kiosk-subtitle" style={{ margin: 0, color: '#FF80BF', fontSize: '0.75rem', fontWeight: '700', letterSpacing: '2px' }}>PASTELERÍA</p>
        </div>
      </div>

      <h3 className="category-title">Categorías</h3>
      <ul className="category-menu">
        {/* Opción "Todos" */}
        <li
          className={`category-item ${selectedCategory === null ? 'active' : ''}`}
          onClick={() => onSelectCategory(null)}
        >
          <span className="category-icon"><Cake size={18} /></span>
          <span className="category-name">Todos</span>
        </li>

        {/* Categorías dinámicas */}
        {Array.from(new Set(categories.map(c => c.id))).map(id => {
          const category = categories.find(c => c.id === id);
          if (!category) return null;
          return (
            <li
              key={category.id}
              className={`category-item ${selectedCategory === category.id ? 'active' : ''}`}
              onClick={() => onSelectCategory(category.id)}
            >
              <span className="category-icon">{getCategoryIcon(category.name)}</span>
              <span className="category-name">{category.name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}