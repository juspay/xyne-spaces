import express from 'express';
import { AccessType } from '@xyne/shared';
import { TicketNamespaceController } from '../controllers/ticketNamespaceController';
import { authorize } from '@/middleware/authorize';

const router = express.Router();
const ticketNamespaceController = new TicketNamespaceController();

// Same rule as the Zero ACL (hasProjectAdminAccess): project admins only
const projectAdminAuth = authorize('LISTPROJECTS', AccessType.ADMIN);

// Create a new namespace for a project. Reads go through the Zero query
// `ticketNamespacesByProject`, not REST.
router.post('/', projectAdminAuth, ticketNamespaceController.createNamespace);

export default router;
