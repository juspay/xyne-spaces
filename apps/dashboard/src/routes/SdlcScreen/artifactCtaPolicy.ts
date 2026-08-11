export type ArtifactCta =
  | { action: 'CREATE_TECH_DOC'; label: 'Create Tech Doc' }
  | { action: 'VIEW_TECH_DOC'; label: 'View Tech Doc'; targetId: string }
  | { action: 'CREATE_TICKET'; label: 'Create Ticket' }
  | { action: 'VIEW_TICKET'; label: 'View Ticket'; targetId: string };

export function artifactCta(kind: 'PRD' | 'TECH_DOC', linkedTargetId: string | null): ArtifactCta {
  if (kind === 'PRD') {
    return linkedTargetId
      ? { action: 'VIEW_TECH_DOC', label: 'View Tech Doc', targetId: linkedTargetId }
      : { action: 'CREATE_TECH_DOC', label: 'Create Tech Doc' };
  }
  return linkedTargetId
    ? { action: 'VIEW_TICKET', label: 'View Ticket', targetId: linkedTargetId }
    : { action: 'CREATE_TICKET', label: 'Create Ticket' };
}
