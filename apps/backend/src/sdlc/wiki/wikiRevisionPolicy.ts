import { createHash } from 'crypto';

export function wikiVersionIdentityHash(input: {
  markdown: string;
  revisionKind: string;
  commitSha: string;
}): string {
  return createHash('sha256')
    .update(input.markdown)
    .update('\0')
    .update(input.revisionKind)
    .update('\0')
    .update(input.commitSha)
    .digest('hex');
}

function stringPaths(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((path): path is string => typeof path === 'string' && path.length > 0)
    : [];
}

export function resolveWikiRevisionSources(input: {
  action: 'create' | 'update' | 'archive' | 'restore';
  requestedSourcePaths: string[];
  currentSourcePaths: unknown;
}): { activeSourcePaths: string[]; evidenceSourcePaths: string[] } {
  if (input.action !== 'archive') {
    return {
      activeSourcePaths: input.requestedSourcePaths,
      evidenceSourcePaths: input.requestedSourcePaths,
    };
  }

  const evidenceSourcePaths = [
    ...new Set([...stringPaths(input.currentSourcePaths), ...input.requestedSourcePaths]),
  ];
  return { activeSourcePaths: [], evidenceSourcePaths };
}
