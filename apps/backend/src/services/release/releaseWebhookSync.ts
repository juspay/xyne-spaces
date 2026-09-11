// Release webhook sync
// -----------------------------------------------------------------------------
// Bridges an incoming VCS "PR merged" webhook to the Release Manager: it finds
// the release ticket tracking the PR's base branch and re-runs analysis so the
// merged work (hotfixes) shows up in the release's dev-tickets / envs /
// migrations and on the single release canvas.
//
// Matching is driven by the PR's repo identity (owner/name for GitHub,
// projectKey/slug for Bitbucket) + the release ticket's stored `branch` form
// value.

import { BaseTicketType, FormEntityType, ReleaseTrackingMode, VCSProviderType } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { FormsRepository } from '@/database/repositories/formsRepository';
import { CommitAnalysisController } from '@/controllers/commitAnalysisController';
import { unifiedBotUserService } from '@/bots/unified/index.js';
import { parseBitbucketRepoUrl, parseGitHubRepoUrl } from '@/utils/repoUrlParser';

// Canonical, lowercased {key, slug} of an Application.repoUrl for the given
// provider (owner/repo for GitHub, projectKey/repoSlug for Bitbucket) — the
// stable identity to match against a webhook, since the raw URL forms differ
// (GitHub clone_url vs Bitbucket web/SSH paths). null if the URL doesn't parse.
function repoIdentity(url: string, provider: VCSProviderType): { key: string; slug: string } | null {
  const p = provider === VCSProviderType.GITHUB ? parseGitHubRepoUrl(url) : parseBitbucketRepoUrl(url);
  if (!p) return null;
  const key = 'owner' in p ? p.owner : p.projectKey;
  const slug = 'owner' in p ? p.repo : p.repoSlug;
  return { key: key.toLowerCase(), slug: slug.toLowerCase() };
}

export interface ReleaseMergeSyncParams {
  // Workspace the webhook was scoped to (from the /:workspaceId route param).
  workspaceId: string;
  // The VCS provider of the webhook, matched against Board.vcsProvider.
  provider: VCSProviderType;
  // Repo identity from the webhook payload: owner + name (GitHub) or
  // projectKey + slug (Bitbucket). Matched against parsed Application.repoUrl.
  projectKey: string;
  repoSlug: string;
  // PR base branch (the branch that was merged into).
  baseBranch: string;
  // The post-merge branch-head commit (GitHub merge_commit_sha / Bitbucket
  // mergeCommit.id). The hotfix delta's upper bound; absent ⇒ plain re-run.
  mergeCommitSha?: string;
  // Short tag for log lines, e.g. 'GitHub-Webhook'.
  source: string;
}

/**
 * On a PR merge, sync the most-recent active release ticket for this repo+branch.
 *
 * - If the merge advances the branch past the release's frozen `newCommitId`,
 *   the delta `(newCommitId → mergeCommitSha]` is analyzed as a HOTFIX: its
 *   sub-tickets are tagged HotFix and it renders under "🔥 Hotfix PRs" on the
 *   (single) release canvas. The release's own range stays frozen.
 * - Otherwise the frozen range is simply re-analyzed (idempotent).
 *
 * Runs independently of PR-tracking state, so it also fires for PRs that were
 * created outside Xyne (e.g. merged directly on the SCM).
 */
