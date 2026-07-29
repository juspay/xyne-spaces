import { Router } from 'express';
import { OrganizationController } from '../controllers/organizationController';

const router = Router();
const organizationController = new OrganizationController();

// Organization Management Routes
router.post('/', organizationController.createOrganization);
router.get('/', organizationController.getUserOrganizations);
router.get('/:orgId', organizationController.getOrganizationDetails);

// Organization Member Management Routes
router.post('/:orgId/members', organizationController.addMember);
router.put('/:orgId/members/:userId', organizationController.updateMemberRole);
router.delete('/:orgId/members/:userId', organizationController.removeMember);

export default router;