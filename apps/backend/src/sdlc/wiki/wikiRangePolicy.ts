import type { SdlcWikiCommitRef, SdlcWikiHistoryRange } from '@xyne/shared';

export const WIKI_ROOT_BOOTSTRAP_REF = 'ROOT_BOOTSTRAP' as const;

export interface FirstParentCommit {
  sha: string;
  parentSha: string | null;
}

export interface WikiCommitRange {
  targetHeadSha: string;
  selectedStartSha: string;
  selectedEndSha: string;
  selectedCommitShas: string[];
  bootstrapRef: SdlcWikiCommitRef;
}

export interface WikiHistoryWindow {
  beforeSha: SdlcWikiCommitRef;
  afterSha: string;
  includedCommitShas: string[];
}

export class WikiRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WikiRangeError';
  }
}

function assertFullFirstParentChain(
  commits: readonly FirstParentCommit[],
  targetHeadSha: string
): void {
  if (commits.length === 0) {
    throw new WikiRangeError('The base branch has no commits');
  }
  if (commits[commits.length - 1]?.sha !== targetHeadSha) {
    throw new WikiRangeError('Target head does not match the first-parent chain head');
  }

  const seen = new Set<string>();
  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    if (seen.has(commit.sha)) {
      throw new WikiRangeError(`Duplicate commit in first-parent chain: ${commit.sha}`);
    }
    seen.add(commit.sha);

    const expectedParent = index === 0 ? null : commits[index - 1].sha;
    if (commit.parentSha !== expectedParent) {
      throw new WikiRangeError(`Broken first-parent chain at commit: ${commit.sha}`);
    }
  }
}

function selectedStartIndex(
  commits: readonly FirstParentCommit[],
  historyRange: SdlcWikiHistoryRange
): number {
  if (historyRange.kind === 'FULL') {
    return 0;
  }
  if (historyRange.kind === 'CUSTOM_SHA') {
    const index = commits.findIndex((commit) => commit.sha === historyRange.sha);
    if (index === -1) {
      throw new WikiRangeError('Custom start commit is not on the target head first-parent chain');
    }
    return index;
  }

  const selectedCount = Math.max(1, Math.ceil((commits.length * historyRange.percent) / 100));
  return commits.length - selectedCount;
}

export function planInitialWikiRange(input: {
  commits: readonly FirstParentCommit[];
  targetHeadSha: string;
  historyRange: SdlcWikiHistoryRange;
}): WikiCommitRange {
  assertFullFirstParentChain(input.commits, input.targetHeadSha);
  const startIndex = selectedStartIndex(input.commits, input.historyRange);
  const selected = input.commits.slice(startIndex);
  const start = selected[0];

  return {
    targetHeadSha: input.targetHeadSha,
    selectedStartSha: start.sha,
    selectedEndSha: input.targetHeadSha,
    selectedCommitShas: selected.map((commit) => commit.sha),
    bootstrapRef: start.parentSha ?? WIKI_ROOT_BOOTSTRAP_REF,
  };
}

export function planRefreshWikiRange(input: {
  commits: readonly FirstParentCommit[];
  targetHeadSha: string;
  cursorSha: string;
}): WikiCommitRange | null {
  assertFullFirstParentChain(input.commits, input.targetHeadSha);
  const cursorIndex = input.commits.findIndex((commit) => commit.sha === input.cursorSha);
  if (cursorIndex === -1) {
    throw new WikiRangeError('Latest Wiki cursor is not on the target head first-parent chain');
  }
  if (cursorIndex === input.commits.length - 1) {
    return null;
  }

  const selected = input.commits.slice(cursorIndex + 1);
  return {
    targetHeadSha: input.targetHeadSha,
    selectedStartSha: selected[0].sha,
    selectedEndSha: input.targetHeadSha,
    selectedCommitShas: selected.map((commit) => commit.sha),
    bootstrapRef: input.cursorSha,
  };
}

export function nextWikiChunk(input: {
  selectedCommitShas: readonly string[];
  cursorSha: string | null;
  chunkSize: number;
}): string[] {
  if (!Number.isInteger(input.chunkSize) || input.chunkSize < 1) {
    throw new WikiRangeError('Chunk size must be a positive integer');
  }

  const startIndex = input.cursorSha ? input.selectedCommitShas.indexOf(input.cursorSha) + 1 : 0;
  if (input.cursorSha && startIndex === 0) {
    throw new WikiRangeError('Cursor is outside the selected commit range');
  }
  return input.selectedCommitShas.slice(startIndex, startIndex + input.chunkSize);
}

export function nextWikiWindow(input: {
  selectedCommitShas: readonly string[];
  cursorSha: string | null;
  bootstrapRef: SdlcWikiCommitRef;
  windowSize: number;
}): WikiHistoryWindow | null {
  const includedCommitShas = nextWikiChunk({
    selectedCommitShas: input.selectedCommitShas,
    cursorSha: input.cursorSha,
    chunkSize: input.windowSize,
  });
  const afterSha = includedCommitShas.at(-1);
  if (!afterSha) return null;
  return {
    beforeSha: input.cursorSha ?? input.bootstrapRef,
    afterSha,
    includedCommitShas,
  };
}
