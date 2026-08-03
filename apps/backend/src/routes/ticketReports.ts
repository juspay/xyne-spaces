import { Router } from 'express';
import { TicketReportController } from '../controllers/ticketReportController';

const router = Router();
const ticketReportController = new TicketReportController();

router.post('/exports', ticketReportController.requestExport);
router.get('/exports/:id', ticketReportController.getExport);
router.get('/exports/:id/download', ticketReportController.downloadExport);

export default router;
