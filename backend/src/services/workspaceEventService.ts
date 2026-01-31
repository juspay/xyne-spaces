/**
 * Workspace Event Service
 * 
 * Handles real-time workspace events via Redis pub/sub for cross-pod communication.
 * Worker pods publish events when workspace changes occur, backend pods subscribe
 * and forward to connected WebSocket clients.
 */

import Redis from 'ioredis';
import { logger } from '@/utils/logger';

// File tree node structure (matches frontend FileTreeNode)
export interface FileTreeNode {
  name: string;
  type: 'file' | 'folder';
  path: string;
  children?: FileTreeNode[];
}

// Workspace event types
export interface WorkspaceReadyEvent {
  type: 'workspace_ready';
  parentExecutionId: string;
  childExecutionId: string;
  timestamp: string;
}

export interface FileTreeUpdateEvent {
  type: 'file_tree_update';
  parentExecutionId: string;
  childExecutionId: string;
  commitHash?: string;  // Optional: the commit that triggered the update
  timestamp: string;
}

export interface FileContentUpdateEvent {
  type: 'file_content_update';
  parentExecutionId: string;
  childExecutionId: string;
  filePath: string;
  content: string;
  language: string;
  timestamp: string;
}

export interface WorkspaceClosedEvent {
  type: 'workspace_closed';
  parentExecutionId: string;
  childExecutionId: string;
  timestamp: string;
}

export interface CloningStartedEvent {
  type: 'cloning_started';
  parentExecutionId: string;
  childExecutionId: string;
  timestamp: string;
}

export type WorkspaceEvent = 
  | WorkspaceReadyEvent 
  | FileTreeUpdateEvent 
  | FileContentUpdateEvent 
  | WorkspaceClosedEvent
  | CloningStartedEvent;

// Workspace status stored in Redis
export interface WorkspaceStatus {
  parentExecutionId: string;
  childExecutionId: string;
  isReady: boolean;
  isCloning: boolean;
  repoUrl?: string;           // Repository URL for backend to clone from
  branch?: string;            // Feature branch name (may not exist on remote until first push)
  baseBranch?: string;        // Base branch to clone from (always exists, e.g., 'main')
  latestCommitHash?: string;  // Latest pushed commit for pull-based syncing
  tree?: FileTreeNode[];
  lastUpdated: string;
}

class WorkspaceEventService {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private redis: Redis | null = null;
  
  // Track active subscriptions
  private activeSubscriptions = new Set<string>();
  private subscriptionCallbacks = new Map<string, ((event: WorkspaceEvent) => void)[]>();
  private messageHandlerSetup = false;

  constructor() {
    this.initializeRedis();
  }

