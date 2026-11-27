import { Search, X } from 'lucide-react';

interface SearchBarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
}

/**
 * SearchBar Component
 * Provides a search input to filter products by name
 */
export function SearchBar({ searchTerm, onSearchChange }: SearchBarProps) {
  return (
    <div className="search-bar" role="search">
      <div className="search-input-container">
        <span className="search-icon" aria-hidden="true"><Search size={18} /></span>
        <input
          type="text"
          className="search-input"
          aria-label="Buscar productos en el menú"
          placeholder="Buscar productos..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchTerm && (
          <button
            type="button"
            className="search-clear-btn"
            aria-label="Limpiar búsqueda"
            onClick={() => onSearchChange('')}
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
