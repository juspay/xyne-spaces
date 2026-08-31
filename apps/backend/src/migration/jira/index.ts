import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { workspaceScopedRoute } from '@/database/tenant/context';
import { JiraMigrationController } from '@/controllers/jiraMigrationController';

const router = Router();
const controller = new JiraMigrationController();
const jiraMigrationAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

router.get('/boards', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.boards);
router.post('/preview', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.preview);
router.post('/resolve-users', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.resolveUsers);
router.post('/execute', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.execute);
router.post('/bulk-execute', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.bulkExecute);
router.post('/move-channel-project', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.moveChannelProject);
router.post('/move-jira-project-board', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.moveJiraProjectBoard);
router.post('/move-jira-project-channel', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.moveJiraProjectChannel);
router.post('/purge-project-migration', authMiddleware.authenticate, jiraMigrationAdminAuth, workspaceScopedRoute, controller.purgeProjectMigration);
router.post('/delete-migrated-stage-eta', authMiddleware.authenticate, jiraMigrationAdminAuth, workspaceScopedRoute, controller.deleteJiraMigratedStageEta);
router.post('/user-map/lookup', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.userMapLookup);
router.get('/status/:jobId', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.status);
router.post('/pause/:jobId', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.pause);
router.post('/resume/:jobId', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.resume);
router.post('/stop/:jobId', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.stop);
router.get('/history', authMiddleware.authenticate, jiraMigrationAdminAuth, controller.history);

export default router;
