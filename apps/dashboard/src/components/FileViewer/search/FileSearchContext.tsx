import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DEFAULT_SEARCH_OPTIONS, type SearchOptions } from './types';

/**
 * A viewer that owns its own match navigation (the PDF viewer, which delegates
 * to pdf.js's find controller) registers one of these. While registered, the
 * context's next/prev call it instead of stepping activeIndex, and the viewer
 * reports the current index + total back via reportMatchState.
 */
export interface SearchNavigator {
  next: () => void;
  prev: () => void;
}

interface FileSearchContextValue {
  isOpen: boolean;
  query: string;
  options: SearchOptions;
  activeIndex: number;
  total: number;
  /** True while a searchable viewer is mounted — drives find bar visibility. */
  hasTarget: boolean;
  /** Bumped on every mod+f so the find bar can refocus/select an open input. */
  focusSignal: number;
  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  setOptions: (options: Partial<SearchOptions>) => void;
  next: () => void;
  prev: () => void;
  reportTotal: (total: number) => void;
  registerTarget: () => () => void;
  /** For viewers that own navigation (PDF): take over next/prev while mounted. */
  registerNavigator: (navigator: SearchNavigator) => () => void;
  /** Set both current index and total at once (PDF gets these from pdf.js). */
  reportMatchState: (current: number, total: number) => void;
}

const FileSearchContext = createContext<FileSearchContextValue | null>(null);

interface FileSearchProviderProps {
  children: React.ReactNode;
  /**
   * Changing this resets the search — used to clear state when the user
   * navigates to a different file in the carousel.
   */
  resetKey?: string;
}

export const FileSearchProvider: React.FC<FileSearchProviderProps> = ({ children, resetKey }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [options, setOptionsState] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [targetCount, setTargetCount] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);

  // `total` is needed by next/prev, but reading it from state would rebuild
  // those callbacks on every match-count change and re-register the shortcuts.
  const totalRef = useRef(0);
  totalRef.current = total;

  // A viewer that owns its own navigation (PDF). When set, next/prev delegate.
  const navigatorRef = useRef<SearchNavigator | null>(null);

  useEffect(() => {
    setIsOpen(false);
    setQueryState('');
    setActiveIndex(0);
    setTotal(0);
  }, [resetKey]);

  const open = useCallback((): void => {
    setIsOpen(true);
    setFocusSignal(signal => signal + 1);
  }, []);

  const close = useCallback((): void => {
    setIsOpen(false);
    setQueryState('');
    setActiveIndex(0);
    setTotal(0);
  }, []);

  const setQuery = useCallback((next: string): void => {
    setQueryState(next);
    setActiveIndex(0);
  }, []);

  const setOptions = useCallback((partial: Partial<SearchOptions>): void => {
    setOptionsState(prev => ({ ...prev, ...partial }));
    setActiveIndex(0);
  }, []);

  const next = useCallback((): void => {
    if (navigatorRef.current) {
      navigatorRef.current.next();
      return;
    }
    const count = totalRef.current;
    if (count === 0) return;
    setActiveIndex(index => (index + 1) % count);
  }, []);

  const prev = useCallback((): void => {
    if (navigatorRef.current) {
      navigatorRef.current.prev();
      return;
    }
    const count = totalRef.current;
    if (count === 0) return;
    setActiveIndex(index => (index - 1 + count) % count);
  }, []);

  const reportTotal = useCallback((nextTotal: number): void => {
    setTotal(nextTotal);
    setActiveIndex(index => (index >= nextTotal ? 0 : index));
  }, []);

  const reportMatchState = useCallback((current: number, nextTotal: number): void => {
    setTotal(nextTotal);
    setActiveIndex(current < 0 ? 0 : current);
  }, []);

  const registerTarget = useCallback((): (() => void) => {
    setTargetCount(count => count + 1);
    return () => setTargetCount(count => count - 1);
  }, []);

  const registerNavigator = useCallback((navigator: SearchNavigator): (() => void) => {
    navigatorRef.current = navigator;
    return () => {
      if (navigatorRef.current === navigator) navigatorRef.current = null;
    };
  }, []);

  const value = useMemo<FileSearchContextValue>(
    () => ({
      isOpen,
      query,
      options,
      activeIndex,
      total,
      hasTarget: targetCount > 0,
      focusSignal,
      open,
      close,
      setQuery,
      setOptions,
      next,
      prev,
      reportTotal,
      registerTarget,
      registerNavigator,
      reportMatchState,
    }),
    [
      isOpen,
      query,
      options,
      activeIndex,
      total,
      targetCount,
      focusSignal,
      open,
      close,
      setQuery,
      setOptions,
      next,
      prev,
      reportTotal,
      registerTarget,
      registerNavigator,
      reportMatchState,
    ],
  );

  return <FileSearchContext.Provider value={value}>{children}</FileSearchContext.Provider>;
};

/**
 * Returns null outside a provider. Viewers are also rendered on surfaces that
 * don't offer search (citation previews, knowledge base), so search support has
 * to degrade to a no-op rather than throw.
 */
export const useFileSearchContext = (): FileSearchContextValue | null =>
  useContext(FileSearchContext);
