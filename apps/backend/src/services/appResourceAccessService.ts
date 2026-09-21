import { EntityUserAccess, type ShareableEntityType } from '@xyne/shared';
import { repositories } from '@/database/repositories';

/**
 * Which individual resources an installed app may act on. Deny by default — no rows means
 * no access. Grants are `entity_access` rows keyed on the `installedApps` id in the
 * polymorphic `userId` column — NOT on the app's Spaces user, which `installApp` derives
 * from a slug of the app name and then reuses by email, so two apps whose names slugify
 * alike ("Deploy Bot" and "deploy_bot") share one user and would share every grant.
 *
 * An uninstall flow, when one exists, MUST delete these: install ids are not reissued, but
 * a stale row would keep a deleted install's grant alive if one ever were.
 */
class AppResourceAccessService {
  /**
   * `findByKey`, never `entityAccessService.hasActiveShare` — that also matches group and
   * channel grants, and the app's bot user is a real `User` that sits in channels, so
   * anything shared with such a channel would silently become reachable.
   */
  async isAttached(params: {
    workspaceId: string;
    installedAppId: string;
    entityType: ShareableEntityType;
    entityId: string;
  }): Promise<boolean> {
    const grant = await repositories.entityAccess.findByKey({
      workspaceId: params.workspaceId,
      shareableEntityType: params.entityType,
      entityId: params.entityId,
      userId: params.installedAppId,
    });
    return grant !== null && grant.entityUserAccess !== EntityUserAccess.REVOKED;
  }

  async listAttachedIds(params: {
    workspaceId: string;
    installedAppId: string;
    entityType: ShareableEntityType;
  }): Promise<string[]> {
    const grants = await repositories.entityAccess.findActiveByUser({
      workspaceId: params.workspaceId,
      shareableEntityType: params.entityType,
      userId: params.installedAppId,
    });
    return grants.map(grant => grant.entityId);
  }

  /** VIEW always — the level is never read; {@link isAttached} tests presence. */
  async applyAttachmentChanges(params: {
    workspaceId: string;
    installedAppId: string;
    entityType: ShareableEntityType;
    added: string[];
    removed: string[];
  }): Promise<void> {
    await repositories.entityAccess.applyDeltaForUser({
      workspaceId: params.workspaceId,
      shareableEntityType: params.entityType,
      userId: params.installedAppId,
      added: params.added,
      removed: params.removed,
      entityUserAccess: EntityUserAccess.VIEW,
    });
  }
}

export const appResourceAccessService = new AppResourceAccessService();
