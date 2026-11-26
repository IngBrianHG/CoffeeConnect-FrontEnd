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
    <div className="search-bar">
      <div className="search-input-container">
        <span className="search-icon"><Search size={18} /></span>
        <input
          type="text"
          className="search-input"
          placeholder="Buscar productos..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchTerm && (
          <button 
            className="search-clear-btn"
            onClick={() => onSearchChange('')}
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