export async function syncReleaseOnPRMerge(params: ReleaseMergeSyncParams): Promise<void> {
  // Scoped by repo identity + provider + workspaceId (matched boards can span
  // workspaces, so the workspace filter prevents cross-workspace syncs).
  const { workspaceId, provider, projectKey, repoSlug, baseBranch, mergeCommitSha, source } = params;
  const repoLabel = `${projectKey}/${repoSlug}`;

  try {
    // 1. COMMIT_RANGE boards on this provider whose configured app repo matches
    //    the webhook's repo identity.
    const boards = await db.board.findMany({
      where: { releaseTrackingMode: ReleaseTrackingMode.COMMIT_RANGE, vcsProvider: provider },
      select: { id: true },
    });
    if (boards.length === 0) return;

    const want = { key: projectKey.toLowerCase(), slug: repoSlug.toLowerCase() };
    const apps = await db.application.findMany({
      where: { mainReleaseBoardId: { in: boards.map((b) => b.id) } },
      select: { repoUrl: true, mainReleaseBoardId: true },
    });
    const boardIds = [
      ...new Set(
        apps
          .filter((a) => {
            const id = a.repoUrl ? repoIdentity(a.repoUrl, provider) : null;
            return id?.key === want.key && id?.slug === want.slug;
          })
          .map((a) => a.mainReleaseBoardId as string),
      ),
    ];
    if (boardIds.length === 0) {
      logger.info(`[${source}] No COMMIT_RANGE/${provider} release board for repo ${repoLabel}; skipping`);
      return;
    }

    // A multi-repo release ticket lives only on its PRIMARY board; a merge into a
    // non-primary repo reaches its release via release_repositories, not boardId.
    const repoRows = await db.releaseRepository.findMany({
      where: { mainReleaseBoardId: { in: boardIds } },
      select: { releaseId: true, branch: true, deployedCommit: true, newCommit: true },
    });
    const repoRowByReleaseId = new Map(repoRows.map((r) => [r.releaseId, r]));
    const releaseIdsForRepo = [...repoRowByReleaseId.keys()];

    // Candidate release/hotfix tickets, newest first, scoped to the webhook's workspace.
    const ticketWhere = {
      ticketType: { in: [BaseTicketType.Release, BaseTicketType.Hotfix] },
      isArchived: false,
      OR: [
        { boardId: { in: boardIds } },
        ...(releaseIdsForRepo.length ? [{ id: { in: releaseIdsForRepo } }] : []),
      ],
    };
    const tickets = await db.ticket.findMany({
      where: { ...ticketWhere, workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        xyneId: true,
        conversationId: true,
        channelId: true,
        workspaceId: true,
        createdBy: true,
      },
    });
    if (tickets.length === 0) {
      // Matching release tickets may exist in OTHER workspaces (this sync is
      // scoped to the webhook's workspace). That's expected if another workspace
      // legitimately tracks the same repo; only a concern if this merge was meant
      // to sync a release here — then verify the webhook's :workspaceId.
      const otherWorkspaceCount = await db.ticket.count({ where: ticketWhere });
      if (otherWorkspaceCount > 0) {
        logger.info(
          `[${source}] No release ticket for ${repoLabel} in workspace "${workspaceId}"; ` +
          `${otherWorkspaceCount} match in other workspace(s) and are intentionally not synced by this webhook.`,
        );
      } else {
        logger.info(`[${source}] No active release tickets on matched boards for ${repoLabel}`);
      }
      return;
    }

    // 3. First (most recent) ticket whose stored branch matches the PR base branch.
    const formsRepo = new FormsRepository();
    for (const ticket of tickets) {
      // Prefer this repo's release_repositories row (the ticket's scalar form
      // values describe only the primary repo); fall back for legacy single-repo.
      const repoRow = repoRowByReleaseId.get(ticket.id);
      let branch: string;
      let deployedCommitId: string;
      let newCommitId: string;
      if (repoRow) {
        branch = repoRow.branch.trim();
        deployedCommitId = repoRow.deployedCommit.trim();
        newCommitId = repoRow.newCommit.trim();
      } else {
        const formValues = await formsRepo.getFormEntityValuesByEntityId(ticket.id, FormEntityType.TICKET);
        branch = String(formValues['branch'] ?? '').trim();
        deployedCommitId = String(formValues['deployedCommitId'] ?? '').trim();
        newCommitId = String(formValues['newCommitId'] ?? '').trim();
      }
      if (branch !== baseBranch) continue;

      if (!deployedCommitId || !newCommitId) {
        // No analyzed range yet (e.g. a just-created release ticket); try the
        // next candidate rather than abandoning the whole sync.
        logger.warn(`[${source}] Release ticket ${ticket.xyneId} matches branch but has no commit range yet; trying next candidate`);
        continue;
      }

      const bot = await unifiedBotUserService.getBotByBotId('xyne-release-bot', ticket.workspaceId);
      const controller = new CommitAnalysisController();

      const isHotfixDelta = Boolean(mergeCommitSha) && mergeCommitSha !== newCommitId;

      let result: { success: boolean; error?: string };
      if (isHotfixDelta) {
        // Analyze only the delta beyond the frozen release head. deployedCommitId
        // is set to the release's newCommitId (the boundary); newCommitId to the
        // post-merge branch head. hotfixSync routes this to the canvas hotfix
        // section and tags the sub-tickets as hotfixes.
        result = await controller.analyzeCommits({
          conversationId: ticket.conversationId,
          userId: bot?.id || ticket.createdBy,
          channelId: ticket.channelId || undefined,
          // Scalar range — used only when the release has no release_repositories
          // rows; hotfixOverride below supplies the per-repo delta otherwise.
          deployedCommitId: newCommitId,
          newCommitId: mergeCommitSha!,
          branch,
          currentTicketId: ticket.id,
          userName: bot?.name || 'System',
          workspaceId: ticket.workspaceId,
          hotfixSync: true,
          hotfixOverride: { boardIds, mergeCommitSha: mergeCommitSha! },
        });
        if (result.success) {
          logger.info(`[${source}] Synced hotfix (${newCommitId.slice(0, 8)}...${mergeCommitSha!.slice(0, 8)}) for ${ticket.xyneId}`);
        }
      } else {
        // No commits beyond the frozen head — re-run the release range (idempotent).
        result = await controller.analyzeCommits({
          conversationId: ticket.conversationId,
          userId: bot?.id || ticket.createdBy,
          channelId: ticket.channelId || undefined,
          deployedCommitId,
          newCommitId,
          branch,
          currentTicketId: ticket.id,
          userName: bot?.name || 'System',
          workspaceId: ticket.workspaceId,
        });
        if (result.success) {
          logger.info(`[${source}] Re-ran release analysis for ${ticket.xyneId}`);
        }
      }

      if (result.success) {
        return; // most-recent-active only
      }
      // A failed candidate must not shadow an older ticket that is the real release.
      logger.warn(`[${source}] Sync candidate ${ticket.xyneId} failed (${result.error ?? 'unknown error'}); trying next candidate`);
    }

    logger.info(`[${source}] No active release ticket tracks branch "${baseBranch}" for ${repoLabel}`);
  } catch (error) {
    logger.error(`[${source}] Release sync failed:`, error);
  }
}
