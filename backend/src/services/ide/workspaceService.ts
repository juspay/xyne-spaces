import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import simpleGit from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Configuration
const MAX_WORKSPACES_PER_USER = 50;
// Use project directory for workspaces (Podman on macOS can't access /tmp)
const WORKSPACE_BASE_PATH = process.env.CODE_SERVER_WORKSPACE_PATH || '/Users/anurag.dwivedi/work_dir/xyne-spaces/.workspaces';
const CODE_SERVER_INTERNAL_PATH = '/home/coder/workspaces'; // Path inside code-server container
const CODE_SERVER_URL = process.env.CODE_SERVER_URL || 'http://localhost:8443';
const WORKSPACE_TTL_SECONDS = 3600; // 1 hour TTL for workspace tracking
const CLEANUP_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes grace period before cleanup

export interface WorkspaceInfo {
  id: string;
  userId: string;
  repoUrl: string;
  branch: string;
  localPath: string;
  codeServerPath: string;
  createdAt: number;
  lastHeartbeat: number;
}

export interface CreateWorkspaceRequest {
  repoUrl: string;
  branch: string;
  userId: string;
}

export interface CreateWorkspaceResponse {
  workspaceId: string;
  codeServerUrl: string;
  workspace: WorkspaceInfo;
}

class WorkspaceService {
  /**
   * Get Redis key for user's workspace list
   */
  private getUserWorkspacesKey(userId: string): string {
    return `ide:workspaces:${userId}`;
  }

  /**
   * Get Redis key for workspace info
   */
  private getWorkspaceKey(workspaceId: string): string {
    return `ide:workspace:${workspaceId}`;
  }

  /**
   * Convert SSH URL to HTTPS with credentials for cloning
   * Currently hardcoded to xyne-spaces repo - will need to be generalized for other repos
   */
  private getAuthenticatedCloneUrl(_repoUrl: string): string {
    const username = process.env.BITBUCKET_USERNAME;
    const auth = process.env.BITBUCKET_AUTH;

    if (!username || !auth) {
      logger.warn('[IDE] Bitbucket credentials not configured, clone may fail for private repos');
      return _repoUrl;
    }

    // TODO: Generalize this for other repos when needed
    // For now, hardcoded to xyne-spaces repo with correct /scm/ path for Bitbucket Server
    return `https://${encodeURIComponent(username)}:${encodeURIComponent(auth)}@bitbucket.juspay.net/scm/xyne/xyne-spaces.git`;
  }

  /**
   * Extract repo name from URL for folder naming
   */
  private extractRepoName(repoUrl: string): string {
    // Extract repo name from various URL formats
    const match = repoUrl.match(/\/([^\/]+?)(\.git)?$/);
    return match ? match[1] : 'repo';
  }

  /**
   * Get count of active workspaces for a user
   */
  async getUserWorkspaceCount(userId: string): Promise<number> {
    const key = this.getUserWorkspacesKey(userId);
    const workspaces = await redisService.getAllHashFields(key);
    return Object.keys(workspaces).length;
  }

