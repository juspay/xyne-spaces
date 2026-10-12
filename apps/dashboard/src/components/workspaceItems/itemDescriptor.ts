import type { ConversationArtifact } from '../../services/XyneAI/XyneAIArtifactsService';
import { browserAddressOf } from '../FilePreview/streamSource';
import type { PreviewFile } from '../FilePreview/types';

export type WorkspaceItemKind =
  | 'canvas'
  | 'react-app'
  | 'page'
  | 'design'
  | 'html-doc'
  | 'file'
  | 'spec'
  | 'diff'
  | 'preview'
  | 'link'
  | 'browser';

export type WorkspaceItemSource = 'ai-artifact' | 'sdlc-item';

/**
 * Where an item came from, which is a different question to where it is stored.
 * A source is something that was already true: a document someone filed, a page
 * the agent read, a call that happened. An artifact is something a run made.
 * The split is what lets a reader trust one and review the other.
 */
export type WorkspaceItemOrigin = 'source' | 'artifact';

export interface WorkspaceItem {
  id: string;
  kind: WorkspaceItemKind;
  title: string;
  source: WorkspaceItemSource;
  origin: WorkspaceItemOrigin;
  /** Where the bytes live: an attachment id, a canvas id, an app id, a share id. */
  refId: string;
  url?: string;
  /** Where the bytes are fetched from, when the item is a document rather than a page. */
  contentUrl?: string;
  provider?: string;
  mimeType?: string;
  size?: number;
  versionRef?: string;
  stale?: boolean;
  /** The row this was mapped from, for views that still need their own fields. */
  row?: unknown;
}

/** Artifact kinds that record something the agent read, rather than made. */
const SOURCE_KINDS = new Set(['PAGE', 'LINK', 'UPLOAD']);

const ARTIFACT_KINDS: Record<string, WorkspaceItemKind> = {
  CANVAS: 'canvas',
  REACT_APP: 'react-app',
  DESIGN_HTML: 'design',
  REVIEW_ROOM: 'html-doc',
  LESSON: 'html-doc',
  FILE: 'file',
  SPEC: 'spec',
  DIFF: 'diff',
  PREVIEW: 'preview',
  LINK: 'link',
  PAGE: 'page',
  UPLOAD: 'file',
};

const DOCUMENT_KINDS = new Set<WorkspaceItemKind>(['file', 'spec', 'html-doc']);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isAgentOutput(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.host === window.location.host) return true;
    return (
      LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) && /^\/runs\/[^/]+\//.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function attachmentDownloadUrl(refId: string): string {
  return `/xyne-ai/v2/attachments/${encodeURIComponent(refId)}/download`;
}

export function itemFromArtifact(artifact: ConversationArtifact): WorkspaceItem {
  const kind = ARTIFACT_KINDS[artifact.kind] ?? 'file';
  const url = artifact.openRef.url ?? artifact.url ?? undefined;
  const contentUrl = DOCUMENT_KINDS.has(kind)
    ? attachmentDownloadUrl(artifact.openRef.refId)
    : undefined;
  return {
    id: artifact.id,
    kind,
    title: artifact.title,
    source: 'ai-artifact',
    origin: SOURCE_KINDS.has(artifact.kind) && !isAgentOutput(url) ? 'source' : 'artifact',
    refId: artifact.openRef.refId,
    ...(url ? { url } : {}),
    ...(contentUrl ? { contentUrl } : {}),
    ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
    ...(artifact.size ? { size: artifact.size } : {}),
    ...(artifact.provider ? { provider: artifact.provider } : {}),
    ...(artifact.latestVersionRef ? { versionRef: artifact.latestVersionRef } : {}),
    ...(artifact.status === 'STALE' ? { stale: true } : {}),
    row: artifact,
  };
}

export interface SdlcItemInput {
  id: string;
  title: string;
  kind: 'CANVAS' | 'LINK' | 'FILE' | 'BROWSER';
  url?: string | undefined;
  mimeType?: string | undefined;
}

export function itemFromSdlc(row: SdlcItemInput): WorkspaceItem {
  const kind: WorkspaceItemKind =
    row.kind === 'CANVAS'
      ? 'canvas'
      : row.kind === 'LINK'
        ? 'link'
        : row.kind === 'BROWSER'
          ? 'browser'
          : 'file';
  return {
    id: row.id,
    kind,
    title: row.title,
    source: 'sdlc-item',
    origin: 'source',
    refId: row.id,
    ...(row.url ? { url: row.url } : {}),
    ...(row.url && kind === 'file' ? { contentUrl: row.url } : {}),
    ...(row.mimeType ? { mimeType: row.mimeType } : {}),
    row,
  };
}

/** Where an item's bytes are fetched from, which is not every item's own address. */
export function fileSourceOf(item: WorkspaceItem): string | undefined {
  return item.contentUrl ?? item.url;
}

/** A file as the app's file previewer takes it, built from an item's address. */
export function previewFileFor(
  file: {
    source: string;
    name: string;
    mimeType?: string | undefined;
    size?: number | undefined;
  },
  apiBase: string,
): PreviewFile {
  const streamUrl = browserAddressOf(file.source, apiBase);
  return {
    id: file.source,
    name: file.name,
    mimetype: file.mimeType ?? '',
    size: file.size ?? 0,
    ...(streamUrl ? { streamUrl } : {}),
  };
}

/** Kinds whose content is a live web page, so they share the embedded browser. */
export function isBrowsableItem(item: WorkspaceItem): boolean {
  return item.kind === 'link' || item.kind === 'page' || item.kind === 'browser';
}

/** Kinds that carry a self-contained HTML document rather than a live page. */
export function isHtmlDocItem(item: WorkspaceItem): boolean {
  return item.kind === 'html-doc';
}
