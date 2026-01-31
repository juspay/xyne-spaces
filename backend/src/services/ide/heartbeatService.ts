import { logger } from '@/utils/logger';

// Configuration
const HEARTBEAT_INTERVAL_MS = 30000; // Client should send ping every 30s
const HEARTBEAT_TIMEOUT_MS = 60000; // Consider dead after 60s without heartbeat

interface WorkspaceHeartbeat {
  workspaceId: string;
  userId: string;
  lastPing: number;
  timeoutTimer: NodeJS.Timeout | null;
}

/**
 * HeartbeatService tracks workspace activity through Socket.IO
 * Works with the websocketService for real-time heartbeat tracking
 */
class HeartbeatService {
  private workspaces: Map<string, WorkspaceHeartbeat> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic cleanup check
    this.startCleanupInterval();
  }

  /**
   * Register a workspace for heartbeat tracking
   */
  registerWorkspace(workspaceId: string, userId: string): void {
    logger.info(`[IDE-HEARTBEAT] Registering workspace ${workspaceId} for user ${userId}`);

    // Close existing tracking for this workspace if any
    const existing = this.workspaces.get(workspaceId);
    if (existing?.timeoutTimer) {
      clearTimeout(existing.timeoutTimer);
    }

    const heartbeat: WorkspaceHeartbeat = {
      workspaceId,
      userId,
      lastPing: Date.now(),
      timeoutTimer: null,
    };

    this.workspaces.set(workspaceId, heartbeat);

    logger.info(`[IDE-HEARTBEAT] Workspace ${workspaceId} registered`, {
      userId,
      totalWorkspaces: this.workspaces.size,
    });
  }

  /**
   * Record a heartbeat ping from a workspace
   */
  recordPing(workspaceId: string): boolean {
    const heartbeat = this.workspaces.get(workspaceId);
    if (!heartbeat) {
      return false;
    }

    heartbeat.lastPing = Date.now();
    return true;
  }

  /**
   * Remove a workspace from tracking
   */
  removeWorkspace(workspaceId: string): void {
    const heartbeat = this.workspaces.get(workspaceId);
    if (heartbeat?.timeoutTimer) {
      clearTimeout(heartbeat.timeoutTimer);
    }
    this.workspaces.delete(workspaceId);
    logger.info(`[IDE-HEARTBEAT] Workspace ${workspaceId} removed from tracking`);
  }

  /**
   * Check if a workspace is being tracked
   */
  isTracking(workspaceId: string): boolean {
    return this.workspaces.has(workspaceId);
  }

  /**
   * Start periodic cleanup interval for detecting stale workspaces
   */
  private startCleanupInterval(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(async () => {
      const now = Date.now();
      const staleThreshold = now - HEARTBEAT_TIMEOUT_MS;

      for (const [workspaceId, heartbeat] of this.workspaces.entries()) {
        if (heartbeat.lastPing < staleThreshold) {
          logger.warn(`[IDE-HEARTBEAT] Workspace ${workspaceId} is stale (no heartbeat for ${HEARTBEAT_TIMEOUT_MS}ms)`);
          
          // Schedule workspace for deletion with grace period
          try {
            const { workspaceService } = await import('./workspaceService');
            workspaceService.scheduleWorkspaceDeletion(workspaceId);
          } catch (error) {
            logger.error(`[IDE-HEARTBEAT] Failed to schedule workspace deletion:`, error);
          }
          
          // Remove from heartbeat tracking
          this.removeWorkspace(workspaceId);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    logger.info('[IDE-HEARTBEAT] Cleanup interval started');
  }

  /**
   * Stop the cleanup interval
   */
  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('[IDE-HEARTBEAT] Cleanup interval stopped');
    }
  }

  /**
   * Get stats about heartbeat service
   */
  getStats(): {
    activeWorkspaces: number;
    workspaceIds: string[];
  } {
    return {
      activeWorkspaces: this.workspaces.size,
      workspaceIds: Array.from(this.workspaces.keys()),
    };
  }

  /**
   * Gracefully shutdown
   */
  shutdown(): void {
    logger.info('[IDE-HEARTBEAT] Shutting down heartbeat service...');
    this.stopCleanupInterval();
    this.workspaces.clear();
    logger.info('[IDE-HEARTBEAT] Heartbeat service shutdown complete');
  }
}

// Export singleton instance
export const heartbeatService = new HeartbeatService();
