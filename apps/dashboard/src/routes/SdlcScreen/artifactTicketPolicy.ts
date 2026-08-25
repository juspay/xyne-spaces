export type ArtifactTicketLink = {
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
};

export type RelatedArtifactTicket = {
  id: string;
  projectId?: string | null;
  title: string;
  xyneId: string;
};

const TICKET_RELATIONS = new Set(['CONTEXT', 'TICKET']);

export function linkedTicketIds(links: readonly ArtifactTicketLink[]): string[] {
  const ids = new Set<string>();
  for (const link of links) {
    if (!TICKET_RELATIONS.has(link.relationType)) continue;
    if (link.targetType === 'TICKET') ids.add(link.targetId);
    if (link.sourceType === 'TICKET') ids.add(link.sourceId);
  }
  return [...ids];
}

export function artifactChainCanvasIds(
  canvasId: string,
  links: readonly ArtifactTicketLink[],
): Set<string> {
  const ids = new Set([canvasId]);
  for (const link of links) {
    if (
      link.relationType !== 'TECH_DOC' ||
      link.sourceType !== 'CANVAS' ||
      link.targetType !== 'CANVAS'
    ) {
      continue;
    }
    if (link.sourceId === canvasId || link.targetId === canvasId) {
      ids.add(link.sourceId);
      ids.add(link.targetId);
    }
  }
  return ids;
}

export function relatedTicketsForArtifact<Ticket extends RelatedArtifactTicket>(input: {
  canvasId: string;
  projectId: string;
  links: readonly ArtifactTicketLink[];
  tickets: readonly Ticket[];
}): Ticket[] {
  const chainIds = artifactChainCanvasIds(input.canvasId, input.links);
  const relatedIds = new Set<string>();
  for (const link of input.links) {
    if (!TICKET_RELATIONS.has(link.relationType)) continue;
    if (
      link.sourceType === 'CANVAS' &&
      chainIds.has(link.sourceId) &&
      link.targetType === 'TICKET'
    ) {
      relatedIds.add(link.targetId);
    }
    if (
      link.targetType === 'CANVAS' &&
      chainIds.has(link.targetId) &&
      link.sourceType === 'TICKET'
    ) {
      relatedIds.add(link.sourceId);
    }
  }
  return input.tickets.filter(
    ticket => ticket.projectId === input.projectId && relatedIds.has(ticket.id),
  );
}

export function startWorkPrompt(input: {
  repositoryName: string;
  artifactKind: 'PRD' | 'TECH_DOC';
  artifactTitle: string;
  ticket: Pick<RelatedArtifactTicket, 'xyneId' | 'title'>;
}): string {
  const artifactKind = input.artifactKind === 'PRD' ? 'PRD' : 'Tech Doc';
  return `Start work on ticket ${input.ticket.xyneId}: ${input.ticket.title} for the ${artifactKind} "${input.artifactTitle}" in repository "${input.repositoryName}". Inspect the linked artifact and ticket, then begin implementation.`;
}
