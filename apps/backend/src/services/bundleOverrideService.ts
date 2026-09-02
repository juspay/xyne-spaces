import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';

/**
 * What a resolved bundle points at:
 *   - type "version" -> value is a semantic version (e.g. "1.216.0")
 *   - type "bundle"  -> value is a named bundle folder (e.g. "beta-v2")
 * nginx uses (type, value) to pick which bundle to stream from GCS.
 */
export type BundleType = 'version' | 'bundle';
export interface ResolvedBundle {
  type: BundleType;
  value: string;
}

/**
 * The DEFAULT bundle version, baked into the backend build by semantic-release
 * (BUNDLE_DEFAULT_VERSION). Falls back to npm_package_version, then "default".
 * Returned for any user without an enabled override row.
 */
function getDefaultVersion(): string {
  return process.env.BUNDLE_DEFAULT_VERSION || process.env.npm_package_version || 'default';
}

/**
 * Resolves which frontend bundle (version or folder) a user should get, and
 * provides workspace-scoped CRUD for the per-user override table.
 *
 * Resolution:
 *  - enabled override row for the userId -> { type, value } from the row.
 *  - otherwise (no user, no row, disabled, or lookup error) -> the baked
 *    default version.
 */
export class BundleOverrideService {
  private static db() {
    return DatabaseClient.getInstance();
  }

  /** The default bundle everyone gets without an override. */
  static getDefault(): ResolvedBundle {
    return { type: 'version', value: getDefaultVersion() };
  }

  /**
   * Resolve the bundle for a user id. Never throws — on any lookup error it
   * returns the baked default so serving still works.
   */
  static async resolveBundle(userId?: string | null): Promise<ResolvedBundle> {
    const fallback = this.getDefault();
    if (!userId) {
      return fallback;
    }

    try {
      const override = await this.db().userBundleOverride.findUnique({
        where: { userId },
      });

      if (override && override.enabled) {
        logger.info('[BundleOverride] Override hit', {
          userId,
          type: override.type,
          value: override.value,
        });
        return { type: override.type as BundleType, value: override.value };
      }

      if (override && !override.enabled) {
        logger.info('[BundleOverride] Override disabled — using default', {
          userId,
          disabledValue: override.value,
        });
      } else {
        logger.info('[BundleOverride] No override — using default', { userId });
      }
    } catch (error) {
      // DB-layer fallback: never let a lookup failure break resolution.
      logger.error('[BundleOverride] Lookup failed — using default', {
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
    type: BundleType;
    value: string;
    enabled?: boolean;
    note?: string | null;
  }) {
    const { userId, workspaceId, type, value, enabled = true, note = null } = params;
    return this.db().userBundleOverride.upsert({
      where: { userId },
      create: { userId, workspaceId, type, value, enabled, note },
      update: { type, value, enabled, note },
    });
  }

  static async remove(userId: string) {
    return this.db().userBundleOverride.delete({ where: { userId } });
  }
}
