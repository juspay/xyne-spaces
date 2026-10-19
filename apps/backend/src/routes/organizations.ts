import { Router } from 'express';
import { OrganizationController } from '../controllers/organizationController';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const organizationController = new OrganizationController();

// Organization Management Routes
// Creating an org mints an OWNER and claims a domain from the body, so restrict it to
// org admins/owners (req.user.orgRole from org_members), not any authenticated member.
router.post('/', authMiddleware.requireAdminOrOwner, organizationController.createOrganization);
router.get('/', organizationController.getUserOrganizations);
router.get('/:orgId', organizationController.getOrganizationDetails);

// Organization Member Management Routes
router.post('/:orgId/members', organizationController.addMember);
router.put('/:orgId/members/:userId', organizationController.updateMemberRole);
router.delete('/:orgId/members/:userId', organizationController.removeMember);

export default router;