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
  getConfig,
  listConfigs,
  createConfig,
  updateConfig,
  deleteConfig,
} from './controller';

export const tagRoutes = Router();

tagRoutes.get('/', authMiddleware.authenticate, listTags);
tagRoutes.post('/', authMiddleware.authenticate, validateZod(CreateTagBodySchema), createTag);
tagRoutes.put('/', authMiddleware.authenticate, validateZod(SetManualTagsBodySchema), setManualTags);
tagRoutes.patch('/', authMiddleware.authenticate, validateZod(UpdateTagBodySchema), updateTag);
tagRoutes.delete('/', authMiddleware.authenticate, validateZod(DeleteTagBodySchema), deleteTag);

const tagsConfigRoutes = Router();

tagsConfigRoutes.get('/', authMiddleware.authenticate, listConfigs);
tagsConfigRoutes.get('/:configKey', authMiddleware.authenticate, getConfig);
tagsConfigRoutes.post('/', authMiddleware.authenticate, validateZod(CreateTagsConfigBodySchema), createConfig);
tagsConfigRoutes.patch('/:configKey', authMiddleware.authenticate, validateZod(UpdateTagsConfigBodySchema), updateConfig);
tagsConfigRoutes.delete('/:configKey', authMiddleware.authenticate, deleteConfig);

tagRoutes.use('/configs', tagsConfigRoutes);
