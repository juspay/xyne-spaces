import { ChangeEntry, PullRequestInfo } from './bitbucket';

// Minimal VCS surface the release commit-analysis flow depends on.
// Both BitbucketService and GitHubService implement these structurally so the
// controller can pick by board.vcsProvider without callers caring which is which.
//
// Naming note: `projectKey` / `repositorySlug` come from the Bitbucket
// vocabulary; for GitHub they map to `owner` / `repo`. The strings flow through
// unchanged — only the upstream API differs.
export interface VcsClient {
  getMergedPullRequest(
    projectKey: string,
    repositorySlug: string,
    commitHash: string,
    branch?: string,
  ): Promise<PullRequestInfo | null>;

  getCommitChanges(
    projectKey: string,
    repositorySlug: string,
    commitId: string,
  ): Promise<ChangeEntry[]>;

  getCommitsBetween(
    projectKey: string,
    repositorySlug: string,
    sinceCommitId: string,
    untilCommitId: string,
    branch?: string,
  ): Promise<string[]>;

  getFileDiff(
    projectKey: string,
    repositorySlug: string,
    commitId: string,
    filePath: string,
  ): Promise<string>;

  // Build a browser (web UI) URL to a file's diff within a commit, in the
  // provider's own URL shape. GitHub can't deep-link to a file inside a commit
  // without the computed diff anchor, so it links to the whole commit.
  buildCommitFileUrl(
    projectKey: string,
    repositorySlug: string,
    commitId: string,
    filePath: string,
  ): string;

  // Fetch all commits for a pull request (for bot attribution tracking)
  getCommitsForPullRequest(
    projectKey: string,
    repositorySlug: string,
    prId: number,
  ): Promise<CommitInfo[]>;
}

// Commit information from VCS API
export interface CommitInfo {
  sha: string;
  authorName: string;
  authorEmail: string;
  message: string; // FULL commit message (for Co-authored-by parsing)
  committedAt: Date;
}
