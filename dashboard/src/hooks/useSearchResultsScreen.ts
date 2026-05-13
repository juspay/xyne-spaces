import { useCallback, useEffect, useRef, useState } from 'react';
import { searchService } from '../services/searchService';
import { DisplaySearchResult, VespaSearchFilters } from '../types/search';
import {
  VespaApps,
  VespaDocTypes,
} from '../components/Chat/ChatDirectory/ChannelCommandMenu.types';

const PAGE_SIZE = 10;
const APPS = Object.values(VespaApps).join(',');
const TYPES = [VespaDocTypes.MESSAGES, VespaDocTypes.FILES, VespaDocTypes.TICKETS].join(',');

interface UseSearchResultsScreenResult {
  results: DisplaySearchResult[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  isLoading: boolean;
  error: string | null;
  goToPage: (page: number) => void;
}

export function useSearchResultsScreen(query: string): UseSearchResultsScreenResult {
  const [results, setResults] = useState<DisplaySearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const trimmed = query.trim();
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const fetchPage = useCallback((page: number, q: string) => {
    const reqId = ++requestIdRef.current;
    setCurrentPage(page);
    setIsLoading(true);
    setError(null);

    const filters: VespaSearchFilters = {
      query: q,
      apps: APPS,
      type: TYPES,
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      presentationSummary: 'lean',
      groupBy: '',
    };

    searchService
      .vespaSearch(filters)
      .then(response => {
        if (reqId !== requestIdRef.current) return;
        setResults(response.results);
        setTotalCount(response.totalCount);
        setIsLoading(false);
      })
      .catch(err => {
        if (reqId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
        setTotalCount(0);
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!trimmed) {
      requestIdRef.current += 1;
      setResults([]);
      setTotalCount(0);
      setCurrentPage(1);
      setError(null);
      setIsLoading(false);
      return;
    }
    fetchPage(1, trimmed);
  }, [trimmed, fetchPage]);

  const goToPage = useCallback(
    (page: number) => {
      if (!trimmed) return;
      const clamped = Math.max(1, Math.min(page, totalPages));
      if (clamped === currentPage) return;
      fetchPage(clamped, trimmed);
    },
    [trimmed, totalPages, currentPage, fetchPage],
  );

  return {
    results,
    totalCount,
    totalPages,
    currentPage,
    isLoading,
    error,
    goToPage,
  };
}
