import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';

// Fixed default bundle folder in the GCS bundle bucket. Users with no enabled
// override row are served from here.
const DEFAULT_BUNDLE_FOLDER = 'default';

/**
 * Resolves which frontend bundle folder (in the GCS bundle bucket) a given
 * user should be served, and provides CRUD for the per-user override table.
 *
 * Resolution rules:
 *  - If a UserBundleOverride row exists for the userId with enabled=true,
 *    serve that row's bundleName.
 *  - Otherwise (no user, no row, or disabled) serve the configured default
 *    (DEFAULT_BUNDLE_NAME, falling back to "default").
 */
export class BundleOverrideService {
  private static db() {
    return DatabaseClient.getInstance();
  }

  static getDefaultBundleName(): string {
    return DEFAULT_BUNDLE_FOLDER;
  }

  /**
   * Resolve the bundle folder for a user id. Never throws — on any lookup
   * error it falls back to the default bundle so the app still loads.
   */
  static async resolveBundleName(userId?: string | null): Promise<string> {
    const fallback = this.getDefaultBundleName();
    if (!userId) {
      return fallback;
    }

    try {
      const override = await this.db().userBundleOverride.findUnique({
        where: { userId },
      });

      if (override && override.enabled) {
        logger.info('[BundleOverride] Override hit — serving custom bundle', {
          userId,
          bundleName: override.bundleName,
        });
        return override.bundleName;
      }

      if (override && !override.enabled) {
        logger.info('[BundleOverride] Override row disabled — serving default', {
          userId,
          disabledBundle: override.bundleName,
        });
      } else {
        logger.info('[BundleOverride] No override for user — serving default', { userId });
      }
    } catch (error) {
      // DB-layer fallback: never let an override lookup failure break serving.
      logger.error('[BundleOverride] Lookup failed — falling back to default bundle', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return fallback;
  }

  static async list() {
    return this.db().userBundleOverride.findMany({
      orderBy: { updatedAt: 'desc' },
    });
  }

  static async getByUserId(userId: string) {
    return this.db().userBundleOverride.findUnique({ where: { userId } });
  }

  /** Create or update the override for a user (idempotent on userId). */
  static async upsert(params: {
    userId: string;
    workspaceId: string;
    bundleName: string;
    enabled?: boolean;
    note?: string | null;
  }) {
    const { userId, workspaceId, bundleName, enabled = true, note = null } = params;
    return this.db().userBundleOverride.upsert({
      where: { userId },
      create: { userId, workspaceId, bundleName, enabled, note },
      update: { bundleName, enabled, note },
    });
  }

  static async remove(userId: string) {
    return this.db().userBundleOverride.delete({ where: { userId } });
  }
}
