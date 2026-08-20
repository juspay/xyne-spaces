const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const ABBREVIATED_GIT_SHA = /^[0-9a-f]{9,40}$/i;

export const MINIMUM_WIKI_COMMIT_REF_LENGTH = 9;
export const ROOT_WIKI_COMMIT_REF = 'ROOT_BOOTSTRAP';

function canonicalShas(refs: readonly string[]): string[] {
  return [
    ...new Set(
      refs
        .filter((ref) => FULL_GIT_SHA.test(ref))
        .map((ref) => ref.toLowerCase())
    ),
  ];
}

export function shortestUniqueWikiCommitRef(
  ref: string,
  canonicalRefs: readonly string[]
): string {
  if (ref === ROOT_WIKI_COMMIT_REF) return ref;
  const canonical = ref.toLowerCase();
  if (!FULL_GIT_SHA.test(canonical)) throw new Error('Invalid canonical Git commit identity');
  const universe = canonicalShas([...canonicalRefs, canonical]);
  for (let length = MINIMUM_WIKI_COMMIT_REF_LENGTH; length < canonical.length; length += 1) {
    const prefix = canonical.slice(0, length);
    if (universe.filter((candidate) => candidate.startsWith(prefix)).length === 1) return prefix;
  }
  return canonical;
}

export function resolveAssignedWikiCommitRef(
  requestedRef: string,
  assignedRefs: readonly string[]
): string | null {
  const requested = requestedRef.trim();
  if (requested === ROOT_WIKI_COMMIT_REF) {
    return assignedRefs.includes(ROOT_WIKI_COMMIT_REF) ? ROOT_WIKI_COMMIT_REF : null;
  }
  if (!ABBREVIATED_GIT_SHA.test(requested)) return null;
  const normalized = requested.toLowerCase();
  const matches = canonicalShas(assignedRefs).filter((sha) => sha.startsWith(normalized));
  return matches.length === 1 ? matches[0]! : null;
}

export function wikiCommitRefUniverse(input: {
  selectedCommitShas: readonly string[];
  bootstrapRef?: string | null;
  targetHeadSha?: string | null;
  cursorSha?: string | null;
}): string[] {
  return [
    ...input.selectedCommitShas,
    ...(input.bootstrapRef ? [input.bootstrapRef] : []),
    ...(input.targetHeadSha ? [input.targetHeadSha] : []),
    ...(input.cursorSha ? [input.cursorSha] : []),
  ];
}

type WikiAssignmentKind =
  | 'BOOTSTRAP_SURVEY'
  | 'BOOTSTRAP_PAGE'
  | 'BOOTSTRAP_EDITOR'
  | 'BOOTSTRAP'
  | 'COMMITS'
  | 'VALIDATION'
  | 'CORRECTION';

interface WikiAssignmentContext {
  selectedCommitShas: readonly string[];
  bootstrapRef?: string | null;
  targetHeadSha?: string | null;
  cursorSha?: string | null;
  assignedChunk: {
    kind: WikiAssignmentKind;
    commitShas: readonly string[];
    nextIndex: number;
    window?: {
      beforeSha: string;
      afterSha: string;
      activeCheckpointSha: string | null;
      completedCheckpointShas: readonly string[];
    };
  } | null;
  pendingCommit?: { commitSha: string; pages: readonly { path: string }[] } | null;
}

export function wikiAgentCommitRef(
  ref: string | null,
  context: Pick<
    WikiAssignmentContext,
    'selectedCommitShas' | 'bootstrapRef' | 'targetHeadSha' | 'cursorSha'
  >
): string | null {
  if (!ref) return null;
  if (ref !== ROOT_WIKI_COMMIT_REF && !FULL_GIT_SHA.test(ref)) return null;
  return shortestUniqueWikiCommitRef(ref, wikiCommitRefUniverse(context));
}

/** Server-authored recovery state returned by Wiki reads after model compaction. */
export function wikiAssignmentView(context: WikiAssignmentContext): {
  kind: WikiAssignmentKind;
  currentCommitRef: string;
  completedInChunk: number;
  totalInChunk: number;
  pendingPagePaths: string[];
  window?: {
    beforeRef: string;
    afterRef: string;
    includedRefs: string[];
    activeCheckpointRef: string | null;
    completedCheckpointRefs: string[];
  };
} | null {
  const chunk = context.assignedChunk;
  if (!chunk) return null;
  const currentCommit = chunk.window?.activeCheckpointSha ?? chunk.commitShas[chunk.nextIndex];
  if (!currentCommit) return null;
  return {
    kind: chunk.kind,
    currentCommitRef: wikiAgentCommitRef(currentCommit, context)!,
    completedInChunk: chunk.nextIndex,
    totalInChunk: chunk.commitShas.length,
    pendingPagePaths:
      context.pendingCommit?.commitSha === currentCommit
        ? context.pendingCommit.pages.map((page) => page.path)
        : [],
    ...(chunk.window
      ? {
          window: {
            beforeRef: wikiAgentCommitRef(chunk.window.beforeSha, context)!,
            afterRef: wikiAgentCommitRef(chunk.window.afterSha, context)!,
            includedRefs: chunk.commitShas.map((sha) => wikiAgentCommitRef(sha, context)!),
            activeCheckpointRef: wikiAgentCommitRef(
              chunk.window.activeCheckpointSha,
              context
            ),
            completedCheckpointRefs: chunk.window.completedCheckpointShas.map(
              (sha) => wikiAgentCommitRef(sha, context)!
            ),
          },
        }
      : {}),
  };
}
