import { Router, Request, Response } from 'express';
import { authorizePrivilegedOrResource } from '@/middleware/authorize';
import { CommitAnalysisController } from '@/controllers/commitAnalysisController';
import {
  testRepoConnection,
  // Disabled (LLM)
  // listGitHubRepoFilePaths,
  // listBitbucketRepoFilePaths,
} from '@/services/release/repoInspector';
// Disabled (LLM)
// import { suggestReleaseServices } from '@/agents/release-service-suggest/index.js';
// Disabled (LLM)
// import { AccessType, BaseTicketType, FormEntityType, VCSProviderType } from '@xyne/shared';
import { AccessType } from '@xyne/shared';
import { logger } from '@/utils/logger';
// Disabled (LLM)
// import { config } from '@/config/env';
import { db } from '@/database/client';
import { findAnalysisCanvasIdForConversation } from '@/utils/commitAnalysisCanvas';
import { detectVcsProvider } from '@/utils/repoUrlParser';

const router = Router();
const commitAnalysisController = new CommitAnalysisController();

router.get('/latest-deployed-commit', commitAnalysisController.getLatestDeployedCommitId);

// Per (release ticket × repo) commit ranges for a release ticket. Read from the
// non_zero schema (server-only, not Zero-replicated) and served over HTTP — the
// Release Detail screen fetches this instead of syncing the table via Zero.
router.get('/repos/:releaseId', async (req: Request, res: Response): Promise<void> => {
  const { releaseId } = req.params;
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (!releaseId) {
    res.status(400).json({ error: 'releaseId is required' });
    return;
  }
  try {
    const repos = await db.releaseRepository.findMany({
      where: { releaseId, workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const ticket = await db.ticket.findFirst({
      where: { id: releaseId, workspaceId },
      select: { conversationId: true, channelId: true },
    });
    const analysisCanvasId = await findAnalysisCanvasIdForConversation(
      ticket?.conversationId ?? undefined,
      ticket?.channelId ?? undefined,
    );

    res.json({ repos, analysisCanvasId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[CommitAnalysis] repos fetch failed', { releaseId, error: msg });
    res.status(500).json({ error: msg });
  }
});

router.post('/test-connection', authorizePrivilegedOrResource('RELEASE-MANAGER', AccessType.WRITE), async (req: Request, res: Response): Promise<void> => {
  const { repoUrl } = req.body as { repoUrl?: string };
  if (!repoUrl) {
    res.status(400).json({ ok: false, message: 'repoUrl is required' });
    return;
  }
  const vcsProvider = detectVcsProvider(repoUrl);
  if (!vcsProvider) {
    res.status(400).json({
      ok: false,
      message:
        'Unsupported or unrecognized repository URL — provide a GitHub or Bitbucket Server repository URL',
    });
    return;
  }
  try {
    const result = await testRepoConnection({
      repoUrl,
      vcsProvider,
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.json({ ok: false, message: msg });
  }
});

// AI-suggest services + env/migration paths from a registered repository's file
// tree, to prefill a release config. Supports GitHub and Bitbucket Server.
// Scope note: the repository is one registered in the caller's workspace (repoId),
// and listing uses the org-wide token; the VCS host is pinned to config (no SSRF).
// Disabled (LLM)
// router.post('/suggest-services', authorizePrivilegedOrResource('RELEASE-MANAGER', AccessType.WRITE), async (req: Request, res: Response): Promise<void> => {
//   const { repoId, projectId: rawProjectId } = req.body as { repoId?: string; projectId?: unknown };
//   const projectId = typeof rawProjectId === 'string' && rawProjectId ? rawProjectId : null;
//   const userId = req.user?.id;
//   const workspaceId = req.user?.workspaceId;
//   if (!userId || !workspaceId) {
//     res.status(401).json({ error: 'Authentication required' });
//     return;
//   }
//   if (!repoId) {
//     res.status(400).json({ error: 'repoId is required' });
//     return;
//   }
//   const repo = await db.repo.findFirst({
//     where: { id: repoId, workspaceId },
//     select: { url: true, canonicalUrl: true },
//   });
//   if (!repo) {
//     res.status(404).json({ error: 'Repository not found' });
//     return;
//   }
//   const repoUrl = repo.canonicalUrl || repo.url;
//   const provider = detectVcsProvider(repoUrl);
//   // detectVcsProvider treats any non-GitHub URL as Bitbucket, so also require the
//   // configured Bitbucket host — otherwise a GitLab URL surfaces as a Bitbucket auth error.
//   const bitbucketHost = config.bitbucket.baseUrl.replace(/^https?:\/\//, '').split('/')[0] || null;
//   const isSupported =
//     provider === VCSProviderType.GITHUB ||
//     (provider === VCSProviderType.BITBUCKET_SERVER && !!bitbucketHost && repoUrl.includes(bitbucketHost));
//   if (!isSupported) {
//     res.json({
//       services: [],
//       message: 'AI suggestions support GitHub and Bitbucket Server repositories.',
//     });
//     return;
//   }
//   try {
//     if (projectId) {
//       const project = await db.project.findUnique({
//         where: { id: projectId },
//         select: { workspaceId: true },
//       });
//       if (!project || project.workspaceId !== workspaceId) {
//         res.status(404).json({ error: 'Project not found' });
//         return;
//       }
//     }
//     const paths =
//       provider === VCSProviderType.GITHUB
//         ? await listGitHubRepoFilePaths(repoUrl)
//         : await listBitbucketRepoFilePaths(repoUrl);
//     const result = await suggestReleaseServices({ paths }, { projectId: projectId ?? null, userId });
//     res.json(result);
//   } catch (e) {
//     const msg = e instanceof Error ? e.message : String(e);
//     logger.error('[CommitAnalysis] suggest-services failed', { repoId, error: msg });
//     res.status(500).json({ error: 'Failed to suggest services for this repository' });
//   }
// });

export default router;