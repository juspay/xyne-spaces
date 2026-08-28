import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { BundleOverrideService, BundleType } from '@/services/bundleOverrideService';

const VALID_TYPES: BundleType[] = ['version', 'bundle'];

/**
 * Bundle version resolution + per-user override administration.
 *
 * The backend NO LONGER streams bundle files — nginx streams them directly from
 * GCS. The backend only answers "which bundle does this user get?": nginx calls
 * getVersion() (forwarding the user's auth cookie) to decide what to serve, and
 * admins manage the per-user override table via the admin* handlers.
 */
export class BundleController {
  /**
   * Resolve the bundle (version or folder) for the authenticated user.
   * Route: GET /api/bundles/version  (optionalAuthenticate)
   *
   * userId comes from the VERIFIED JWT (req.user.id, cookie or bearer). If the
   * user has an enabled override it is returned; otherwise the baked default
   * version. Anonymous / invalid token -> default. Always 200 with { type, value }
   * so nginx has a deterministic answer.
   */
  public static async getVersion(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const resolved = await BundleOverrideService.resolveBundle(userId);

    logger.info('[BundleVersion] Resolved', {
      userId: userId ?? 'anonymous',
      authenticated: !!userId,
      type: resolved.type,
      value: resolved.value,
    });

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({ success: true, ...resolved, timestamp: new Date().toISOString() });
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD for per-user bundle overrides.
  // Workspace/org ADMIN or OWNER only (see routes); scoped to the caller's
  // workspace by the tenant ACL layer, with explicit workspace checks below.
  // ---------------------------------------------------------------------------

  /** GET /api/bundles/admin/overrides */
  public static async listOverrides(_req: Request, res: Response): Promise<void> {
    try {
      const overrides = await BundleOverrideService.list();
      res.json({
        success: true,
        data: { overrides, default: BundleOverrideService.getDefault() },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[BundleOverride] listOverrides error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list bundle overrides',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** POST /api/bundles/admin/overrides  body: { userId, type, value, enabled?, note? } */
  public static async upsertOverride(req: Request, res: Response): Promise<void> {
    try {
      const { userId, type, value, enabled, note } = req.body ?? {};

      if (
        !userId ||
        typeof userId !== 'string' ||
        !value ||
        typeof value !== 'string' ||
        typeof type !== 'string' ||
        !VALID_TYPES.includes(type as BundleType)
      ) {
        res.status(400).json({
          success: false,
          error: `userId and value are required strings, and type must be one of: ${VALID_TYPES.join(', ')}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Reject values that would escape a GCS prefix (folder / path traversal).
      if (value.includes('..') || value.includes('/')) {
        res.status(400).json({
          success: false,
          error: 'Invalid value',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Workspace isolation: the target user must belong to the caller's
      // workspace. Resolved via the userService so an arbitrary userId cannot be
      // attached to another workspace's override.
      const { UserService } = await import('@/services/userService');
      const targetUser = await new UserService().getUserById(userId);
      if (!targetUser || targetUser.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({
          success: false,
          error: 'User not found in your workspace',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const override = await BundleOverrideService.upsert({
        userId,
        workspaceId: targetUser.workspaceId,
        type: type as BundleType,
        value,
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
        note: typeof note === 'string' ? note : null,
      });

      res.json({ success: true, data: override, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error('[BundleOverride] upsertOverride error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to save bundle override',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** DELETE /api/bundles/admin/overrides/:userId */
  public static async deleteOverride(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const existing = await BundleOverrideService.getByUserId(userId);

      // 404 when absent OR in another workspace (defense-in-depth over the ACL layer).
      if (!existing || existing.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({
          success: false,
          error: 'Override not found',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      await BundleOverrideService.remove(userId);
      res.json({ success: true, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error('[BundleOverride] deleteOverride error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete bundle override',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
