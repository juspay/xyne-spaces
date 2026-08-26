import { Router, Request, Response } from 'express';
import { authorize } from '@/middleware/authorize';
import { CommitAnalysisController } from '@/controllers/commitAnalysisController';
import { testRepoConnection } from '@/services/release/repoInspector';
import { AccessType, BaseTicketType, FormEntityType, VCSProviderType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { findAnalysisCanvasIdForConversation } from '@/utils/commitAnalysisCanvas';
import { FormsRepository } from '@/database/repositories/formsRepository';
import { unifiedBotUserService } from '@/bots/unified/index.js';

const router = Router();
const commitAnalysisController = new CommitAnalysisController();
const formsRepository = new FormsRepository();

router.get('/latest-deployed-commit', commitAnalysisController.getLatestDeployedCommitId);

// Re-run commit analysis for an existing release ticket. Used by the "Re-run"
// button on the Release Detail screen — saves the create-delete-recreate dance
// when the user iterates on Application regex / paths config.
router.post('/re-run/:ticketId', async (req: Request, res: Response): Promise<void> => {
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

    const repoCount = await db.releaseTicketRepo.count({ where: { releaseId: ticketId } });
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
    const safeTicketId = String(ticketId).replace(/[\r\n]/g, '');
    logger.error(`[CommitAnalysis] re-run failed for ticket=${safeTicketId}: ${msg}`);
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
    const repos = await db.releaseTicketRepo.findMany({
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
    const safeReleaseId = String(releaseId).replace(/[\r\n]/g, '');
    logger.error(`[CommitAnalysis] repos fetch failed for release=${safeReleaseId}: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

router.post('/test-connection', authorize('RELEASEMANAGER', AccessType.READ), async (req: Request, res: Response): Promise<void> => {
  const { repoUrl, vcsProvider } = req.body as { repoUrl?: string; vcsProvider?: string };
  if (!repoUrl || !vcsProvider) {
    res.status(400).json({ ok: false, message: 'repoUrl and vcsProvider are required' });
    return;
  }
  if (!Object.values(VCSProviderType).includes(vcsProvider as VCSProviderType)) {
    res.status(400).json({ ok: false, message: `invalid vcsProvider: ${vcsProvider}` });
    return;
  }
  try {
    const result = await testRepoConnection({
      repoUrl,
      vcsProvider: vcsProvider as VCSProviderType,
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.json({ ok: false, message: msg });
  }
});

export default router;