  /**
   * Get all workspaces for a user
   */
  async getUserWorkspaces(userId: string): Promise<WorkspaceInfo[]> {
    const key = this.getUserWorkspacesKey(userId);
    const workspaceIds = await redisService.getAllHashFields(key);
    
    const workspaces: WorkspaceInfo[] = [];
    for (const workspaceId of Object.keys(workspaceIds)) {
      const workspace = await this.getWorkspace(workspaceId);
      if (workspace) {
        workspaces.push(workspace);
      }
    }

    // Sort by createdAt (oldest first for potential eviction)
    return workspaces.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get workspace info by ID
   */
  async getWorkspace(workspaceId: string): Promise<WorkspaceInfo | null> {
    const key = this.getWorkspaceKey(workspaceId);
    const data = await redisService.getHashField(key, 'info');
    
    if (!data) return null;
    
    try {
      return JSON.parse(data) as WorkspaceInfo;
    } catch {
      return null;
    }
  }

  /**
   * Find existing workspace for same repo+branch combination
   * Returns the workspace if it exists and files are still present
   */
  async findExistingWorkspace(userId: string, repoUrl: string, branch: string): Promise<WorkspaceInfo | null> {
    const workspaces = await this.getUserWorkspaces(userId);
    
    for (const workspace of workspaces) {
      if (workspace.repoUrl === repoUrl && workspace.branch === branch) {
        // Verify files still exist
        try {
          await fs.access(workspace.localPath);
          logger.info(`[IDE] Found existing workspace ${workspace.id} for ${repoUrl}@${branch}`);
          return workspace;
        } catch {
          // Files don't exist, clean up this stale entry
          logger.warn(`[IDE] Workspace ${workspace.id} has stale Redis entry, cleaning up`);
          await this.deleteWorkspace(workspace.id);
        }
      }
    }
    
    return null;
  }

  /**
   * Create a new workspace - clone repo and checkout branch
   * If workspace for same repo+branch exists, reuse it
   */
  async createWorkspace(request: CreateWorkspaceRequest): Promise<CreateWorkspaceResponse> {
    const { repoUrl, branch, userId } = request;

    // First, check if we already have a workspace for this repo+branch
    const existingWorkspace = await this.findExistingWorkspace(userId, repoUrl, branch);
    if (existingWorkspace) {
      // Refresh the heartbeat/TTL
      await this.updateHeartbeat(existingWorkspace.id);
      
      const codeServerUrl = `${CODE_SERVER_URL}/?folder=${encodeURIComponent(existingWorkspace.codeServerPath)}`;
      
      logger.info(`[IDE] Reusing existing workspace ${existingWorkspace.id}`, { codeServerUrl });
      
      return {
        workspaceId: existingWorkspace.id,
        codeServerUrl,
        workspace: existingWorkspace,
      };
    }

    // Check user's workspace count
    const currentCount = await this.getUserWorkspaceCount(userId);
    if (currentCount >= MAX_WORKSPACES_PER_USER) {
      throw new Error(
        `Maximum workspace limit reached (${MAX_WORKSPACES_PER_USER}). ` +
        `Please close existing workspaces before opening new ones.`
      );
    }

    const workspaceId = uuidv4();
    const repoName = this.extractRepoName(repoUrl);
    const folderName = `${repoName}-${branch.replace(/\//g, '-')}-${workspaceId.slice(0, 8)}`;
    const localPath = path.join(WORKSPACE_BASE_PATH, userId, folderName);
    const codeServerPath = path.join(CODE_SERVER_INTERNAL_PATH, userId, folderName);

    logger.info(`[IDE] Creating workspace ${workspaceId} for user ${userId}`, {
      repoUrl,
      branch,
      localPath,
    });

    try {
      // Ensure base directory exists
      await fs.mkdir(path.dirname(localPath), { recursive: true });

      // Clone repository with credentials
      const cloneUrl = this.getAuthenticatedCloneUrl(repoUrl);
      const git = simpleGit();
      
      logger.info(`[IDE] Cloning repository...`);
      await git.clone(cloneUrl, localPath, ['--depth', '1', '--branch', branch]);

      // Navigate to the cloned repo and verify
      const repoGit = simpleGit(localPath);
      await repoGit.checkout(branch);

      const workspace: WorkspaceInfo = {
        id: workspaceId,
        userId,
        repoUrl,
        branch,
        localPath,
        codeServerPath,
        createdAt: Date.now(),
        lastHeartbeat: Date.now(),
      };

      // Store workspace info in Redis
      const workspaceKey = this.getWorkspaceKey(workspaceId);
      await redisService.setHashField(workspaceKey, 'info', JSON.stringify(workspace), WORKSPACE_TTL_SECONDS);

      // Add to user's workspace list
      const userKey = this.getUserWorkspacesKey(userId);
      await redisService.setHashField(userKey, workspaceId, Date.now().toString(), WORKSPACE_TTL_SECONDS);

      // Build code-server URL with folder parameter
      const codeServerUrl = `${CODE_SERVER_URL}/?folder=${encodeURIComponent(codeServerPath)}`;

      logger.info(`[IDE] Workspace ${workspaceId} created successfully`, {
        codeServerUrl,
      });

      return {
        workspaceId,
        codeServerUrl,
        workspace,
      };
    } catch (error) {
      // Cleanup on failure
      logger.error(`[IDE] Failed to create workspace ${workspaceId}:`, error);
      
      try {
        await fs.rm(localPath, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.error(`[IDE] Failed to cleanup workspace directory:`, cleanupError);
      }

      throw error;
    }
  }

  /**
   * Update heartbeat timestamp for a workspace
   */
  async updateHeartbeat(workspaceId: string): Promise<boolean> {
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace) {
      return false;
    }

    workspace.lastHeartbeat = Date.now();

    // Update in Redis with refreshed TTL
    const workspaceKey = this.getWorkspaceKey(workspaceId);
    await redisService.setHashField(workspaceKey, 'info', JSON.stringify(workspace), WORKSPACE_TTL_SECONDS);

    // Refresh user's workspace list TTL
    const userKey = this.getUserWorkspacesKey(workspace.userId);
    await redisService.setHashField(userKey, workspaceId, Date.now().toString(), WORKSPACE_TTL_SECONDS);

    return true;
  }

  /**
   * Delete a workspace and cleanup files
   */
  async deleteWorkspace(workspaceId: string): Promise<boolean> {
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace) {
      logger.warn(`[IDE] Workspace ${workspaceId} not found for deletion`);
      return false;
    }

    logger.info(`[IDE] Deleting workspace ${workspaceId}`, {
      userId: workspace.userId,
      localPath: workspace.localPath,
    });

    try {
      // Delete files
      await fs.rm(workspace.localPath, { recursive: true, force: true });
    } catch (error) {
      logger.error(`[IDE] Failed to delete workspace files:`, error);
    }

    // Remove from Redis
    const workspaceKey = this.getWorkspaceKey(workspaceId);
    await redisService.del(workspaceKey);

    // Remove from user's workspace list
    const userKey = this.getUserWorkspacesKey(workspace.userId);
    await redisService.deleteHashField(userKey, workspaceId);

    logger.info(`[IDE] Workspace ${workspaceId} deleted successfully`);
    return true;
  }

