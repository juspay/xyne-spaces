import { useEffect } from 'react';
import { useSearch } from '../../hooks/useSearch';
import type { SearchResult } from '@xyne/spaces-sdk';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onResults: (results: SearchResult[]) => void;
  onSearching: (isSearching: boolean) => void;
}

export function SearchBar({ value, onChange, onResults, onSearching }: SearchBarProps) {
  const { results, isLoading, search, clear } = useSearch({ debounceMs: 300 });

  // Sync search results to parent
  useEffect(() => {
    onResults(results);
  }, [results, onResults]);

  // Sync loading state to parent
  useEffect(() => {
    onSearching(isLoading);
  }, [isLoading, onSearching]);

  // Trigger search when value changes
  useEffect(() => {
    if (value.trim()) {
      search(value);
    } else {
      clear();
    }
  }, [value, search, clear]);

  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        {isLoading ? (
          <div className="animate-spin h-4 w-4 border-2 border-xyne-500 border-t-transparent rounded-full" />
        ) : (
          <svg
            className="h-4 w-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        )}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search messages, tickets, files..."
        className="block w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-xyne-500 focus:border-transparent"
        autoFocus
      />
      {value && (
        <button
          onClick={() => {
            onChange('');
            clear();
          }}
          className="absolute inset-y-0 right-0 pr-3 flex items-center"
        >
          <svg
            className="h-4 w-4 text-gray-400 hover:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
