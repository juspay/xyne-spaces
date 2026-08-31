import { isBaselineCanvasType } from '@xyne/shared/sdlc';

interface SdlcActivityNavigationActivity {
  canvasId?: string | null;
  canvas?:
    | {
        readonly id: string;
        readonly folderId?: string | null;
        readonly sdlcArtifact?: { readonly artifactType?: unknown } | null;
      }
    | null
    | undefined;
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

const canvasSpecialSection = (artifactType: unknown): string | null => {
  if (typeof artifactType !== 'string') return null;
  if (isBaselineCanvasType(artifactType)) return 'baseline';
  if (artifactType === 'WIKI') return 'wiki';
  return null;
};

const sdlcPath = (channelId: string, section: string, search?: URLSearchParams): string => {
  const query = search?.toString();
  return `/sdlc/${encodeURIComponent(channelId)}/${section}${query ? `?${query}` : ''}`;
};

export function resolveSdlcActivityTarget(input: {
  activity: SdlcActivityNavigationActivity;
  channelType: string | null | undefined;
  channelId: string | null | undefined;
  fallbackPath: string;
}): string {
  // SDLC spaces are addressed by their channel. A space can cover several
  // repositories, so the repository is chosen inside the screen, not in the URL.
  if (input.channelType !== 'SDLC' || !input.channelId) return input.fallbackPath;
  const channelId = input.channelId;

  const canvasId = input.activity.canvasId ?? input.activity.canvas?.id;
  if (canvasId) {
    const special = canvasSpecialSection(input.activity.canvas?.sdlcArtifact?.artifactType);
    if (special) {
      return sdlcPath(channelId, special, new URLSearchParams({ canvas: canvasId }));
    }
    const folderId = input.activity.canvas?.folderId;
    if (folderId) {
      return sdlcPath(
        channelId,
        'artifacts',
        new URLSearchParams({ type: folderId, canvas: canvasId }),
      );
    }
  }

  const ticketId = input.activity.ticketId ?? input.activity.ticket?.id;
  if (ticketId) {
    return sdlcPath(channelId, 'tickets', new URLSearchParams({ ticket: ticketId }));
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
    return `${sdlcPath(channelId, 'overview', search)}#${hash.toString()}`;
  }

  return sdlcPath(channelId, 'overview');
}
