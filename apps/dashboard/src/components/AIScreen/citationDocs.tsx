import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { isDeskChannelType } from '@xyne/shared';
import { detectFileType } from '../FileViewer/utils';
import { getClawCitationLabel } from '../Chat/XyneAISidebar/utils/clawCitationUrl';
import type { ClawCitation } from '../Chat/XyneAISidebar/utils/XyneAITypes';

/**
 * A citation opened in the /ai page's right-side panel. Mirrors xyne-search's
 * citation "tabs". `navSeq` bumps every time the same doc's citation is
 * re-clicked so the viewer re-jumps / re-highlights even when the target is
 * unchanged.
 *
 * A doc is a discriminated union on `source`:
 * - `kb-file`  — a KB collection file, rendered by downloading its bytes into a
 *                file viewer (pdf / markdown / other).
 * - `thread`   — a Spaces message thread (or in-directory ticket thread),
 *                rendered live via `ThreadMessages`.
 * - `ticket`   — a Desk ticket, rendered live via `TicketDetails`.
 * - `canvas`   — a canvas doc, rendered live via `CanvasScreen`.
 *
 * `id` is the tab identity (dedupe + active key) and is unique across sources
 * (e.g. `kb:<fileId>`, `thread:<conversationId>`). `title` is the tab label.
 */
interface CitationDocBase {
  id: string;
  title: string;
  /** In-app route this citation points at (from `buildClawCitationUrl`). Lets
   *  the panel offer an "open the full page" action for full context — the
   *  in-panel view stays the default. Absent when the citation had no linkable
   *  route. */
  sourceUrl?: string;
  navSeq: number;
}

export interface CitationKbFileDoc extends CitationDocBase {
  source: 'kb-file';
  fileId: string;
  /** Which file viewer the panel renders — pdf gets pdf.js + chunk highlight;
   *  markdown gets a Raw/Preview toggle; everything else the KB file viewer
   *  already knows how to render (docx, csv, excel, images, video, …). */
  fileKind: 'pdf' | 'markdown' | 'other';
  mimeType?: string;
  /** 1-based page to open on. PDF only. */
  page?: number;
  /** 0-based chunk index → resolves the highlight snippet. PDF only. */
  chunkIndex?: number;
}

export interface CitationThreadDoc extends CitationDocBase {
  source: 'thread';
  channelId: string;
  conversationId: string;
  /** Present for in-directory ticket citations — opens ThreadMessages on the
   *  ticket's thread tab. */
  ticketId?: string;
  /** When the backend pinpoints a specific reply, scroll to + highlight it. */
  messageId?: string;
}

export interface CitationTicketDoc extends CitationDocBase {
  source: 'ticket';
  ticketId: string;
}

export interface CitationCanvasDoc extends CitationDocBase {
  source: 'canvas';
  canvasId: string;
}

export type CitationDoc =
  | CitationKbFileDoc
  | CitationThreadDoc
  | CitationTicketDoc
  | CitationCanvasDoc;

/** `Omit` collapses a union to its common keys; this variant distributes over
 *  each member so every source keeps its own fields. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Everything needed to open a doc, minus the internally-managed `navSeq`. */
export type OpenDocInput = DistributiveOmit<CitationDoc, 'navSeq'>;

/**
 * Returns the `openDoc` payload for a citation IF the /ai panel knows how to
 * render its kind, else `null` so the caller falls back to normal navigation.
 *
 * - `collection-item` (KB file): renderable the same way the KB file viewer
 *   decides it (`detectFileType`, extension-only here since citations don't
 *   carry a mime type) — anything with no matching viewer (e.g. a zip) falls
 *   back to navigation. `page` is lifted off the citation's `?page=` deep-link.
 * - `thread`/`ticket`/`canvas` (Spaces-native): rendered live via the same
 *   view components the routes use — see CitationDocsPanel.
 * - `external`: always `null` — off-app links keep opening in a new tab.
 */
export function panelDocFromCitation(
  citation: ClawCitation | null | undefined,
  url: string | null | undefined,
): OpenDocInput | null {
  if (!citation) return null;
  const doc = buildPanelDoc(citation, url);
  if (!doc) return null;
  // Carry the route so the panel can offer "open the full page" for context.
  return url ? { ...doc, sourceUrl: url } : doc;
}

function buildPanelDoc(
  citation: ClawCitation,
  url: string | null | undefined,
): OpenDocInput | null {
  switch (citation.kind) {
    case 'collection-item':
      return kbFileDocFromCitation(citation, url);
    case 'thread':
      // Desk-typed threads are really tickets — render the ticket detail.
      if (isDeskChannelType(citation.channelKind) && citation.ticketId) {
        return ticketDoc(citation);
      }
      return threadDoc(citation);
    case 'ticket':
      // Desk tickets route to TicketDetails; in-directory tickets open their
      // thread (ThreadMessages with the ticket tab).
      if (isDeskChannelType(citation.channelKind)) {
        return ticketDoc(citation);
      }
      return threadDoc(citation);
    case 'canvas':
      return canvasDoc(citation);
    default:
      return null;
  }
}

