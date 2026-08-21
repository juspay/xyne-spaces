type CanvasMetadata = Record<string, unknown>;

interface SdlcActivityNavigationActivity {
  canvasId?: string | null;
  canvas?: { readonly id: string; readonly metadata?: unknown } | null | undefined;
  ticketId?: string | null;
  ticket?: { readonly id: string } | null | undefined;
  conversationId?: string | null;
  messageId?: string | null;
  message?:
    | {
        readonly messageId: string;
        readonly conversation?: { readonly conversationId: string } | null | undefined;
      }
    | null
    | undefined;
}

const metadataRecord = (value: unknown): CanvasMetadata =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as CanvasMetadata) : {};

const sdlcRepoId = (metadata: unknown): string | null => {
  const value = metadataRecord(metadata);
  return value['surface'] === 'SDLC' && typeof value['repoId'] === 'string' && value['repoId']
    ? value['repoId']
    : null;
};

const canvasSection = (metadata: unknown): string | null => {
  const value = metadataRecord(metadata);
  if (value['artifactKind'] === 'BASELINE') return 'baseline';
  if (value['artifactKind'] === 'PRD') return 'prds';
  if (value['artifactKind'] === 'TECH_DOC') return 'tech-docs';
  if (value['documentKind'] === 'WIKI') return 'wiki';
  return null;
};

const sdlcPath = (repoId: string, section: string, search?: URLSearchParams): string => {
  const query = search?.toString();
  return `/sdlc/${encodeURIComponent(repoId)}/${section}${query ? `?${query}` : ''}`;
};

export function resolveSdlcActivityTarget(input: {
  activity: SdlcActivityNavigationActivity;
  channelMetadata: unknown;
  fallbackPath: string;
}): string {
  const repoId = sdlcRepoId(input.channelMetadata);
  if (!repoId) return input.fallbackPath;

  const canvasId = input.activity.canvasId ?? input.activity.canvas?.id;
  if (canvasId) {
    const section = canvasSection(input.activity.canvas?.metadata);
    if (section) {
      return sdlcPath(repoId, section, new URLSearchParams({ canvas: canvasId }));
    }
  }

  const ticketId = input.activity.ticketId ?? input.activity.ticket?.id;
  if (ticketId) {
    return sdlcPath(repoId, 'tickets', new URLSearchParams({ ticket: ticketId }));
  }

  const conversationId =
    input.activity.message?.conversation?.conversationId ?? input.activity.conversationId;
  if (conversationId) {
    const search = new URLSearchParams({
      discussion: '1',
      chat: 'conversations',
      conversation: conversationId,
    });
    const messageId = input.activity.message?.messageId ?? input.activity.messageId;
    const hash = new URLSearchParams({ origin: conversationId });
    if (messageId) hash.set('messageId', messageId);
    return `${sdlcPath(repoId, 'overview', search)}#${hash.toString()}`;
  }

  return sdlcPath(repoId, 'overview');
}
