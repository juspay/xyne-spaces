import type { SdlcDiscussion, SdlcEntityType, SdlcRelationType } from '@xyne/shared';

interface CanvasSummary {
  id: string;
  title: string;
  metadata: unknown;
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
  surface: { type: SdlcDiscussion['surfaceType']; id: string };
}

const metadataOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function resolveCanvasDiscussionOwner(
  canvasId: string,
  canvases: readonly CanvasSummary[],
  links: readonly LinkSummary[],
): SdlcDiscussionContext['owner'] | null {
  const canvas = canvases.find(item => item.id === canvasId);
  if (!canvas) return null;
  const metadata = metadataOf(canvas.metadata);
  if (metadata['artifactKind'] === 'PRD') {
    return { canvasId: canvas.id, title: canvas.title, kind: 'PIPELINE' };
  }
  if (metadata['artifactKind'] === 'BASELINE') {
    return { canvasId: canvas.id, title: canvas.title, kind: 'REPO_KNOWLEDGE' };
  }
  if (metadata['documentKind'] === 'WIKI') {
    return { canvasId: canvas.id, title: canvas.title, kind: 'WIKI' };
  }
  if (metadata['artifactKind'] !== 'TECH_DOC') return null;
  const parentLink = links.find(
    link =>
      link.relationType === 'TECH_DOC' &&
      link.targetType === 'CANVAS' &&
      link.targetId === canvas.id,
  );
  return parentLink ? resolveCanvasDiscussionOwner(parentLink.sourceId, canvases, links) : null;
}

export function resolveSdlcDiscussionContext(input: {
  selectedCanvasId: string | null;
  selectedWikiPage: { canvasId: string; title: string } | null;
  selectedTicketId: string | null;
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
  if (!input.selectedTicketId || !input.ticketIds.includes(input.selectedTicketId)) return null;
  const sourceLink = input.links.find(
    link => link.relationType === 'TICKET' && link.targetId === input.selectedTicketId,
  );
  const owner = sourceLink
    ? resolveCanvasDiscussionOwner(sourceLink.sourceId, input.canvases, input.links)
    : null;
  return owner ? { owner, surface: { type: 'TICKET', id: input.selectedTicketId } } : null;
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
