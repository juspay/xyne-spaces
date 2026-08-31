import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * A KB document opened in the /ai page's right-side citation panel. Mirrors
 * xyne-search's citation "tabs", but we render up to two side-by-side instead
 * of one-at-a-time. `navSeq` bumps every time the same doc's citation is
 * re-clicked so the viewer re-jumps / re-highlights even when page/chunk are
 * unchanged.
 */
export interface CitationDoc {
  fileId: string;
  name: string;
  mimeType?: string;
  /** 1-based page to open on. */
  page?: number;
  /** 0-based chunk index → resolves the highlight snippet. */
  chunkIndex?: number;
  navSeq: number;
}

/** Everything needed to open a doc, minus the internally-managed `navSeq`. */
export type OpenDocInput = Omit<CitationDoc, 'navSeq'>;

/** Minimal shape of a resolved claw citation needed to open it in the panel. */
interface PanelCitationInput {
  kind?: string;
  collectionItemId?: string;
  fileName?: string;
  chunkIndex?: number;
}

/**
 * Returns the `openDoc` payload for a citation IF it's a KB PDF file (the only
 * thing the panel can render), else `null` so the caller falls back to normal
 * navigation. `page` is lifted off the citation's deep-link `?page=`.
 */
export function panelDocFromCitation(
  citation: PanelCitationInput | null | undefined,
  url: string | null | undefined,
): OpenDocInput | null {
  if (!citation || citation.kind !== 'collection-item') return null;
  const fileId = citation.collectionItemId;
  const name = citation.fileName;
  if (!fileId || !name || !/\.pdf$/i.test(name)) return null;
  const pageMatch = url ? /[?&]page=(\d+)/.exec(url) : null;
  return {
    fileId,
    name,
    ...(pageMatch ? { page: Number(pageMatch[1]) } : {}),
    ...(typeof citation.chunkIndex === 'number' ? { chunkIndex: citation.chunkIndex } : {}),
  };
}

interface CitationDocsContextValue {
  docs: CitationDoc[];
  /** The doc currently shown (one at a time). */
  activeFileId: string | null;
  openDoc: (doc: OpenDocInput) => void;
  setActive: (fileId: string) => void;
  closeDoc: (fileId: string) => void;
  closeAll: () => void;
}

const CitationDocsContext = createContext<CitationDocsContextValue | null>(null);

/** Max docs kept open as tabs (each stays mounted to preserve its state). */
const MAX_OPEN_DOCS = 6;

/**
 * Returns the citation-docs controller when rendered inside a
 * `CitationDocsProvider` (the /ai page), else `null` — callers use the null
 * case to fall back to normal navigation.
 */
export function useCitationDocs(): CitationDocsContextValue | null {
  return useContext(CitationDocsContext);
}

export function CitationDocsProvider({ children }: { children: ReactNode }): ReactElement {
  const [docs, setDocs] = useState<CitationDoc[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  const openDoc = useCallback((doc: OpenDocInput): void => {
    setActiveFileId(doc.fileId); // opening/clicking a citation focuses that doc
    setDocs(prev => {
      const existing = prev.find(d => d.fileId === doc.fileId);
      if (existing) {
        // Re-clicked an already-open doc: update its target + bump navSeq so the
        // viewer re-jumps/re-highlights.
        return prev.map(d =>
          d.fileId === doc.fileId ? { ...d, ...doc, navSeq: d.navSeq + 1 } : d,
        );
      }
      const next = [...prev, { ...doc, navSeq: 0 }];
      // Keep only the most-recent MAX_OPEN_DOCS (drop the oldest).
      return next.slice(-MAX_OPEN_DOCS);
    });
  }, []);

  const setActive = useCallback((fileId: string): void => setActiveFileId(fileId), []);

  const closeDoc = useCallback((fileId: string): void => {
    setDocs(prev => {
      const next = prev.filter(d => d.fileId !== fileId);
      setActiveFileId(cur => {
        if (cur !== fileId) return cur;
        // Closed the active tab → fall back to the last remaining doc.
        return next.length > 0 ? next[next.length - 1]!.fileId : null;
      });
      return next;
    });
  }, []);

  const closeAll = useCallback((): void => {
    setDocs([]);
    setActiveFileId(null);
  }, []);

  const value = useMemo(
    () => ({ docs, activeFileId, openDoc, setActive, closeDoc, closeAll }),
    [docs, activeFileId, openDoc, setActive, closeDoc, closeAll],
  );

  return <CitationDocsContext.Provider value={value}>{children}</CitationDocsContext.Provider>;
}