  /**
   * Delete oldest workspace for a user (for FIFO eviction)
   */
  async deleteOldestWorkspace(userId: string): Promise<string | null> {
    const workspaces = await this.getUserWorkspaces(userId);
    if (workspaces.length === 0) {
      return null;
    }

    const oldest = workspaces[0];
    await this.deleteWorkspace(oldest.id);
    return oldest.id;
  }

  // Track scheduled deletions to allow cancellation on reconnect
  private scheduledDeletions: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Schedule a workspace for deletion after grace period
   * Can be cancelled if user reconnects
   */
  scheduleWorkspaceDeletion(workspaceId: string): void {
    // Cancel any existing scheduled deletion
    this.cancelScheduledDeletion(workspaceId);

    logger.info(`[IDE] Scheduling workspace ${workspaceId} for deletion in ${CLEANUP_GRACE_PERIOD_MS / 1000}s`);

    const timer = setTimeout(async () => {
      logger.info(`[IDE] Grace period expired, deleting workspace ${workspaceId}`);
      await this.deleteWorkspace(workspaceId);
      this.scheduledDeletions.delete(workspaceId);
    }, CLEANUP_GRACE_PERIOD_MS);

    this.scheduledDeletions.set(workspaceId, timer);
  }

  /**
   * Cancel a scheduled workspace deletion (e.g., user reconnected)
   */
  cancelScheduledDeletion(workspaceId: string): boolean {
    const timer = this.scheduledDeletions.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.scheduledDeletions.delete(workspaceId);
      logger.info(`[IDE] Cancelled scheduled deletion for workspace ${workspaceId}`);
      return true;
    }
    return false;
  }

  /**
   * Cleanup stale workspaces (no heartbeat for > timeout)
   * This checks all tracked workspaces and deletes those with old heartbeats
   */
  // async cleanupStaleWorkspaces(timeoutMs: number = WORKSPACE_TTL_SECONDS * 1000): Promise<string[]> {
  //   const cleaned: string[] = [];
  //   const now = Date.now();

  //   // Scan all workspace keys in Redis
  //   try {
  //     const keys = await redisService.scanKeys('ide:workspace:*');
      
  //     for (const key of keys) {
  //       const data = await redisService.getHashField(key, 'info');
  //       if (!data) continue;

  //       try {
  //         const workspace = JSON.parse(data) as WorkspaceInfo;
  //         const timeSinceHeartbeat = now - workspace.lastHeartbeat;

  //         if (timeSinceHeartbeat > timeoutMs) {
  //           logger.info(`[IDE] Workspace ${workspace.id} is stale (${timeSinceHeartbeat}ms since last heartbeat)`);
  //           await this.deleteWorkspace(workspace.id);
  //           cleaned.push(workspace.id);
  //         }
  //       } catch {
  //         // Invalid JSON, clean up the key
  //         await redisService.del(key);
  //       }
  //     }
  //   } catch (error) {
  //     logger.error('[IDE] Error during stale workspace cleanup:', error);
  //   }

  //   if (cleaned.length > 0) {
  //     logger.info(`[IDE] Stale workspace cleanup completed`, { cleaned: cleaned.length, workspaceIds: cleaned });
  //   }

  //   return cleaned;
  // }

  /**
   * Cleanup orphaned workspace directories that have no Redis entry
   * Call this on backend startup to clean up any leftover files
   */
  // async cleanupOrphanedWorkspaces(): Promise<string[]> {
  //   const cleaned: string[] = [];

  //   try {
  //     // Check if base path exists
  //     try {
  //       await fs.access(WORKSPACE_BASE_PATH);
  //     } catch {
  //       logger.info('[IDE] Workspace base path does not exist, nothing to clean up');
  //       return cleaned;
  //     }

  //     // Get all user directories
  //     const userDirs = await fs.readdir(WORKSPACE_BASE_PATH, { withFileTypes: true });

  //     for (const userDir of userDirs) {
  //       if (!userDir.isDirectory()) continue;

  //       const userPath = path.join(WORKSPACE_BASE_PATH, userDir.name);
  //       const workspaceDirs = await fs.readdir(userPath, { withFileTypes: true });

  //       for (const wsDir of workspaceDirs) {
  //         if (!wsDir.isDirectory()) continue;

  //         const workspacePath = path.join(userPath, wsDir.name);

  //         // Check if this workspace has a corresponding Redis entry
  //         // The workspace ID is the last part of the folder name (after the last -)
  //         const folderParts = wsDir.name.split('-');
  //         const workspaceIdFragment = folderParts[folderParts.length - 1];

  //         // Search for a workspace with this ID fragment
  //         let hasRedisEntry = false;
  //         const keys = await redisService.scanKeys(`ide:workspace:*${workspaceIdFragment}*`);
          
  //         if (keys.length > 0) {
  //           // Verify the workspace info matches this path
  //           for (const key of keys) {
  //             const data = await redisService.getHashField(key, 'info');
  //             if (data) {
  //               const workspace = JSON.parse(data) as WorkspaceInfo;
  //               if (workspace.localPath === workspacePath) {
  //                 hasRedisEntry = true;
  //                 break;
  //               }
  //             }
  //           }
  //         }

  //         if (!hasRedisEntry) {
  //           logger.info(`[IDE] Found orphaned workspace directory: ${workspacePath}`);
  //           try {
  //             await fs.rm(workspacePath, { recursive: true, force: true });
  //             cleaned.push(workspacePath);
  //             logger.info(`[IDE] Deleted orphaned workspace: ${workspacePath}`);
  //           } catch (error) {
  //             logger.error(`[IDE] Failed to delete orphaned workspace ${workspacePath}:`, error);
  //           }
  //         }
  //       }

  //       // Remove empty user directories
  //       try {
  //         const remainingDirs = await fs.readdir(userPath);
  //         if (remainingDirs.length === 0) {
  //           await fs.rmdir(userPath);
  //           logger.info(`[IDE] Removed empty user directory: ${userPath}`);
  //         }
  //       } catch {
  //         // Ignore errors removing empty dirs
  //       }
  //     }
  //   } catch (error) {
  //     logger.error('[IDE] Error during orphaned workspace cleanup:', error);
  //   }

  //   if (cleaned.length > 0) {
  //     logger.info(`[IDE] Orphaned workspace cleanup completed`, { cleaned: cleaned.length });
  //   }

  //   return cleaned;
  // }

  /**
   * Delete all workspaces for a user
   */
  async deleteAllUserWorkspaces(userId: string): Promise<number> {
    const workspaces = await this.getUserWorkspaces(userId);
    let deleted = 0;

    for (const workspace of workspaces) {
      const success = await this.deleteWorkspace(workspace.id);
      if (success) deleted++;
    }

    logger.info(`[IDE] Deleted ${deleted} workspaces for user ${userId}`);
    return deleted;
  }
}

// Export singleton instance
export const workspaceService = new WorkspaceService();

// Run orphaned workspace cleanup on module load (startup)
setTimeout(() => {
  // workspaceService.cleanupOrphanedWorkspaces().catch(err => {
    // logger.error('[IDE] Startup orphan cleanup failed:', err);
  // });
}, 5000); // Wait 5 seconds after startup
