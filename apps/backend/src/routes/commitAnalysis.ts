import { Router, Request, Response } from 'express';
import { authorizePrivilegedOrResource } from '@/middleware/authorize';
import { CommitAnalysisController } from '@/controllers/commitAnalysisController';
import { testRepoConnection } from '@/services/release/repoInspector';
import { AccessType, BaseTicketType, FormEntityType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { findAnalysisCanvasIdForConversation } from '@/utils/commitAnalysisCanvas';
import { detectVcsProvider } from '@/utils/repoUrlParser';
import { FormsRepository } from '@/database/repositories/formsRepository';
import { unifiedBotUserService } from '@/bots/unified/index.js';

const router = Router();
const commitAnalysisController = new CommitAnalysisController();
const formsRepository = new FormsRepository();

router.get('/latest-deployed-commit', commitAnalysisController.getLatestDeployedCommitId);

// Re-run commit analysis for an existing release ticket. Used by the "Re-run"
// button on the Release Detail screen — saves the create-delete-recreate dance
// when the user iterates on Application regex / paths config.
router.post('/re-run/:ticketId', authorizePrivilegedOrResource('RELEASE-MANAGER', AccessType.WRITE), async (req: Request, res: Response): Promise<void> => {
  const { ticketId } = req.params;
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (!ticketId) {
    res.status(400).json({ error: 'ticketId is required' });
    return;
  }

  try {
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        xyneId: true,
        ticketType: true,
        conversationId: true,
        channelId: true,
        workspaceId: true,
      },
    });
    if (!ticket) {
      res.status(404).json({ error: `Ticket ${ticketId} not found` });
      return;
    }
    if (ticket.workspaceId !== req.user?.workspaceId) {
      res.status(404).json({ error: `Ticket ${ticketId} not found` });
      return;
    }

    const formValues = await formsRepository.getFormEntityValuesByEntityId(
      ticketId,
      FormEntityType.TICKET,
    );
    // Trim — same defense as the create path in TicketController.
    const deployedCommitId = String(formValues['deployedCommitId'] ?? '').trim();
    const newCommitId = String(formValues['newCommitId'] ?? '').trim();
    const branch = String(formValues['branch'] ?? '').trim() || 'main';

    const repoCount = await db.releaseRepository.count({ where: { releaseId: ticketId } });
    if (repoCount === 0 && (!deployedCommitId || !newCommitId)) {
      res.status(400).json({
        error:
          'This release ticket is missing deployedCommitId or newCommitId form fields — re-run is only supported for COMMIT_RANGE releases.',
      });
      return;
    }

    const xyneReleaseBot = await unifiedBotUserService.getBotByBotId(
      'xyne-release-bot',
      ticket.workspaceId,
    );

    const result = await commitAnalysisController.analyzeCommits({
      conversationId: ticket.conversationId,
      userId: xyneReleaseBot?.id || userId,
      channelId: ticket.channelId || undefined,
      newCommitId,
      deployedCommitId,
      branch,
      currentTicketId: ticket.id,
      userName: req.user?.name,
      workspaceId: ticket.workspaceId,
      // keep Hotfix-type re-runs flagging ART rows as hotfix (matches create path)
      isHotFix: ticket.ticketType === BaseTicketType.Hotfix,
    });

    res.json({ success: result.success, canvasUrl: result.canvasUrl, error: result.error });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[CommitAnalysis] re-run failed', { ticketId, error: msg });
    res.status(500).json({ error: msg });
  }
});

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

export default router;