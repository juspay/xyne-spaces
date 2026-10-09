import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { setAskAIAuto } from './useAskAIAuto';

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
/** An explicit "no agent" pick — Auto or Ask AI — which the default must not override. */
const CHOICE_KEY = 'xyne-ai-agent-choice';

/** The agent a chat starts with when the account has it; Auto otherwise. */
export const DEFAULT_AGENT_SLUG = 'xyne';

type NoAgentChoice = 'auto' | 'ask-ai';

function readChoice(): NoAgentChoice | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    return raw === 'auto' || raw === 'ask-ai' ? raw : null;
  } catch {
    return null;
  }
}

function writeChoice(choice: NoAgentChoice | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (choice) localStorage.setItem(CHOICE_KEY, choice);
    else localStorage.removeItem(CHOICE_KEY);
  } catch {
    // ignore storage errors
  }
}

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
  window.history.replaceState(window.history.state, '', url.toString());
}

// ── Module-level store ──────────────────────────────────────────────────────
// A single shared value + subscriber set. `useSyncExternalStore` wires every
// hook instance to this, so a change anywhere fans out to all consumers.
let currentSlug: string | null = readUrlAgent() ?? readStorageAgent() ?? null;
/** The default agent, once resolved — what "nothing stored" means this load. */
let defaultSlug: string | null = null;

const resolveSlug = (): string | null => readUrlAgent() ?? readStorageAgent() ?? defaultSlug;
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
  // Picking an agent forgets an earlier explicit Auto / Ask AI; clearing the
  // agent is itself a choice, so the default no longer stands in for it.
  if (normalized !== null) writeChoice(null);
  else defaultSlug = null;
  if (normalized === currentSlug) return;
  currentSlug = normalized;
  writeStorageAgent(normalized);
  writeUrlAgent(normalized);
  emit();
}

/**
 * Remember that the user chose Auto or Ask AI themselves, so the next load
 * keeps it instead of opening the default agent.
 */
export function rememberNoAgentChoice(choice: NoAgentChoice): void {
  writeChoice(choice);
}

// The default is applied once per load, after the agent list arrives.
let defaultResolved = false;

/**
 * Open new chats with the default agent ("xyne") when the account has it,
 * else Auto. Runs once the accessible-agents list has loaded and only when
 * nothing else decided: no ?agent= in the URL, no stored pick, no explicit
 * Auto / Ask AI choice. A stored pick for an agent that no longer exists is
 * dropped, so the composer never keeps sending a dead slug. The default is
 * not persisted — it is re-derived each load, so removing the agent later
 * falls back to Auto on its own.
 */
export function useDefaultAgent(agents: ReadonlyArray<{ slug: string }> | undefined): void {
  useEffect(() => {
    if (!agents || agents.length === 0 || defaultResolved) return;
    defaultResolved = true;
    const known = new Set(agents.map(agent => agent.slug));
    // Only a stored pick goes stale; an ?agent= link is someone's explicit ask.
    if (currentSlug !== null && !known.has(currentSlug) && readUrlAgent() === null) {
      currentSlug = null;
      writeStorageAgent(null);
      writeUrlAgent(null);
      emit();
    }
    if (currentSlug !== null) return;
    const choice = readChoice();
    if (choice === 'ask-ai') {
      setAskAIAuto(false);
      return;
    }
    if (choice === 'auto' || !known.has(DEFAULT_AGENT_SLUG)) return;
    defaultSlug = DEFAULT_AGENT_SLUG;
    currentSlug = DEFAULT_AGENT_SLUG;
    emit();
  }, [agents]);
}

// Keep the store in sync with browser navigation (back/forward button).
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const next = resolveSlug();
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
 * Default: the default agent once `useDefaultAgent` resolves it, else `null`
 * (Ask AI / Auto). Persisted to localStorage and URL, and shared across all
 * consumers via a module-level store.
 */
export function useSelectedAgent(): UseSelectedAgentReturn {
  const selectedAgentSlug = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setSelectedAgentSlug = useCallback((slug: string | null) => {
    setSelectedAgentSlugStore(slug);
  }, []);

  // On first mount, reconcile the store with the current URL/localStorage in
  // case they changed outside a popstate (e.g. a hard navigation into the page).
  useEffect(() => {
    const next = resolveSlug();
    if (next !== currentSlug) {
      currentSlug = next;
      emit();
    }
  }, []);

  return { selectedAgentSlug, setSelectedAgentSlug };
}
