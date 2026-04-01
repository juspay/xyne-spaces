import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { TeamIntelligenceReportController } from '@/controllers/teamIntelligenceReportController';

const router = Router();
const controller = new TeamIntelligenceReportController();

router.post('/', authMiddleware.authenticate, controller.createReport);
router.get('/', authMiddleware.authenticate, controller.listReports);
router.get('/:reportId/pdf', authMiddleware.authenticate, controller.downloadPdf);
router.get('/:reportId', authMiddleware.authenticate, controller.getReport);

export default router;
