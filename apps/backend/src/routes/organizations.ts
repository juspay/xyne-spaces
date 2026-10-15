import { Router } from 'express';
import { OrganizationController } from '../controllers/organizationController';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const organizationController = new OrganizationController();

// Organization Management Routes
// Platform-provisioning: mints an org OWNER and claims a domain from the body, so admin-only.
router.post('/', authMiddleware.requireAdmin, organizationController.createOrganization);
router.get('/', organizationController.getUserOrganizations);
router.get('/:orgId', organizationController.getOrganizationDetails);

// Organization Member Management Routes
router.post('/:orgId/members', organizationController.addMember);
router.put('/:orgId/members/:userId', organizationController.updateMemberRole);
router.delete('/:orgId/members/:userId', organizationController.removeMember);

export default router;