import { type Request, type Response } from 'express';
import { repositories } from '@/database/repositories';
import { appResourceAccessService } from '@/services/appResourceAccessService';
import { attachableResourceFor, type AttachableResource } from '../core/attachableResources';
import { logger } from '@/utils/logger';

type Resolved = { install: { id: string }; resource: AttachableResource };

export class AppResourceController {
  /** Scoped through the owning user's workspace, as the permission routes do — another
   *  workspace's install is a 404, not a 403. */
  private async resolve(req: Request, res: Response): Promise<Resolved | null> {
    const { installedAppId, resourceType } = req.params;
    const workspaceId = req.user?.workspaceId;
    if (!installedAppId || !resourceType || !workspaceId) {
      res.status(400).json({ error: 'installedAppId, resourceType and workspace are required' });
      return null;
    }

    const resource = attachableResourceFor(resourceType);
    if (!resource) {
      res.status(404).json({ error: `Unknown resource type "${resourceType}"` });
      return null;
    }

    const install = await repositories.installedApps.findFirst({
      where: { id: installedAppId, user: { workspaceId } },
    });
    if (!install) {
      res.status(404).json({ error: 'Installed app not found in this workspace' });
      return null;
    }

    return { install, resource };
  }

  /** `describe` also filters, so a grant whose target was deleted drops out of the UI. */
  private async currentItems(
    installedAppId: string,
    workspaceId: string,
    resource: AttachableResource,
  ): Promise<{ id: string; name: string }[]> {
    const ids = await appResourceAccessService.listAttachedIds({
      workspaceId,
      installedAppId,
      entityType: resource.entityType,
    });
    return ids.length ? resource.describe(ids, workspaceId) : [];
  }

  listAttached = async (req: Request, res: Response): Promise<void> => {
    try {
      const resolved = await this.resolve(req, res);
      if (!resolved) return;
      const { install, resource } = resolved;
      const items = await this.currentItems(install.id, req.user!.workspaceId, resource);
      res.json({ resourceType: resource.kind, items });
    } catch (error) {
      logger.error('Error listing attached resources:', error);
      res.status(500).json({ error: 'Failed to list attached resources' });
    }
  };

  /**
   * A delta rather than the whole set, so an admin saving a stale page only changes what
   * they touched. Takes effect immediately — there is no approval step. An id in both
   * arrays ends up attached, since the repository deletes before it creates.
   */
  setAttached = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as { added?: unknown; removed?: unknown };
      const ids = (value: unknown): string[] | null => {
        if (value === undefined) return [];
        if (!Array.isArray(value)) return null;
        if (value.some(id => typeof id !== 'string' || id.length === 0)) return null;
        return [...new Set(value as string[])];
      };

      const added = ids(body?.added);
      const removed = ids(body?.removed);
      if (added === null || removed === null) {
        res.status(400).json({ error: 'added and removed must be arrays of ids' });
        return;
      }
      const resolved = await this.resolve(req, res);
      if (!resolved) return;
      const { install, resource } = resolved;
      const workspaceId = req.user!.workspaceId;
      const actorId = req.user!.id;

      // Additions only: removing something already deleted is how an orphan gets pruned.
      if (added.length) {
        const found = await resource.describe(added, workspaceId);
        const missing = added.filter(id => !found.some(row => row.id === id));
        if (missing.length) {
          res.status(400).json({ error: `Unknown ${resource.kind}`, entityIds: missing });
          return;
        }
      }

      await appResourceAccessService.applyAttachmentChanges({
        workspaceId,
        installedAppId: install.id,
        entityType: resource.entityType,
        added,
        removed,
      });

      const items = await this.currentItems(install.id, workspaceId, resource);
      logger.info(
        `[APP-RESOURCES] install ${install.id} ${resource.kind}: +${added.length} -${removed.length} by ${actorId}`,
      );
      res.json({ resourceType: resource.kind, items });
    } catch (error) {
      logger.error('Error updating attached resources:', error);
      res.status(500).json({ error: 'Failed to update attached resources' });
    }
  };
}
