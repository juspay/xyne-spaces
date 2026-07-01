import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Hook to manage the currently selected claw agent (sidebar/standalone scope).
 * - Persists to localStorage so selection survives refresh.
 * - Syncs to URL query param ?agent=<slug> for shareability and deep linking.
 * - The "ask-ai" default lives in the legacy Ask AI tab; any other slug activates
 *   the standalone single-agent view.
 *
 * Backed by a single module-level store (not per-component `useState`) so every
 * consumer — the composer's agent picker, the history sidebar, the chat thread —
 * observes the same value. Changing the agent in one place immediately updates
 * the others (e.g. the history list re-scopes to the newly-selected agent).
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

// ── Module-level store ──────────────────────────────────────────────────────
// A single shared value + subscriber set. `useSyncExternalStore` wires every
// hook instance to this, so a change anywhere fans out to all consumers.
let currentSlug: string | null = readUrlAgent() ?? readStorageAgent() ?? null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | null {
  return currentSlug;
}

function setSelectedAgentSlugStore(slug: string | null): void {
  const normalized = slug === 'ask-ai' ? null : slug;
  if (normalized === currentSlug) return;
  currentSlug = normalized;
  writeStorageAgent(normalized);
  writeUrlAgent(normalized);
  emit();
}

// Keep the store in sync with browser navigation (back/forward button).
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const next = readUrlAgent() ?? readStorageAgent() ?? null;
    if (next !== currentSlug) {
      currentSlug = next;
      emit();
    }
  });
}

export interface UseSelectedAgentReturn {
  /** Currently selected agent slug. `null` means the legacy Ask AI tab is active. */
  selectedAgentSlug: string | null;
  /** Change the selected agent. Pass `null` to switch to the Ask AI tab. */
  setSelectedAgentSlug: (slug: string | null) => void;
}

/**
 * Returns the currently selected agent slug and a setter.
 * Default: `null` (legacy Ask AI tab). Persisted to localStorage and URL, and
 * shared across all consumers via a module-level store.
 */
export function useSelectedAgent(): UseSelectedAgentReturn {
  const selectedAgentSlug = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setSelectedAgentSlug = useCallback((slug: string | null) => {
    setSelectedAgentSlugStore(slug);
  }, []);

  // On first mount, reconcile the store with the current URL/localStorage in
  // case they changed outside a popstate (e.g. a hard navigation into the page).
  useEffect(() => {
    const next = readUrlAgent() ?? readStorageAgent() ?? null;
    if (next !== currentSlug) {
      currentSlug = next;
      emit();
    }
  }, []);

  return { selectedAgentSlug, setSelectedAgentSlug };
}
