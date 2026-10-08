export interface CommitWindow {
  repoId: string;
  repository: string;
  beforeSha: string | null;
  afterSha: string;
  commitCount: number;
}

export interface RepositoryWindows {
  startedFrom: 'override' | 'last-run' | 'first-commit';
  fromSha: string | null;
  windows: CommitWindow[];
}

/**
 * Splits a first-parent history (oldest first) into Generator windows, resuming after the most
 * recently completed window. An override commit wins: one window as of it, then windows from there.
 */
export function commitWindows(input: {
  repoId: string;
  repository: string;
  shas: readonly string[];
  commitsPerRun: number;
  /** In the order their windows completed. */
  written: readonly string[];
  overrideCommit?: string;
}): RepositoryWindows {
  const { shas } = input;
  const windows: CommitWindow[] = [];
  const window = (beforeSha: string | null, end: number, commitCount: number) =>
    windows.push({
      repoId: input.repoId,
      repository: input.repository,
      beforeSha,
      afterSha: shas[end]!,
      commitCount,
    });

  let startedFrom: RepositoryWindows['startedFrom'];
  let cursor: number;
  if (input.overrideCommit) {
    const prefix = input.overrideCommit.toLowerCase();
    const end = shas.findIndex((sha) => sha.startsWith(prefix));
    if (end === -1) {
      throw new Error(`Start commit ${input.overrideCommit} is not on the base branch of ${input.repository}`);
    }
    startedFrom = 'override';
    window(null, end, end + 1);
    cursor = end + 1;
  } else {
    const position = new Map(shas.map((sha, index) => [sha, index]));
    const last = input.written.reduce((found, sha) => position.get(sha) ?? found, -1);
    startedFrom = last >= 0 ? 'last-run' : 'first-commit';
    cursor = last + 1;
  }
  const fromSha = startedFrom === 'last-run' ? shas[cursor - 1]! : null;

  for (; cursor < shas.length; cursor += input.commitsPerRun) {
    const end = Math.min(cursor + input.commitsPerRun, shas.length) - 1;
    window(cursor > 0 ? shas[cursor - 1]! : null, end, end - cursor + 1);
  }
  return { startedFrom, fromSha, windows };
}
