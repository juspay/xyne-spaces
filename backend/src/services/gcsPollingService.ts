/**
 * GCS Polling Service for Network Documents
 * 
 * Polls a GCS bucket for new network documents (VISA/MASTERCARD PDFs)
 * Bucket Structure:
 *   {bucket}/
 *     pending/
 *       visa/
 *       mastercard/
 *     completed/
 *       visa/
 *       mastercard/
 * 
 * Flow:
 * 1. Poll GCS pending/ folder every 5 minutes
 * 2. For each PDF in pending/: process it
 * 3. Create ticket, start workflow
 */

import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { GCSService } from './gcsService';
import { redisService } from './redisService';
import { workflowManager } from '@/workflows/services/workflowManager';
import { TicketController } from '@/controllers/ticketController';
import { conversationService } from './conversationService';
import { NetworkDocumentContext } from '@/workflows/types/workflow-enums';
import { WorkflowType, WorkflowPriority } from '@/workflows/types/workflow-enums';
import * as path from 'path';

interface GcsFileMetadata {
  name: string;
  bucket: string;
  size: number;
  timeCreated: Date;
  contentType: string;
}

const POLL_LOCK_KEY = 'lock:gcs-polling:poll';
const POLL_LOCK_TTL_MS = 1 * 60 * 1000; // 1 minute
const PENDING_FOLDER = 'pending';
const COMPLETED_FOLDER = 'completed';

export class GcsPollingService {
  private static instance: GcsPollingService;
  private gcsService: GCSService;
  private ticketController: TicketController;
  private bucketName: string;
  private intervalId: NodeJS.Timeout | null = null;

  // Configuration - IDs looked up by name
  private projectId: string = '';
  private boardId: string = '';
  private userGroupId: string = '';
  private channelId: string = '';
  private systemUserId: string = '';
  private isInitialized: boolean = false;

  private constructor() {
    this.bucketName = process.env.NETWORK_DOCUMENTS_GCS_BUCKET || 'xyne-documents';
    this.gcsService = new GCSService(this.bucketName);
    this.ticketController = new TicketController();
    this.systemUserId = ''; // Will be set in initializeConfiguration
  }

  private async initializeConfiguration(): Promise<void> {
    if (this.isInitialized) return;

    const projectName = process.env.NETWORK_DOCUMENT_PROJECT_NAME;
    const boardName = process.env.NETWORK_DOCUMENT_BOARD_NAME;
    const userGroupName = process.env.NETWORK_DOCUMENT_USER_GROUP_NAME;
    const channelName = process.env.NETWORK_DOCUMENT_CHANNEL_NAME;
    const systemUserEmail = process.env.NETWORK_DOCUMENT_SYSTEM_USER_EMAIL;

    if (!projectName || !boardName || !userGroupName || !channelName || !systemUserEmail) {
      throw new Error('Missing NETWORK_DOCUMENT env configuration');
    }

    let project, board, userGroup, systemUser;

    try {
      [project, board, userGroup, systemUser] = await Promise.all([
        db.project.findUnique({ where: { name: projectName } }),
        db.board.findUnique({ where: { name: boardName } }),
        db.userGroup.findUnique({ where: { name: userGroupName } }),
        db.user.findUnique({ where: { email: systemUserEmail } }),
      ]);
    } catch (error) {
      throw new Error(`Database query failed: ${error}`);
    }

    if (!project) {
      throw new Error(`Project not found: ${projectName}`);
    }

    let channel;
    try {
      channel = await db.channel.findFirst({
        where: { name: channelName, projectId: project.id }
      });
    } catch (error) {
      throw new Error(`Database query for channel failed: ${error}`);
    }

    if (!board || !userGroup || !channel || !systemUser) {
      throw new Error('Network document configuration is incorrect');
    }

    this.projectId = project.id;
    this.boardId = board.id;
    this.userGroupId = userGroup.id;
    this.channelId = channel.id;
    this.systemUserId = systemUser.id;
    this.isInitialized = true;
    logger.info('[GCS_POLLING] Configuration initialized:', {
      projectId: this.projectId,
      boardId: this.boardId,
      systemUserId: this.systemUserId
    });

    await this.gcsService.checkBucketExists();
    logger.info(`[GCS_POLLING] Bucket "${this.bucketName}" is ready`);
  }

  public static getInstance(): GcsPollingService {
    if (!GcsPollingService.instance) {
      GcsPollingService.instance = new GcsPollingService();
    }
    return GcsPollingService.instance;
  }

