import { Request, Response, NextFunction } from 'express';
import { userStatusService } from '../services/userStatusService';
import { logger } from '../utils/logger';

export interface ActivityTrackerOptions {
  enabled?: boolean;
  excludePaths?: string[];
  excludeMethods?: string[];
  debounceMs?: number;
}

class ActivityTracker {
  private lastActivityUpdate: Map<string, number> = new Map();
  private options: Required<ActivityTrackerOptions>;

  constructor(options: ActivityTrackerOptions = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      excludePaths: options.excludePaths ?? [
        '/api/health',
        '/api/metrics',
        '/api/user-status/activity', // Avoid recursive calls
        '/api/socket.io'
      ],
      excludeMethods: options.excludeMethods ?? ['OPTIONS'],
      debounceMs: options.debounceMs ?? 30000 // 30 seconds debounce
    };
  }

  // Middleware function to track user activity
  middleware = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // Skip if disabled
      if (!this.options.enabled) {
        next();
        return;
      }

      // Skip excluded methods
      if (this.options.excludeMethods.includes(req.method)) {
        next();
        return;
      }

      // Skip excluded paths
      const isExcludedPath = this.options.excludePaths.some(path =>
        req.path.startsWith(path)
      );

      if (isExcludedPath) {
        next();
        return;
      }

      // Skip if no authenticated user
      const userId = req.user?.id;
      if (!userId) {
        next();
        return;
      }

      // Check debounce - only update activity if enough time has passed
      const now = Date.now();
      const lastUpdate = this.lastActivityUpdate.get(userId) || 0;

      if (now - lastUpdate < this.options.debounceMs) {
        next();
        return;
      }

      // Update activity asynchronously (don't block the request)
      this.updateUserActivity(req, userId)
        .catch(error => {
          logger.error('❌ [ACTIVITY-TRACKER] Error updating user activity:', error);
        });

      // Update debounce timestamp
      this.lastActivityUpdate.set(userId, now);

      next();
    } catch (error) {
      logger.error('❌ [ACTIVITY-TRACKER] Error in activity tracker middleware:', error);
      next(); // Continue even if tracking fails
    }
  };

  private async updateUserActivity(req: Request, userId: string): Promise<void> {
    try {
      const deviceInfo = `${req.headers['user-agent']?.substring(0, 100) || 'Unknown'} - ${req.ip}`;

      // Update user activity (extends online time)
      await userStatusService.updateUserActivity(userId, deviceInfo);

      logger.debug(`🔄 [ACTIVITY-TRACKER] Updated activity for user ${userId} on ${req.method} ${req.path}`);
    } catch (error) {
      logger.error('❌ [ACTIVITY-TRACKER] Error updating user activity:', error);
    }
  }

  // Cleanup method to remove old debounce entries
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - (this.options.debounceMs * 2); // Clean entries older than 2x debounce time

    for (const [userId, timestamp] of this.lastActivityUpdate.entries()) {
      if (timestamp < cutoff) {
        this.lastActivityUpdate.delete(userId);
      }
    }
  }

  // Get current configuration
  getConfig(): Required<ActivityTrackerOptions> {
    return { ...this.options };
  }

  // Update configuration
  updateConfig(newOptions: Partial<ActivityTrackerOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }

  // Get activity statistics
  getStats(): {
    trackedUsers: number;
    lastCleanup: number;
    config: Required<ActivityTrackerOptions>;
  } {
    return {
      trackedUsers: this.lastActivityUpdate.size,
      lastCleanup: Date.now(),
      config: this.getConfig()
    };
  }
}

// Export singleton instance
export const activityTracker = new ActivityTracker({
  enabled: process.env.NODE_ENV !== 'test', // Disable in tests
  debounceMs: 30000 // 30 seconds
});

// Export middleware function for easy use
export const trackActivity = activityTracker.middleware;

// Cleanup function to be called periodically
export const cleanupActivityTracker = (): void => {
  activityTracker.cleanup();
};

// Setup periodic cleanup (every 5 minutes)
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    cleanupActivityTracker();
  }, 5 * 60 * 1000); // 5 minutes
}