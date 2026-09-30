import express from 'express';
import { TicketNamespaceController } from '../controllers/ticketNamespaceController';

const router = express.Router();
const ticketNamespaceController = new TicketNamespaceController();

// Create a new namespace for a project. Reads go through the Zero query
// `ticketNamespacesByProject`, not REST.
router.post('/', ticketNamespaceController.createNamespace);

export default router;