  public async start(): Promise<void> {
    if (this.intervalId) {
      logger.info('[GCS_POLLING] Polling service already running');
      return;
    }

    const intervalMs = parseInt(process.env.GCS_POLLING_INTERVAL_MS || '90000', 10);

    logger.info(`[GCS_POLLING] Starting GCS polling service`, {
      bucket: this.bucketName,
      intervalMs,
    });

    await this.initializeConfiguration();

    this.pollForNewFiles();
    this.intervalId = setInterval(() => this.pollForNewFiles(), intervalMs);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.isInitialized=false;
      this.intervalId = null;
      logger.info('[GCS_POLLING] Polling service stopped');
    }
  }

  private async pollForNewFiles(): Promise<void> {
    try {
      const acquired = await redisService.getClient().set(POLL_LOCK_KEY, '1', 'PX', POLL_LOCK_TTL_MS, 'NX');
      if (acquired !== 'OK') {
        logger.debug('[GCS_POLLING] Poll already in progress by another pod, skipping');
        return;
      }
    } catch (error) {
      logger.error('[GCS_POLLING] Failed to acquire poll lock:', error);
      return;
    }

    try {
      logger.info('[GCS_POLLING] Checking for new network documents...');

      const allFiles = await this.listFilesInPendingFolders();

      if (allFiles.length === 0) {
        logger.debug('[GCS_POLLING] No files found');
        return;
      }

      logger.info(`[GCS_POLLING] Found ${allFiles.length} files to process`);

      for (const file of allFiles) {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
          continue;
        }
        await this.processFile(file);
      }
    } catch (error) {
      logger.error('[GCS_POLLING] Error during polling:', error);
    }
  }

  private async listFilesInPrefix(prefix: string): Promise<GcsFileMetadata[]> {
    try {
      const [files] = await this.gcsService['bucket'].getFiles({
        prefix,
      });

      return files
        .filter(f => !f.name?.endsWith('/')) // Exclude folder entries
        .map(file => ({
          name: file.name || '',
          bucket: this.bucketName,
          size: parseInt(String(file.metadata?.size || '0'), 10),
          timeCreated: new Date(file.metadata?.timeCreated || Date.now()),
          contentType: file.metadata?.contentType || 'application/pdf',
        }));
    } catch (error) {
      logger.error(`[GCS_POLLING] Error listing files:`, error);
      return [];
    }
  }

  private async listFilesInPendingFolders(): Promise<(GcsFileMetadata & { network: string })[]> {
    const pendingPrefix = `${PENDING_FOLDER}/`;

    // Get all items under pending/
    const [allItems] = await this.gcsService['bucket'].getFiles({
      prefix: pendingPrefix,
    });

    // Find subdirectories under pending/
    const subdirs = new Set<string>();
    allItems.forEach(item => {
      const name = item.name || '';
      const relativePath = name.replace(pendingPrefix, '');
      const pathParts = relativePath.split('/').filter(p => p);
      if (pathParts.length > 1) {
        subdirs.add(pathParts[0]);
      }
    });

    const networkFolders = Array.from(subdirs);

    if (networkFolders.length === 0) {
      return [];
    }

    // Get files from each network folder
    const allFilesPromises = networkFolders.map(folderName =>
      this.listFilesInPrefix(`${pendingPrefix}${folderName}/`)
        .then(files => files.map((f): GcsFileMetadata & { network: string } => ({
          ...f,
          network: folderName.toUpperCase()
        })))
    );

    const allFilesResults = await Promise.all(allFilesPromises);
    return allFilesResults.flat();
  }

  private async processFile(file: GcsFileMetadata & { network: string }): Promise<void> {
    const fileName = path.basename(file.name);
    const network = file.network;
    const gcsPath = file.name;

    logger.info(`[GCS_POLLING] Processing: ${gcsPath} (${network})`);

    try {
      if (!this.isInitialized) {
        await this.initializeConfiguration();
      }

      // Create conversation with system message using ConversationService
      const systemMessageContent = `Creating workflow ticket for ${network} Document: ${fileName}`;

      const { conversation } = await conversationService.createConversationWithMessage({
        channelId: this.channelId,
        userId: this.systemUserId,
        content: systemMessageContent,
        msgType: 'USER',
      });

      const ticket = await this.ticketController.createTicketWithConversation({
        title: `Workflow for ${network} Document: ${fileName}`,
        description: `Processing ${network} communication document`,
        createdBy: this.systemUserId,
        updatedBy: this.systemUserId,
        conversationId: conversation.conversationId,
        projectId: this.projectId,
        boardId: this.boardId,
        priority: 'MEDIUM',
        statusV2: 'TODO',
        messageContent: `Ticket has been created, triggering workflow now.`
      });
      logger.info(`[GCS_POLLING] Created ticket ${ticket.xyneId} (${ticket.id})`);

      // Derive completed path from gcsPath by replacing 'pending' with 'completed'
      const completedPath = gcsPath.replace(`${PENDING_FOLDER}`, `${COMPLETED_FOLDER}`);

      try {
        await this.gcsService['bucket'].file(gcsPath).move(
          this.gcsService['bucket'].file(completedPath)
        );
        logger.info(`[GCS_POLLING] Moved file to completed/: ${completedPath}`);
      } catch (moveError) {
        logger.error(`[GCS_POLLING] Failed to move file to completed/:`, moveError);
        return;
      }

      // Start workflow with completed path
      const context: NetworkDocumentContext = {
        ticketId: ticket.id,
        fileId: completedPath,
        fileName,
        localPath: '',
        network: network as 'VISA' | 'MASTERCARD',
        metadata: {
          gcsBucket: this.bucketName,
          gcsPath: completedPath,
          fileSize: file.size,
          userGroupId: this.userGroupId,
          systemUserId: this.systemUserId,
          projectId: this.projectId,
          boardId: this.boardId,
          channelId: this.channelId,
        },
      };

      logger.info(`[GCS_POLLING] Starting workflow for ${fileName}`);
      
      const workflowResult = await workflowManager.startWorkflow({
        ticketId: ticket.id,
        workflowType: WorkflowType.NETWORK_DOCUMENT_PROCESSING,
        context,
        priority: WorkflowPriority.MEDIUM,
        metadata: {},
      });
      
      logger.info(`[GCS_POLLING] Workflow started: ${workflowResult.workflowId}, execution: ${workflowResult.executionId}`);
      logger.info(`[GCS_POLLING] Processed: ${fileName}`);
    } catch (error) {
      logger.error(`[GCS_POLLING] Error processing ${gcsPath}:`, error);
    }
  }

  public getStatus(): { isRunning: boolean } {
    return {
      isRunning: this.intervalId !== null,
    };
  }
}

export const gcsPollingService = GcsPollingService.getInstance();
