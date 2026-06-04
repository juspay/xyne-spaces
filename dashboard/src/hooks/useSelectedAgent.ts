import { useState, useCallback, useEffect } from 'react';

/**
 * Hook to manage the currently selected claw agent (sidebar/standalone scope).
 * - Persists to localStorage so selection survives refresh.
 * - Syncs to URL query param ?agent=<slug> for shareability and deep linking.
 * - The "ask-ai" default lives in the legacy Ask AI tab; any other slug activates
 *   the standalone single-agent view.
 */
const STORAGE_KEY = 'xyne-ai-selected-agent';

function readUrlAgent(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('agent');
}

function readStorageAgent(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorageAgent(slug: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (slug && slug !== 'ask-ai') {
      localStorage.setItem(STORAGE_KEY, slug);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function writeUrlAgent(slug: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (slug && slug !== 'ask-ai') {
    url.searchParams.set('agent', slug);
  } else {
    url.searchParams.delete('agent');
  }
  window.history.replaceState({}, '', url.toString());
}

export interface UseSelectedAgentReturn {
  /** Currently selected agent slug. `null` means the legacy Ask AI tab is active. */
  selectedAgentSlug: string | null;
  /** Change the selected agent. Pass `null` to switch to the Ask AI tab. */
  setSelectedAgentSlug: (slug: string | null) => void;
}

/**
 * Returns the currently selected agent slug and a setter.
 * Default: `null` (legacy Ask AI tab). Persisted to localStorage and URL.
 */
export function useSelectedAgent(): UseSelectedAgentReturn {
  // Initialise from URL first, then localStorage, then default to null.
  const [selectedAgentSlug, setSelectedAgentSlugState] = useState<string | null>(() => {
    return readUrlAgent() ?? readStorageAgent() ?? null;
  });

  const setSelectedAgentSlug = useCallback((slug: string | null) => {
    const normalized = slug === 'ask-ai' ? null : slug;
    setSelectedAgentSlugState(normalized);
    writeStorageAgent(normalized);
    writeUrlAgent(normalized);
  }, []);

  // Listen for URL changes (e.g. back button)
  useEffect(() => {
    const handlePopState = () => {
      const urlSlug = readUrlAgent();
      setSelectedAgentSlugState(urlSlug ?? readStorageAgent() ?? null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return { selectedAgentSlug, setSelectedAgentSlug };
}
