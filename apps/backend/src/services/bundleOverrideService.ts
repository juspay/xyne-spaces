import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

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
    return config.gcs.defaultBundleName || 'default';
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
        logger.info(`[BundleOverride] Serving override bundle for user ${userId}: ${override.bundleName}`);
        return override.bundleName;
      }
    } catch (error) {
      logger.error(`[BundleOverride] Failed to resolve bundle for user ${userId}, using default:`, error);
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
    bundleName: string;
    enabled?: boolean;
    note?: string | null;
  }) {
    const { userId, bundleName, enabled = true, note = null } = params;
    return this.db().userBundleOverride.upsert({
      where: { userId },
      create: { userId, bundleName, enabled, note },
      update: { bundleName, enabled, note },
    });
  }

  static async remove(userId: string) {
    return this.db().userBundleOverride.delete({ where: { userId } });
  }
}
