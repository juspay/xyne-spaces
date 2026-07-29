import { useState, useMemo } from 'react';

interface UseSearchFilterOptions<T> {
  items: readonly T[];
  searchKeys: (keyof T)[];
  nestedSearchKeys?: {
    arrayKey: keyof T;
    searchKeys: string[];
  }[];
}

interface UseSearchFilterReturn<T> {
  isSearchOpen: boolean;
  searchQuery: string;
  filteredItems: readonly T[];
  openSearch: () => void;
  closeSearch: () => void;
  setSearchQuery: (query: string) => void;
}

export function useSearchFilter<T>({
  items,
  searchKeys,
  nestedSearchKeys = [],
}: UseSearchFilterOptions<T>): UseSearchFilterReturn<T> {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;

    const lowerQuery = searchQuery.toLowerCase();

    return items.filter(item => {
      // Check direct string fields
      const matchesDirect = searchKeys.some(key => {
        const value = item[key];
        if (typeof value === 'string') {
          return value.toLowerCase().includes(lowerQuery);
        }
        return false;
      });

      if (matchesDirect) return true;

      // Check nested array fields
      const matchesNested = nestedSearchKeys.some(({ arrayKey, searchKeys: nestedKeys }) => {
        const arrayValue = item[arrayKey];
        if (Array.isArray(arrayValue)) {
          return arrayValue.some(nestedItem => {
            // Type guard: ensure nestedItem is an object
            if (typeof nestedItem !== 'object' || nestedItem === null) {
              return false;
            }

            return nestedKeys.some(nestedKey => {
              // Safely access the nested property
              const nestedValue = (nestedItem as Record<string, unknown>)[nestedKey];
              if (typeof nestedValue === 'string') {
                return nestedValue.toLowerCase().includes(lowerQuery);
              }
              return false;
            });
          });
        }
        return false;
      });

      return matchesNested;
    });
  }, [items, searchQuery, searchKeys, nestedSearchKeys]);

  const openSearch = () => setIsSearchOpen(true);

  const closeSearch = () => {
    setIsSearchOpen(false);
    setSearchQuery('');
  };

  return {
    isSearchOpen,
    searchQuery,
    filteredItems,
    openSearch,
    closeSearch,
    setSearchQuery,
  };
}
