import type { SdlcDiscussion } from '@xyne/shared';

type SdlcArtifactKind = 'PIPELINE' | 'HUB_KNOWLEDGE' | 'WIKI';

/** One of the hub's artifacts, and what kind of document it is — from the folder it is in. */
export interface HubArtifactSummary {
  id: string;
  title: string;
  kind: SdlcArtifactKind;
}

/** The item a conversation is filed on, from its DISCUSSION link. */
interface ConversationOwner {
  sourceType: string;
  sourceId: string;
}

export interface SdlcDiscussionContext {
  owner: { canvasId: string; title: string; kind: SdlcArtifactKind };
  surface: { type: NonNullable<SdlcDiscussion['surfaceType']>; id: string };
}

/** An artifact as the owner of its discussions; none for a canvas that isn't the hub's. */
export function resolveCanvasDiscussionOwner(
  canvasId: string,
  canvases: readonly HubArtifactSummary[],
): SdlcDiscussionContext['owner'] | null {
  const canvas = canvases.find(item => item.id === canvasId);
  return canvas ? { canvasId: canvas.id, title: canvas.title, kind: canvas.kind } : null;
}

export function resolveSdlcDiscussionContext(input: {
  selectedCanvasId: string | null;
  selectedWikiPage: { canvasId: string; title: string } | null;
  selectedConversationId: string | null;
  /** The hub's artifacts the page knows of: the open one, and an open conversation's. */
  canvases: readonly HubArtifactSummary[];
  /** The open conversation's owner, looked up for it alone; null until known. */
  conversationOwner: ConversationOwner | null;
}): SdlcDiscussionContext | null {
  if (input.selectedWikiPage) {
    return {
      owner: {
        canvasId: input.selectedWikiPage.canvasId,
        title: input.selectedWikiPage.title,
        kind: 'WIKI',
      },
      surface: { type: 'CANVAS', id: input.selectedWikiPage.canvasId },
    };
  }
  if (input.selectedCanvasId) {
    const owner = resolveCanvasDiscussionOwner(input.selectedCanvasId, input.canvases);
    return owner ? { owner, surface: { type: 'CANVAS', id: input.selectedCanvasId } } : null;
  }
  if (!input.selectedConversationId) return null;
  const discussionLink =
    input.conversationOwner?.sourceType === 'CANVAS' ? input.conversationOwner : null;
  const owner = discussionLink
    ? resolveCanvasDiscussionOwner(discussionLink.sourceId, input.canvases)
    : null;
  return owner ? { owner, surface: { type: 'CANVAS', id: owner.canvasId } } : null;
}
