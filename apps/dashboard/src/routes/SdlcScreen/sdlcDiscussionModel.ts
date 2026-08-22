import { isBaselineCanvasType } from '@xyne/shared/sdlc';
import type { SdlcDiscussion, SdlcEntityType, SdlcRelationType } from '@xyne/shared';

interface CanvasSummary {
  id: string;
  title: string;
  // Kind lives on the artifact row, loaded via the canvas -> sdlcArtifact relation.
  sdlcArtifact?: { readonly artifactType?: string | null } | null | undefined;
}

interface LinkSummary {
  sourceType: SdlcEntityType;
  sourceId: string;
  targetType: SdlcEntityType;
  targetId: string;
  relationType: SdlcRelationType;
}

export interface SdlcDiscussionContext {
  owner: { canvasId: string; title: string; kind: 'PIPELINE' | 'REPO_KNOWLEDGE' | 'WIKI' };
  surface: { type: NonNullable<SdlcDiscussion['surfaceType']>; id: string };
}

export function resolveCanvasDiscussionOwner(
  canvasId: string,
  canvases: readonly CanvasSummary[],
  links: readonly LinkSummary[],
): SdlcDiscussionContext['owner'] | null {
  const canvas = canvases.find(item => item.id === canvasId);
  if (!canvas) return null;
  if (canvas.sdlcArtifact?.artifactType === 'PRD') {
    return { canvasId: canvas.id, title: canvas.title, kind: 'PIPELINE' };
  }
  if (isBaselineCanvasType(canvas.sdlcArtifact?.artifactType)) {
    return { canvasId: canvas.id, title: canvas.title, kind: 'REPO_KNOWLEDGE' };
  }
  if (canvas.sdlcArtifact?.artifactType === 'WIKI') {
    return { canvasId: canvas.id, title: canvas.title, kind: 'WIKI' };
  }
  if (canvas.sdlcArtifact?.artifactType !== 'TECH_DOC') return null;
  const parentLink = links.find(
    link =>
      link.relationType === 'TECH_DOC' &&
      link.targetType === 'CANVAS' &&
      link.targetId === canvas.id,
  );
  return parentLink
    ? resolveCanvasDiscussionOwner(parentLink.sourceId, canvases, links)
    : { canvasId: canvas.id, title: canvas.title, kind: 'PIPELINE' };
}

export function resolveSdlcDiscussionContext(input: {
  selectedCanvasId: string | null;
  selectedWikiPage: { canvasId: string; title: string } | null;
  selectedTicketId: string | null;
  selectedConversationId: string | null;
  ticketIds: readonly string[];
  canvases: readonly CanvasSummary[];
  links: readonly LinkSummary[];
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
    const owner = resolveCanvasDiscussionOwner(input.selectedCanvasId, input.canvases, input.links);
    return owner ? { owner, surface: { type: 'CANVAS', id: input.selectedCanvasId } } : null;
  }
  if (input.selectedTicketId) {
    if (!input.ticketIds.includes(input.selectedTicketId)) return null;
    const sourceLink = input.links.find(
      link => link.relationType === 'TICKET' && link.targetId === input.selectedTicketId,
    );
    const owner = sourceLink
      ? resolveCanvasDiscussionOwner(sourceLink.sourceId, input.canvases, input.links)
      : null;
    return owner ? { owner, surface: { type: 'TICKET', id: input.selectedTicketId } } : null;
  }
  if (!input.selectedConversationId) return null;
  const discussionLink = input.links.find(
    link =>
      link.sourceType === 'CANVAS' &&
      link.targetType === 'CONVERSATION' &&
      link.targetId === input.selectedConversationId &&
      link.relationType === 'DISCUSSION',
  );
  const owner = discussionLink
    ? resolveCanvasDiscussionOwner(discussionLink.sourceId, input.canvases, input.links)
    : null;
  return owner ? { owner, surface: { type: 'CANVAS', id: owner.canvasId } } : null;
}

export const discussionConversationIds = (
  ownerCanvasId: string | null,
  links: readonly LinkSummary[],
): string[] =>
  ownerCanvasId
    ? links.flatMap(link =>
        link.sourceType === 'CANVAS' &&
        link.sourceId === ownerCanvasId &&
        link.targetType === 'CONVERSATION' &&
        link.relationType === 'DISCUSSION'
          ? [link.targetId]
          : [],
      )
    : [];

export const ownerHasConversations = (
  ownerCanvasId: string | null,
  links: readonly LinkSummary[],
): boolean => discussionConversationIds(ownerCanvasId, links).length > 0;
