import { Router } from 'express';
import { CommitAnalysisController } from '@/controllers/commitAnalysisController';

const router = Router();
const commitAnalysisController = new CommitAnalysisController();

router.get('/latest-deployed-commit', commitAnalysisController.getLatestDeployedCommitId);

export default router;