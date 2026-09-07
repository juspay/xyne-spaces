import express from 'express';
import { SubTicketController } from '../controllers/subTicketController';

const router = express.Router();
const subTicketController = new SubTicketController();

// Link an existing ticket as a sub-ticket, and undo that link.
router.post('/link', subTicketController.linkExisting);
router.post('/unlink', subTicketController.unlink);

export default router;
