import React from 'react';
import { CircleHelp, RefreshCw } from 'lucide-react';
import type { Category } from '../../types/Category';
import { Sidebar } from './Sidebar';
import { CategoryIcon } from './categoryIcons';

interface KioskLayoutProps {
  categories: Category[];
  selectedCategory: number | null;
  onSelectCategory: (id: number | null) => void;
  mesaName: string;
  onRefresh: () => void;
  isRefreshing: boolean;
  children: React.ReactNode;
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
  mesaName,
  onRefresh,
  isRefreshing,
  children,
}: KioskLayoutProps) {
  return (
    <div className="kiosk-wrapper">
      {/* Header fijo */}
      <header className="kiosk-header">
        <div className="header-content">
          <img src="/turron-logo.jpg" alt="" className="logo" />
          <div className="kiosk-brand">
            <h1 className="business-title">TURRÓN <span>Pastelería</span></h1>
            <span className="kiosk-table-label">Mesa <strong>{mesaName}</strong></span>
          </div>
          <a className="kiosk-help-link" href="#kiosk-help">
            <CircleHelp size={17} aria-hidden="true" />
            <span>Ayuda</span>
          </a>
          <button type="button" className="kiosk-refresh-button" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCw size={17} className={isRefreshing ? 'kiosk-refresh-spin' : ''} />
            <span>{isRefreshing ? 'Actualizando' : 'Actualizar menú'}</span>
          </button>
        </div>
      </header>

      <nav className="mobile-category-bar" aria-label="Filtrar por categoría">
        <div className="mobile-category-scroll">
          <button
            type="button"
            className={`mobile-category-chip ${selectedCategory === null ? 'active' : ''}`}
            onClick={() => onSelectCategory(null)}
            aria-pressed={selectedCategory === null}
          >
            <CategoryIcon name="Otros" size={14} />
            <span>Todos</span>
          </button>
          {Array.from(new Set(categories.map(c => c.id))).map(id => {
            const category = categories.find(c => c.id === id);
            if (!category) return null;
            return (
              <button
                type="button"
                key={category.id}
                className={`mobile-category-chip ${selectedCategory === category.id ? 'active' : ''}`}
                onClick={() => onSelectCategory(category.id)}
                aria-pressed={selectedCategory === category.id}
              >
                <CategoryIcon name={category.name} size={14} />
                <span>{category.name}</span>
              </button>
            );
          })}
        </div>
      </nav>

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
