import type { Category } from '../../types/Category';
import { CategoryIcon } from './categoryIcons';

interface SidebarProps {
  categories: Category[];
  selectedCategory: number | null;
  onSelectCategory: (categoryId: number | null) => void;
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
      <ul className="category-menu" aria-label="Categorías del menú">
        {/* Opción "Todos" */}
        <li className={`category-item ${selectedCategory === null ? 'active' : ''}`}>
          <button type="button" className="category-button" onClick={() => onSelectCategory(null)} aria-pressed={selectedCategory === null}>
            <span className="category-icon"><CategoryIcon name="Otros" /></span>
            <span className="category-name">Todos</span>
          </button>
        </li>

        {/* Categorías dinámicas */}
        {Array.from(new Set(categories.map(c => c.id))).map(id => {
          const category = categories.find(c => c.id === id);
          if (!category) return null;
          return (
            <li key={category.id} className={`category-item ${selectedCategory === category.id ? 'active' : ''}`}>
              <button type="button" className="category-button" onClick={() => onSelectCategory(category.id)} aria-pressed={selectedCategory === category.id}>
                <span className="category-icon"><CategoryIcon name={category.name} /></span>
                <span className="category-name">{category.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
