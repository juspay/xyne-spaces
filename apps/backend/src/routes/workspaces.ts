import { Router } from 'express';
import { workspaceController } from '../controllers/workspaceController';
import { uploadConfig } from '../middleware/upload';

const router = Router();

// Workspace logo / profile image.
// Mutating routes are admin/owner-gated inside the controller (these bypass the
// Zero mutation ACL, so authorization is enforced here explicitly).
router.post('/:id/logo', uploadConfig.single('logo'), workspaceController.uploadLogo); // Upload/replace workspace logo
router.delete('/:id/logo', workspaceController.deleteLogo);                            // Remove workspace logo
router.get('/:id/logo', workspaceController.streamLogo);                               // Stream workspace logo (any member)

export default router;
