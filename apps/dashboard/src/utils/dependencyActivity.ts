/** Synchronized dependency activities are intentionally generic. Never render stored endpoint text. */
export function dependencyActivityDescription(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const { relationType, action } = value as Record<string, unknown>;
  if (relationType !== 'BLOCKS' && relationType !== 'CHILD') return null;
  switch (action) {
    case 'created':
    case 'added':
      return 'added a ticket dependency';
    case 'removed':
      return 'removed a ticket dependency';
    case 'satisfied':
    case 'marked as satisfied':
      return 'satisfied a ticket dependency';
    case 'review':
      return 'marked a ticket dependency as needing review';
    case 'override':
      return 'overrode a ticket dependency gate';
    case 'sub-ticket gating updated':
      return 'updated sub-ticket gating';
    default:
      return 'updated a ticket dependency';
  }
}