function kbFileDocFromCitation(
  citation: ClawCitation,
  url: string | null | undefined,
): Omit<CitationKbFileDoc, 'navSeq'> | null {
  const fileId = citation.collectionItemId;
  const name = citation.fileName;
  if (!fileId || !name) return null;
  const fileType = detectFileType('', name);
  if (!fileType) return null;
  const fileKind: CitationKbFileDoc['fileKind'] =
    fileType.type === 'pdf' ? 'pdf' : /\.(md|markdown)$/i.test(name) ? 'markdown' : 'other';
  const pageMatch = url ? /[?&]page=(\d+)/.exec(url) : null;
  return {
    source: 'kb-file',
    id: `kb:${fileId}`,
    title: name,
    fileId,
    fileKind,
    ...(pageMatch ? { page: Number(pageMatch[1]) } : {}),
    ...(typeof citation.chunkIndex === 'number' ? { chunkIndex: citation.chunkIndex } : {}),
  };
}

function threadDoc(citation: ClawCitation): Omit<CitationThreadDoc, 'navSeq'> | null {
  if (!citation.channelId || !citation.conversationId) return null;
  return {
    source: 'thread',
    id: `thread:${citation.conversationId}${citation.ticketId ? `:${citation.ticketId}` : ''}`,
    title: getClawCitationLabel(citation),
    channelId: citation.channelId,
    conversationId: citation.conversationId,
    ...(citation.ticketId ? { ticketId: citation.ticketId } : {}),
    ...(citation.messageId ? { messageId: citation.messageId } : {}),
  };
}

function ticketDoc(citation: ClawCitation): Omit<CitationTicketDoc, 'navSeq'> | null {
  if (!citation.ticketId) return null;
  return {
    source: 'ticket',
    id: `ticket:${citation.ticketId}`,
    title: getClawCitationLabel(citation),
    ticketId: citation.ticketId,
  };
}

function canvasDoc(citation: ClawCitation): Omit<CitationCanvasDoc, 'navSeq'> | null {
  // Canvas citations key on `viewAccessId` (what claw emits); `canvasId` is a
  // legacy fallback normally unset for kind="canvas". The value flows into
  // CitationCanvasDoc.canvasId → CanvasScreen, which treats it as the canvas id.
  const canvasKey = citation.viewAccessId || citation.canvasId;
  if (!canvasKey) return null;
  return {
    source: 'canvas',
    id: `canvas:${canvasKey}`,
    title: getClawCitationLabel(citation),
    canvasId: canvasKey,
  };
}

interface CitationDocsContextValue {
  docs: CitationDoc[];
  /** The doc currently shown (one at a time). */
  activeId: string | null;
  openDoc: (doc: OpenDocInput) => void;
  setActive: (id: string) => void;
  closeDoc: (id: string) => void;
  closeAll: () => void;
  /** Panel shrunk to a re-open rail without losing the open docs — distinct
   *  from closeAll, which drops them. */
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

const CitationDocsContext = createContext<CitationDocsContextValue | null>(null);

/** Max docs kept open as tabs (each stays mounted to preserve its state). */
const MAX_OPEN_DOCS = 15;

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const openDoc = useCallback((doc: OpenDocInput): void => {
    setActiveId(doc.id); // opening/clicking a citation focuses that doc
    setCollapsed(false); // ...and always re-expands a collapsed panel
    setDocs(prev => {
      const existing = prev.find(d => d.id === doc.id);
      if (existing) {
        // Re-clicked an already-open doc: update its target + bump navSeq so the
        // viewer re-jumps/re-highlights.
        return prev.map(d =>
          d.id === doc.id ? ({ ...doc, navSeq: d.navSeq + 1 } as CitationDoc) : d,
        );
      }
      const next = [...prev, { ...doc, navSeq: 0 } as CitationDoc];
      // Keep only the most-recent MAX_OPEN_DOCS (drop the oldest).
      return next.slice(-MAX_OPEN_DOCS);
    });
  }, []);

  const setActive = useCallback((id: string): void => setActiveId(id), []);

  const closeDoc = useCallback((id: string): void => {
    setDocs(prev => {
      const next = prev.filter(d => d.id !== id);
      setActiveId(cur => {
        if (cur !== id) return cur;
        // Closed the active tab → fall back to the last remaining doc.
        return next.length > 0 ? next[next.length - 1]!.id : null;
      });
      return next;
    });
  }, []);

  const closeAll = useCallback((): void => {
    setDocs([]);
    setActiveId(null);
    setCollapsed(false);
  }, []);

  const value = useMemo(
    () => ({
      docs,
      activeId,
      openDoc,
      setActive,
      closeDoc,
      closeAll,
      collapsed,
      setCollapsed,
    }),
    [docs, activeId, openDoc, setActive, closeDoc, closeAll, collapsed],
  );

  return <CitationDocsContext.Provider value={value}>{children}</CitationDocsContext.Provider>;
}
