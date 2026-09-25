import {
  createContext,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface PageSelectionPayload {
  text: string;
  url: string;
  title: string;
  provider?: string;
  /** What the reader wants done with the passage. */
  intent?: 'ask' | 'edit';
}

interface PageSelectionContextValue {
  selection: PageSelectionPayload | null;
  setSelection: (selection: PageSelectionPayload | null) => void;
  clearSelection: () => void;
  /** Reads the current pick synchronously, for a send in the same tick. */
  readSelection: () => PageSelectionPayload | null;
  /** Sends a turn straight from the workspace, carrying the pending selection. */
  submitPrompt?: ((text: string) => boolean) | undefined;
}

import { registerSelectionSink } from '../../workspaceItems';

const PageSelectionContext = createContext<PageSelectionContextValue | null>(null);

export function usePageSelection(): PageSelectionContextValue | null {
  return useContext(PageSelectionContext);
}

export function PageSelectionProvider({
  children,
  submitPrompt,
}: {
  children: ReactNode;
  submitPrompt?: ((text: string) => boolean) | undefined;
}): ReactElement {
  const [selection, setSelectionState] = useState<PageSelectionPayload | null>(null);
  const latest = useRef<PageSelectionPayload | null>(null);

  const setSelection = useCallback((next: PageSelectionPayload | null) => {
    latest.current = next;
    setSelectionState(next);
  }, []);
  const clearSelection = useCallback(() => setSelection(null), [setSelection]);
  const readSelection = useCallback(() => latest.current, []);

  // The shared annotator sends a picked passage to whatever this surface has
  // registered; here that is the composer below the thread.
  useEffect(() => {
    registerSelectionSink('ai-artifact', {
      send: ({ question, ...passage }) => {
        setSelection(passage);
        if (question) submitPrompt?.(question);
      },
    });
  }, [setSelection, submitPrompt]);

  const value = useMemo(
    () => ({ selection, setSelection, clearSelection, readSelection, submitPrompt }),
    [selection, setSelection, clearSelection, readSelection, submitPrompt],
  );
  return <PageSelectionContext.Provider value={value}>{children}</PageSelectionContext.Provider>;
}
