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

const sdlcPath = (repoId: string, section: string, search?: URLSearchParams): string => {
  const query = search?.toString();
  return `/sdlc/${encodeURIComponent(repoId)}/${section}${query ? `?${query}` : ''}`;
};

export function resolveSdlcActivityTarget(input: {
  activity: SdlcActivityNavigationActivity;
  channelType: string | null | undefined;
  repoId: string | null | undefined;
  fallbackPath: string;
}): string {
  // SDLC repository channels are identified by channel type; the repo comes
  // from the repos table (1:1 with the channel), not from channel metadata.
  if (input.channelType !== 'SDLC' || !input.repoId) return input.fallbackPath;
  const repoId = input.repoId;

  const canvasId = input.activity.canvasId ?? input.activity.canvas?.id;
  if (canvasId) {
    const special = canvasSpecialSection(input.activity.canvas?.sdlcArtifact?.artifactType);
    if (special) {
      return sdlcPath(repoId, special, new URLSearchParams({ canvas: canvasId }));
    }
    const folderId = input.activity.canvas?.folderId;
    if (folderId) {
      return sdlcPath(
        repoId,
        'artifacts',
        new URLSearchParams({ type: folderId, canvas: canvasId }),
      );
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
