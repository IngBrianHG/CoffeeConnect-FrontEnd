import React from 'react';
import type { Category } from '../../types/Category';
import { Sidebar } from './Sidebar';
import { Coffee, IceCreamCone, Cake, Sandwich, UtensilsCrossed } from 'lucide-react';

interface KioskLayoutProps {
  categories: Category[];
  selectedCategory: number | null;
  onSelectCategory: (id: number | null) => void;
  children: React.ReactNode;
}

function getCategoryIcon(categoryName: string) {
  const name = categoryName.toLowerCase();
  if (name.includes('pastel') || name.includes('tarta')) return <Cake size={14} />;
  if (name.includes('postre') || name.includes('dulce') || name.includes('mousse') || name.includes('cheesecake')) return <Cake size={14} />;
  if (name.includes('repostería') || name.includes('hojaldre') || name.includes('pan') || name.includes('snack') || name.includes('sandwich')) return <Sandwich size={14} />;
  if (name.includes('caliente') || name.includes('café') || name.includes('bebida') || name.includes('té')) return <Coffee size={14} />;
  if (name.includes('fría') || name.includes('frappé') || name.includes('helado')) return <IceCreamCone size={14} />;
  return <UtensilsCrossed size={14} />;
}

/**
 * KioskLayout - Wrapper de layout responsive
 * Desktop: Header + Sidebar fijo + contenido central
 * Mobile: Header + categorías horizontales + contenido full width
 */
export function KioskLayout({
  categories,
  selectedCategory,
  onSelectCategory,
  children,
}: KioskLayoutProps) {
  return (
    <div className="kiosk-wrapper">
      {/* Header fijo */}
      <header className="kiosk-header">
        <div className="header-content">
          <img src="/turron-logo.jpg" alt="TURRÓN Pastelería" className="logo" style={{ borderRadius: '50%', objectFit: 'cover', border: '2px solid #E0247D', background: '#fff' }} />
          <h1 className="business-title">TURRÓN PASTELERÍA</h1>
        </div>
      </header>

      {/* Mobile category chips — visible solo en mobile */}
      <div className="mobile-category-bar">
        <div className="mobile-category-scroll">
          <button
            className={`mobile-category-chip ${selectedCategory === null ? 'active' : ''}`}
            onClick={() => onSelectCategory(null)}
          >
            <Cake size={14} />
            <span>Todos</span>
          </button>
          {Array.from(new Set(categories.map(c => c.id))).map(id => {
            const category = categories.find(c => c.id === id);
            if (!category) return null;
            return (
              <button
                key={category.id}
                className={`mobile-category-chip ${selectedCategory === category.id ? 'active' : ''}`}
                onClick={() => onSelectCategory(category.id)}
              >
                {getCategoryIcon(category.name)}
                <span>{category.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cuerpo: sidebar + contenido */}
      <div className="kiosk-body">
        {/* Sidebar izquierdo - FIJO (solo desktop) */}
        <aside className="kiosk-sidebar">
          <Sidebar
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={onSelectCategory}
          />
        </aside>

        {/* Contenido central - HACE SCROLL */}
        <div className="kiosk-content">
          {children}
        </div>
      </div>
    </div>
  );
}