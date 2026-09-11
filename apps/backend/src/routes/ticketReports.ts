import { Router } from 'express';
import { TicketReportController } from '../controllers/ticketReportController';

const router = Router();
const ticketReportController = new TicketReportController();

router.post('/exports/download', ticketReportController.downloadExport);

export default router;
