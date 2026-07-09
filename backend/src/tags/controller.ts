import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { TagServiceError, tagService } from './service';
import { invalidateTagConfigCache } from './pipeline';
import type {
  CreateTagBody,
  CreateTagsConfigBody,
  DeleteTagBody,
  SetManualTagsBody,
  UpdateTagBody,
  UpdateTagsConfigBody,
} from './schema';

function requireUserId(req: Request, res: Response): string | null {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return userId;
}

function requireWorkspaceId(req: Request, res: Response): string | null {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return workspaceId;
}

function mapServiceError(error: unknown): { status: number; message: string } {
  if (error instanceof TagServiceError) {
    return { status: error.status, message: error.message };
  }
  return { status: 500, message: 'Internal server error' };
}

// ─── Tags ──────────────────────────────────────────────────────────────────────

export async function listTags(req: Request, res: Response) {
  const { sourceId, sourceType, tagCategory } = req.query;

  if (typeof sourceId !== 'string' || typeof sourceType !== 'string') {
    return res.status(400).json({ error: 'sourceId and sourceType are required query params' });
  }
  if (tagCategory !== undefined && typeof tagCategory !== 'string') {
    return res.status(400).json({ error: 'tagCategory must be a string' });
  }

  try {
    const tags = await tagService.listTags(sourceId, sourceType, tagCategory);
    return res.json({ tags });
  } catch (error) {
    logger.error('[TAG][CTRL] List tags failed:', error);
    return res.status(500).json({ error: 'Failed to list tags' });
  }
}

export async function createTag(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const { sourceId, sourceType, tagCategory, tag, method, override, configKey } = req.body as CreateTagBody;

  try {
    const created = await tagService.createTag(
      sourceId,
      sourceType,
      workspaceId,
      tagCategory,
      tag,
      method,
      userId,
      override,
      configKey,
    );
    return res.status(201).json({ tag: created });
  } catch (error) {
    logger.error('[TAG][CTRL] Create tag failed:', error);
    const { status, message } = mapServiceError(error);
    return res.status(status).json({ error: message });
  }
}

export async function updateTag(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { sourceId, sourceType, tagCategory, oldTag, newTag, override, configKey } = req.body as UpdateTagBody;

  try {
    const updated = await tagService.updateTag(
      sourceId,
      sourceType,
      tagCategory,
      oldTag,
      newTag,
      userId,
      override,
      configKey,
    );
    return res.json({ tag: updated });
  } catch (error) {
    logger.error('[TAG][CTRL] Update tag failed:', error);
    const { status, message } = mapServiceError(error);
    return res.status(status).json({ error: message });
  }
}

export async function deleteTag(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { sourceId, sourceType, tagCategory, tag, override, configKey } = req.body as DeleteTagBody;

  try {
    await tagService.deleteTag(sourceId, sourceType, tagCategory, tag, userId, override, configKey);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[TAG][CTRL] Delete tag failed:', error);
    const { status, message } = mapServiceError(error);
    return res.status(status).json({ error: message });
  }
}

export async function setManualTags(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;

  const { sourceId, sourceType, tagCategory, tags, override, configKey } = req.body as SetManualTagsBody;

  try {
    const updated = await tagService.setManualTags(
      sourceId,
      sourceType,
      workspaceId,
      tagCategory,
      tags,
      userId,
      override,
      configKey,
    );
    return res.json({ tags: updated });
  } catch (error) {
    logger.error('[TAG][CTRL] Set manual tags failed:', error);
    const { status, message } = mapServiceError(error);
    return res.status(status).json({ error: message });
  }
}

// ─── Unique tag values (for Allowed Tags auto-fill) ───────────────────────────

export async function getUniqueTagValues(req: Request, res: Response) {
  const { categoryName, sourceType } = req.query;
  if (typeof categoryName !== 'string' || typeof sourceType !== 'string') {
    return res.status(400).json({ error: 'categoryName and sourceType are required query params' });
  }
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const values = await tagService.getUniqueTagValues(workspaceId, sourceType, categoryName);
    return res.json({ values });
  } catch (error) {
    logger.error('[TAG][CTRL] Get unique tag values failed:', error);
    const { status, message } = mapServiceError(error);
    return res.status(status).json({ error: message });
  }
}

// ─── TagsConfig ──────────────────────────────────────────────────────────────────

export async function getCategoriesCatalog(req: Request, res: Response) {
  const { sourceType } = req.query;

  if (typeof sourceType !== 'string') {
    return res.status(400).json({ error: 'sourceType is a required query param' });
  }

  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const catalog = await tagService.getCategoriesCatalog(sourceType, workspaceId);
    return res.json({ catalog });
  } catch (error) {
    logger.error('[TAG][CTRL] Get categories catalog failed:', error);
    const { status, message } = mapServiceError(error);
    return res.status(status).json({ error: message });
  }
}

export async function getConfig(req: Request, res: Response) {
  const { configKey } = req.params;
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const config = await tagService.getConfig(configKey);
    if (!config || config.workspaceId !== workspaceId) {
      return res.status(404).json({ error: `No active config found for configKey "${configKey}"` });
    }
    return res.json({ config });
  } catch (error) {
    logger.error('[TAG][CTRL] Get config failed:', error);
    const { status, message } = mapServiceError(error);
    return res.status(status).json({ error: message });
  }
}

export async function listConfigs(req: Request, res: Response) {
  const { sourceType } = req.query;

  if (typeof sourceType !== 'string' || sourceType.length === 0) {
    return res.status(400).json({ error: 'sourceType is required query param' });
  }

  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;

  try {
    const configs = await tagService.listConfigsBySource(sourceType, workspaceId);
    return res.json({ configs });
  } catch (error) {
    logger.error('[TAG][CTRL] List configs failed:', error);
    return res.status(500).json({ error: 'Failed to list configs' });
  }
}

export async function createConfig(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const { configKey, sourceType, config } = req.body as CreateTagsConfigBody;

  try {
    const created = await tagService.createConfig(configKey, sourceType, workspaceId, config, userId);
    await invalidateTagConfigCache(configKey);
    return res.status(201).json({ config: created });
  } catch (error) {
    logger.error('[TAG][CTRL] Create config failed:', error);
    const { status, message } = mapServiceError(error);
    return res.status(status).json({ error: message });
  }
}

export async function updateConfig(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const { configKey } = req.params;
  const { config } = req.body as UpdateTagsConfigBody;

  try {
    const existing = await tagService.getConfig(configKey);
    if (!existing || existing.workspaceId !== workspaceId) {
      return res.status(404).json({ error: `No active config found for configKey "${configKey}"` });
    }
    const updated = await tagService.updateConfig(configKey, config, userId);
    await invalidateTagConfigCache(configKey);
    return res.json({ config: updated });
  } catch (error) {
    logger.error('[TAG][CTRL] Update config failed:', error);
    const { status, message } = mapServiceError(error);
    return res.status(status).json({ error: message });
  }
}

export async function deleteConfig(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const { configKey } = req.params;

  try {
    const existing = await tagService.getConfig(configKey);
    if (!existing || existing.workspaceId !== workspaceId) {
      return res.status(404).json({ error: `No active config found for configKey "${configKey}"` });
    }
    await tagService.deleteConfig(configKey, userId);
    await invalidateTagConfigCache(configKey);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[TAG][CTRL] Delete config failed:', error);
    const { status, message } = mapServiceError(error);
    return res.status(status).json({ error: message });
  }
}
