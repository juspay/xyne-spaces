import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { validateZod } from '@/middleware/validation';
import {
  CreateTagBodySchema,
  CreateTagsConfigBodySchema,
  DeleteTagBodySchema,
  SetManualTagsBodySchema,
  UpdateTagBodySchema,
  UpdateTagsConfigBodySchema,
} from './schema';
import {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  setManualTags,
  getCategoriesCatalog,
  getUniqueTagValues,
  getConfig,
  listConfigs,
  createConfig,
  updateConfig,
  deleteConfig,
} from './controller';
import { DeskTagsConfigController } from '@/controllers/deskTagsConfigController';

const deskCtrl = new DeskTagsConfigController();

export const tagRoutes = Router();

tagRoutes.get('/unique-values', authMiddleware.authenticate, getUniqueTagValues);
tagRoutes.get('/', authMiddleware.authenticate, listTags);
tagRoutes.post('/', authMiddleware.authenticate, validateZod(CreateTagBodySchema), createTag);
tagRoutes.put('/', authMiddleware.authenticate, validateZod(SetManualTagsBodySchema), setManualTags);
tagRoutes.patch('/', authMiddleware.authenticate, validateZod(UpdateTagBodySchema), updateTag);
tagRoutes.delete('/', authMiddleware.authenticate, validateZod(DeleteTagBodySchema), deleteTag);

const tagsConfigRoutes = Router();

tagsConfigRoutes.get('/', authMiddleware.authenticate, listConfigs);
// Must be registered before '/:configKey' to avoid being captured as a configKey.
tagsConfigRoutes.get('/categories-catalog', authMiddleware.authenticate, getCategoriesCatalog);
tagsConfigRoutes.get('/:configKey', authMiddleware.authenticate, getConfig);
tagsConfigRoutes.post('/', authMiddleware.authenticate, validateZod(CreateTagsConfigBodySchema), createConfig);
tagsConfigRoutes.patch('/:configKey', authMiddleware.authenticate, validateZod(UpdateTagsConfigBodySchema), updateConfig);
tagsConfigRoutes.delete('/:configKey', authMiddleware.authenticate, deleteConfig);

// ─── Desk-email entity tag endpoints — /api/tags/entity/desk-email/:emailId ──
tagRoutes.get('/entity/desk-email/:emailId', authMiddleware.authenticate, deskCtrl.getDeskEmailTags);
tagRoutes.post('/entity/desk-email/:emailId', authMiddleware.authenticate, deskCtrl.addDeskEmailTag);
tagRoutes.delete('/entity/desk-email/:emailId', authMiddleware.authenticate, deskCtrl.removeDeskEmailTag);

tagRoutes.use('/configs', tagsConfigRoutes);