  private initializeRedis(): void {
    try {
      const config = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
        ...(process.env.REDIS_TLS === 'true' && {
          tls: { rejectUnauthorized: false }
        })
      };

      this.redis = new Redis(config);
      this.publisher = new Redis(config);
      this.subscriber = new Redis(config);

      this.redis.on('connect', () => {
        logger.info('📁 [WORKSPACE-REDIS] Redis connected');
      });

      this.redis.on('error', (error) => {
        logger.error('❌ [WORKSPACE-REDIS] Redis error:', error);
      });

    } catch (error) {
      logger.error('Failed to initialize workspace Redis:', error);
    }
  }

  private getChannel(parentExecutionId: string): string {
    return `workspace:${parentExecutionId}:events`;
  }

  private getStatusKey(parentExecutionId: string): string {
    return `workspace:${parentExecutionId}:status`;
  }

  private getTreeCacheKey(parentExecutionId: string): string {
    return `workspace:${parentExecutionId}:tree`;
  }

  // ============ PUBLISHER METHODS (called from Worker) ============

  /**
   * Publish cloning started event before clone begins
   */
  async publishCloningStarted(parentExecutionId: string, childExecutionId: string): Promise<void> {
    if (!this.publisher) {
      logger.info('❌ [WORKSPACE-PUB] Publisher not initialized');
      return;
    }

    const event: CloningStartedEvent = {
      type: 'cloning_started',
      parentExecutionId,
      childExecutionId,
      timestamp: new Date().toISOString()
    };

    const channel = this.getChannel(parentExecutionId);
    
    try {
      // Get existing status to preserve repoUrl, branch, baseBranch
      // (important for subsequent agentic steps where workspace already exists)
      const existingStatus = await this.getWorkspaceStatus(parentExecutionId);
      
      // Update status in Redis - cloning in progress, but preserve repo info
      await this.setWorkspaceStatus(parentExecutionId, {
        parentExecutionId,
        childExecutionId,
        isReady: false,
        isCloning: true,
        // Preserve existing repo info from previous workspace_ready
        repoUrl: existingStatus?.repoUrl,
        branch: existingStatus?.branch,
        baseBranch: existingStatus?.baseBranch,
        latestCommitHash: existingStatus?.latestCommitHash,
        lastUpdated: event.timestamp
      });

      // Publish event
      await this.publisher.publish(channel, JSON.stringify(event));
      logger.info(`📁 [WORKSPACE-PUB] Published cloning_started to ${channel}`);
    } catch (error) {
      logger.error(`❌ [WORKSPACE-PUB] Failed to publish cloning_started:`, error);
    }
  }

  /**
   * Publish workspace ready event after clone completes
   * @param parentExecutionId - Parent execution ID
   * @param childExecutionId - Child execution ID where workspace is cloned
   * @param repoUrl - Repository URL for backend to clone from (cross-pod support)
   * @param branch - Feature branch name (may not exist on remote until first push)
   * @param baseBranch - Base branch to clone from (always exists on remote, e.g., 'main')
   */
  async publishWorkspaceReady(
    parentExecutionId: string, 
    childExecutionId: string,
    repoUrl?: string,
    branch?: string,
    baseBranch?: string
  ): Promise<void> {
    if (!this.publisher) {
      logger.info('❌ [WORKSPACE-PUB] Publisher not initialized');
      return;
    }

    const event: WorkspaceReadyEvent = {
      type: 'workspace_ready',
      parentExecutionId,
      childExecutionId,
      timestamp: new Date().toISOString()
    };

    const channel = this.getChannel(parentExecutionId);
    
    try {
      // Update status in Redis with repo info for cross-pod cloning
      await this.setWorkspaceStatus(parentExecutionId, {
        parentExecutionId,
        childExecutionId,
        isReady: true,
        isCloning: false,
        repoUrl,
        branch,
        baseBranch,
        lastUpdated: event.timestamp
      });

      // Publish event
      await this.publisher.publish(channel, JSON.stringify(event));
      logger.info(`📁 [WORKSPACE-PUB] Published workspace_ready to ${channel}`);
    } catch (error) {
      logger.error(`❌ [WORKSPACE-PUB] Failed to publish workspace_ready:`, error);
    }
  }

  /**
   * Publish file tree update after files change
   * Note: We don't include the actual tree - frontend will fetch via API
   */
  async publishFileTreeUpdate(
    parentExecutionId: string, 
    childExecutionId: string, 
    commitHash?: string
  ): Promise<void> {
    if (!this.publisher) {
      logger.info('❌ [WORKSPACE-PUB] Publisher not initialized');
      return;
    }

    const event: FileTreeUpdateEvent = {
      type: 'file_tree_update',
      parentExecutionId,
      childExecutionId,
      commitHash,
      timestamp: new Date().toISOString()
    };

    const channel = this.getChannel(parentExecutionId);

    try {
      // Update Redis status with latest commit hash for pull-based syncing
      if (commitHash) {
        const currentStatus = await this.getWorkspaceStatus(parentExecutionId);
        if (currentStatus) {
          await this.setWorkspaceStatus(parentExecutionId, {
            ...currentStatus,
            latestCommitHash: commitHash,
            lastUpdated: event.timestamp
          });
        }
      }

      // Publish event - frontend will fetch tree via API
      await this.publisher.publish(channel, JSON.stringify(event));
      logger.info(`📁 [WORKSPACE-PUB] Published file_tree_update to ${channel}${commitHash ? ` (commit: ${commitHash.substring(0, 8)})` : ''}`);
    } catch (error) {
      logger.error(`❌ [WORKSPACE-PUB] Failed to publish file_tree_update:`, error);
    }
  }

  /**
   * Publish file content update for a specific file
   */
  async publishFileContentUpdate(
    parentExecutionId: string,
    childExecutionId: string,
    filePath: string,
    content: string,
    language: string
  ): Promise<void> {
    if (!this.publisher) return;

    const event: FileContentUpdateEvent = {
      type: 'file_content_update',
      parentExecutionId,
      childExecutionId,
      filePath,
      content,
      language,
      timestamp: new Date().toISOString()
    };

    const channel = this.getChannel(parentExecutionId);

    try {
      await this.publisher.publish(channel, JSON.stringify(event));
      logger.info(`📁 [WORKSPACE-PUB] Published file_content_update for ${filePath}`);
    } catch (error) {
      logger.error(`❌ [WORKSPACE-PUB] Failed to publish file_content_update:`, error);
    }
  }

  /**
   * Publish workspace closed event after cleanup
   */
  async publishWorkspaceClosed(parentExecutionId: string, childExecutionId: string): Promise<void> {
    if (!this.publisher) return;

    const event: WorkspaceClosedEvent = {
      type: 'workspace_closed',
      parentExecutionId,
      childExecutionId,
      timestamp: new Date().toISOString()
    };

    const channel = this.getChannel(parentExecutionId);

    try {
      // Clear cached data
      await this.clearWorkspaceCache(parentExecutionId);

      // Publish event
      await this.publisher.publish(channel, JSON.stringify(event));
      logger.info(`📁 [WORKSPACE-PUB] Published workspace_closed to ${channel}`);
    } catch (error) {
      logger.error(`❌ [WORKSPACE-PUB] Failed to publish workspace_closed:`, error);
    }
  }

  // ============ SUBSCRIBER METHODS (called from Backend API) ============

  private setupGlobalMessageHandler(): void {
    if (this.messageHandlerSetup || !this.subscriber) return;

    logger.info(`📁 [WORKSPACE-SUB] Setting up global message handler`);
    
    this.subscriber.on('message', (receivedChannel: string, data: string) => {
      const callbacks = this.subscriptionCallbacks.get(receivedChannel) || [];
      
      if (callbacks.length === 0) return;

      try {
        const event = JSON.parse(data) as WorkspaceEvent;
        logger.info(`📁 [WORKSPACE-SUB] Received ${event.type} on channel: ${receivedChannel}`);
        
        callbacks.forEach((cb) => {
          try {
            cb(event);
          } catch (error) {
            logger.error(`Error in workspace event callback:`, error);
          }
        });
      } catch (error) {
        logger.error(`Error parsing workspace event:`, error);
      }
    });

    this.messageHandlerSetup = true;
  }

  /**
   * Subscribe to workspace events for a parent execution
   */
  async subscribeToWorkspaceEvents(
    parentExecutionId: string,
    callback: (event: WorkspaceEvent) => void
  ): Promise<void> {
    if (!this.subscriber) throw new Error('Workspace subscriber not initialized');

    const channel = this.getChannel(parentExecutionId);

    // Add callback
    if (!this.subscriptionCallbacks.has(channel)) {
      this.subscriptionCallbacks.set(channel, []);
    }
    this.subscriptionCallbacks.get(channel)!.push(callback);

    // Setup handler
    this.setupGlobalMessageHandler();

    // Subscribe if not already
    if (!this.activeSubscriptions.has(channel)) {
      logger.info(`📁 [WORKSPACE-SUB] Subscribing to channel: ${channel}`);
      await this.subscriber.subscribe(channel);
      this.activeSubscriptions.add(channel);
    }
  }

  /**
   * Unsubscribe from workspace events
   */
  async unsubscribeFromWorkspaceEvents(parentExecutionId: string): Promise<void> {
    if (!this.subscriber) return;

    const channel = this.getChannel(parentExecutionId);

    // Remove callbacks
    this.subscriptionCallbacks.delete(channel);

    // Unsubscribe from Redis
    if (this.activeSubscriptions.has(channel)) {
      logger.info(`📁 [WORKSPACE-SUB] Unsubscribing from channel: ${channel}`);
      await this.subscriber.unsubscribe(channel);
      this.activeSubscriptions.delete(channel);
    }
  }

  // ============ CACHE METHODS (for REST API fallback) ============

  /**
   * Get workspace status from Redis cache
   */
  async getWorkspaceStatus(parentExecutionId: string): Promise<WorkspaceStatus | null> {
    if (!this.redis) return null;

    try {
      const key = this.getStatusKey(parentExecutionId);
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`❌ [WORKSPACE-CACHE] Failed to get status:`, error);
      return null;
    }
  }

  /**
   * Set workspace status in Redis
   */
  async setWorkspaceStatus(parentExecutionId: string, status: WorkspaceStatus): Promise<void> {
    if (!this.redis) return;

    try {
      const key = this.getStatusKey(parentExecutionId);
      await this.redis.set(key, JSON.stringify(status), 'EX', 3600); // 1 hour TTL
    } catch (error) {
      logger.error(`❌ [WORKSPACE-CACHE] Failed to set status:`, error);
    }
  }

  /**
   * Update workspace tree in status
   */
  async updateWorkspaceTree(parentExecutionId: string, tree: FileTreeNode[]): Promise<void> {
    const status = await this.getWorkspaceStatus(parentExecutionId);
    if (status) {
      status.tree = tree;
      status.lastUpdated = new Date().toISOString();
      await this.setWorkspaceStatus(parentExecutionId, status);
    }
  }

  /**
   * Cache file tree separately (for quick access)
   */
  async cacheFileTree(parentExecutionId: string, tree: FileTreeNode[]): Promise<void> {
    if (!this.redis) return;

    try {
      const key = this.getTreeCacheKey(parentExecutionId);
      await this.redis.set(key, JSON.stringify(tree), 'EX', 300); // 5 min TTL
    } catch (error) {
      logger.error(`❌ [WORKSPACE-CACHE] Failed to cache tree:`, error);
    }
  }

  /**
   * Get cached file tree
   */
  async getCachedFileTree(parentExecutionId: string): Promise<FileTreeNode[] | null> {
    if (!this.redis) return null;

    try {
      const key = this.getTreeCacheKey(parentExecutionId);
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`❌ [WORKSPACE-CACHE] Failed to get cached tree:`, error);
      return null;
    }
  }

  /**
   * Clear all workspace cache
   */
  async clearWorkspaceCache(parentExecutionId: string): Promise<void> {
    if (!this.redis) return;

    try {
      const statusKey = this.getStatusKey(parentExecutionId);
      const treeKey = this.getTreeCacheKey(parentExecutionId);
      await this.redis.del(statusKey, treeKey);
    } catch (error) {
      logger.error(`❌ [WORKSPACE-CACHE] Failed to clear cache:`, error);
    }
  }
}

// Export singleton instance
export const workspaceEventService = new WorkspaceEventService();
