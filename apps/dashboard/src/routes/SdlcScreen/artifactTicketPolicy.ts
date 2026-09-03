export type ArtifactTicketLink = {
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
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
