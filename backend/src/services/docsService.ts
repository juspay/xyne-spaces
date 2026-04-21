// XYNE-1287: Quarto docs are now stored as Canvas records with docType='Quarto'
// Docs are scoped by channelId instead of projectId

import { config } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { messageMetadataService } from '@/services/messageMetadataService';
import { ChannelRepository } from '@/database/repositories/channelRepository.js';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository.js';
import { ConversationRepository } from '@/database/repositories/conversationRepository.js';
import { MessageRepository } from '@/database/repositories/messageRepository.js';
import { MessageType, CanvasVisibility, DocType } from '@prisma/client';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { v4 as uuidv4 } from 'uuid';
import { getStorageService, type StorageService } from './storage';
import { DatabaseClient } from '@/database/client.js';


const prisma = DatabaseClient.getInstance();

// Docs Publisher Bot ID
const DOCS_PUBLISHER_BOT_ID = 'docs-publisher';

export interface DocsPublishResult {
    success: boolean;
    docsUrl?: string;
    docsPath?: string;
    error?: string;
}

export interface DocsPublishRequest {
    userId: string;
    userRepo: string; // Combined org/repo/branch identifier (e.g., "juspay/xyne-spaces/main")
    repoId?: string;  // Optional Repo ID for editing capability
    branchName?: string; // Branch name for editing capability
    repoUrl?: string;  // Repository URL for editing capability
    channelId?: string; // Optional - if not provided, doc is user-scoped
    title: string;
    zipBuffer: Buffer;
    entryFile?: string;
    quartoDocumentType?: string;
    baseUrl: string;
}

export interface QuartoDocInfo {
    id: string;
    userRepo: string;
    repoId: string | null;
    branchName: string | null;
    repoUrl: string | null;
    baseBranch: string | null;
    channelId: string | null;
    channelName: string | null;
    title: string;
    entryFile: string | null;
    quartoDocumentType: string | null;
    createdBy: string;
    lastEditedBy: string | null;
    lastEditedAt: Date | null;
    gcsPath: string | null;
    createdAt: Date;
    updatedAt: Date;
}

// XYNE-1287
export class DocsService {
    private storageService: StorageService;

    constructor() {
        this.storageService = getStorageService(config.gcs.docsBucketName);
    }

    /**
     * Parse quartoRepo into components
     * Format: "org/repo/branch" (3+ parts) or "repo/branch" (2 parts) where branch can contain slashes
     */
    parseQuartoRepo(quartoRepo: string): { repoName: string; branchName: string } | null {
        const parts = quartoRepo.split('/');
        if (parts.length < 2) {
            return null;
        }
        if (parts.length === 2) {
            return { repoName: parts[0], branchName: parts[1] };
        }
        // 3+ part format: org/repo/branch where branch can contain slashes
        const repoName = `${parts[0]}/${parts[1]}`;
        const branchName = parts.slice(2).join('/');
        return { repoName, branchName };
    }

    createQuartoRepo(repoName: string, branchName: string): string {
        return `${repoName}/${branchName}`;
    }

    async checkExistingDoc(userRepoPath: string): Promise<QuartoDocInfo | null> {
        try {
            const safeUserRepo = this.sanitizePath(userRepoPath);

            const existingDoc = await prisma.canvas.findFirst({
                where: {
                    docType: DocType.Quarto,
                    userRepo: safeUserRepo,
                },
            });

            if (!existingDoc) {
                return null;
            }

            // Fetch repo URL and baseBranch if repoId is set
            let repoUrl: string | null = null;
            let baseBranch: string | null = null;
            if (existingDoc.repoId) {
                const repo = await prisma.repo.findUnique({
                    where: { id: existingDoc.repoId },
                });
                repoUrl = repo?.url || null;
                if (repo?.baseBranch && Array.isArray(repo.baseBranch) && repo.baseBranch.length > 0) {
                    baseBranch = repo.baseBranch[0] as string;
                }
                logger.info(`[DocsService] checkExistingDoc - repoId: ${existingDoc.repoId}, repoUrl: ${repoUrl || 'not found in Repo table'}, baseBranch: ${baseBranch || 'not set'}`);
            } else {
                logger.info(`[DocsService] checkExistingDoc - no repoId set for doc: ${existingDoc.id}`);
            }

            // Fetch channel name if channelId is set
            let channelName: string | null = null;
            if (existingDoc.channelId) {
                const channel = await prisma.channel.findUnique({
                    where: { id: existingDoc.channelId },
                    select: { name: true },
                });
                channelName = channel?.name || null;
            }

            return {
                id: existingDoc.id,
                userRepo: existingDoc.userRepo || '',
                repoId: existingDoc.repoId,
                branchName: existingDoc.branchName,
                repoUrl,
                baseBranch,
                channelId: existingDoc.channelId,
                channelName,
                title: existingDoc.title,
                entryFile: existingDoc.entryFile,
                quartoDocumentType: existingDoc.quartoDocumentType,
                createdBy: existingDoc.createdBy,
                lastEditedBy: existingDoc.lastEditedBy,
                lastEditedAt: existingDoc.lastEditedAt,
                gcsPath: existingDoc.gcsPath,
                createdAt: existingDoc.createdAt,
                updatedAt: existingDoc.updatedAt,
            };
        } catch (error) {
            logger.error('[DocsService] Failed to check existing doc:', error);
            return null;
        }
    }

    async deleteDoc(docId: string, userId: string): Promise<{ success: boolean; error?: string; statusCode?: number }> {
        try {
            const doc = await prisma.canvas.findUnique({
                where: { id: docId, docType: DocType.Quarto },
            });

            if (!doc) {
                return { success: false, error: 'Documentation not found', statusCode: 404 };
            }

            if (doc.createdBy !== userId) {
                return { success: false, error: 'Only the author can delete this documentation', statusCode: 403 };
            }

            await prisma.canvas.delete({
                where: { id: docId },
            });

            logger.info(`[DocsService] Deleted doc ${docId} (GCS path: ${doc.gcsPath})`);

            return { success: true };
        } catch (error) {
            logger.error('[DocsService] Failed to delete doc:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                statusCode: 500,
            };
        }
    }

    async getAllAccessibleDocs(
        userId: string,
        filter?: 'created_by_me' | { channelId: string }
    ): Promise<QuartoDocInfo[]> {
        try {
            if (typeof filter === 'object' && filter.channelId) {
                const hasAccess = await this.checkChannelAccess(userId, filter.channelId);
                
                if (!hasAccess) {
                    return [];
                }
                
                const docs = await prisma.canvas.findMany({
                    where: { 
                        docType: DocType.Quarto,
                        channelId: filter.channelId 
                    },
                    orderBy: { updatedAt: 'desc' },
                });
                return Promise.all(docs.map(doc => this.mapCanvasToDocInfo(doc)));
            } else {
                // Get docs created by user
                const docs = await prisma.canvas.findMany({
                    where: { 
                        docType: DocType.Quarto,
                        createdBy: userId 
                    },
                    orderBy: { updatedAt: 'desc' },
                });
                return Promise.all(docs.map(doc => this.mapCanvasToDocInfo(doc)));
            }
        } catch (error) {
            logger.error('[DocsService] Failed to get all accessible docs:', error);
            return [];
        }
    }

    private async mapCanvasToDocInfo(canvas: {
        id: string;
        userRepo: string | null;
        repoId: string | null;
        branchName: string | null;
        channelId: string | null;
        title: string;
        entryFile: string | null;
        quartoDocumentType: string | null;
        createdBy: string;
        lastEditedBy: string | null;
        lastEditedAt: Date | null;
        gcsPath: string | null;
        createdAt: Date;
        updatedAt: Date;
    }): Promise<QuartoDocInfo> {
        let repoUrl: string | null = null;
        let baseBranch: string | null = null;
        if (canvas.repoId) {
            const repo = await prisma.repo.findUnique({
                where: { id: canvas.repoId },
            });
            repoUrl = repo?.url || null;
            if (repo?.baseBranch && Array.isArray(repo.baseBranch) && repo.baseBranch.length > 0) {
                baseBranch = repo.baseBranch[0] as string;
            }
        }

        return {
            id: canvas.id,
            userRepo: canvas.userRepo || '',
            repoId: canvas.repoId,
            branchName: canvas.branchName,
            repoUrl,
            baseBranch,
            channelId: canvas.channelId,
            channelName: null,
            title: canvas.title,
            entryFile: canvas.entryFile,
            quartoDocumentType: canvas.quartoDocumentType,
            createdBy: canvas.createdBy,
            lastEditedBy: canvas.lastEditedBy,
            lastEditedAt: canvas.lastEditedAt,
            gcsPath: canvas.gcsPath,
            createdAt: canvas.createdAt,
            updatedAt: canvas.updatedAt,
        };
    }

    async checkChannelAccess(userId: string, channelId: string): Promise<boolean> {
        try {
            const participation = await prisma.channelParticipant.findFirst({
                where: {
                    userId,
                    channelId,
                },
            });

            return !!participation;
        } catch (error) {
            logger.error('[DocsService] Failed to check channel access:', error);
            return false;
        }
    }

    //XYNE-1287
    async checkDocAccess(userId: string, userRepoPath: string): Promise<boolean> {
        try {
            const safeUserRepo = this.sanitizePath(userRepoPath);

            logger.info(`[DocsService] checkDocAccess - original: userRepo="${userRepoPath}"`);
            logger.info(`[DocsService] checkDocAccess - sanitized: userRepo="${safeUserRepo}"`);

            const doc = await prisma.canvas.findFirst({
                where: {
                    docType: DocType.Quarto,
                    userRepo: safeUserRepo,
                },
            });

            if (!doc) {
                return false;
            }

            if (doc.createdBy === userId) {
                return true;
            }

            if (doc.channelId) {
                return await this.checkChannelAccess(userId, doc.channelId);
            }

            return false;
        } catch (error) {
            logger.error('[DocsService] Failed to check doc access:', error);
            return false;
        }
    }

    async publishDocs(request: DocsPublishRequest): Promise<DocsPublishResult> {
        const {
            userId,
            userRepo,
            repoId,
            branchName: requestBranchName,
            repoUrl,
            channelId,
            title,
            zipBuffer,
            entryFile = 'index.html',
            quartoDocumentType = 'docs',
            baseUrl,
        } = request;

        try {
            if (channelId) {
                const hasAccess = await this.checkChannelAccess(userId, channelId);
                if (!hasAccess) {
                    logger.warn(`[DocsService] User ${userId} denied access to publish to channel ${channelId}`);
                    return {
                        success: false,
                        error: 'You do not have permission to publish to this channel. You must be a channel participant.',
                    };
                }
            }

            const safeUserRepo = this.sanitizePath(userRepo);
            const gcsPath = `quarto/${safeUserRepo}`;
            
            // Parse branchName from userRepo (format: org/repo/branch) if not provided
            const parsed = this.parseQuartoRepo(userRepo);
            const branchName = requestBranchName || parsed?.branchName || null;

            logger.info(`[DocsService] Publishing docs to ${gcsPath}, entry file: ${entryFile}, zip size: ${zipBuffer.length} bytes, channelId: ${channelId || 'user-scoped'}`);

            // Store the zip file directly - frontend will unzip
            const zipFilePath = `${gcsPath}/bundle.zip`;
            await this.storageService.uploadFileV2(zipBuffer, { path: zipFilePath, contentType: 'application/zip' });
            logger.info(`[DocsService] Stored zip bundle at ${zipFilePath}`);

            await this.storeDocsMetadata(gcsPath, entryFile, userRepo, channelId || null, quartoDocumentType);

            // Look up or create a Repo record if repoUrl is provided
            let resolvedRepoId = repoId;
            if (!resolvedRepoId && repoUrl) {
                // Try to find existing repo by URL
                const existingRepo = await prisma.repo.findFirst({
                    where: { url: repoUrl },
                });
                if (existingRepo) {
                    resolvedRepoId = existingRepo.id;
                } else {
                    // Create a new repo record
                    const repoName = parsed?.repoName || safeUserRepo.split('/').slice(0, 2).join('/');
                    const newRepo = await prisma.repo.create({
                        data: {
                            name: repoName,
                            url: repoUrl,
                            baseBranch: branchName ? [branchName] : ['main'],
                            prefix: 'docs',
                            createdBy: userId,
                        },
                    });
                    resolvedRepoId = newRepo.id;
                    logger.info(`[DocsService] Created new repo record: ${newRepo.id} for ${repoUrl}`);
                }
            }

            // XYNE-1287 Wrap database operations in a transaction for consistency
            const { channelName } = await prisma.$transaction(async (tx) => {
                await tx.canvas.upsert({
                    where: {
                        userRepo: safeUserRepo,
                    },
                    update: {
                        ...(channelId ? { channelId } : {}),
                        title,
                        entryFile,
                        quartoDocumentType,
                        lastEditedBy: userId,
                        lastEditedAt: new Date(),
                        gcsPath,
                        updatedAt: new Date(),
                        ...(resolvedRepoId ? { repoId: resolvedRepoId } : {}),
                        branchName,
                    },
                    create: {
                        userRepo: safeUserRepo,
                        ...(channelId ? { channelId } : {}),
                        title,
                        entryFile,
                        quartoDocumentType,
                        createdBy: userId,
                        gcsPath,
                        docType: DocType.Quarto,
                        visibility: CanvasVisibility.PRIVATE,
                        isTemplate: false,
                        isCollaborative: false,
                        content: [],
                        ...(resolvedRepoId ? { repoId: resolvedRepoId } : {}),
                        branchName,
                    },
                });

                let chName = 'Personal';
                if (channelId) {
                    const channel = await tx.channel.findUnique({
                        where: { id: channelId },
                        select: { name: true },
                    });
                    chName = channel?.name || channelId;
                }

                return { channelName: chName };
            });

            const docsUrl = this.generateDocsUrl(baseUrl, safeUserRepo);

            // Create DM message with the docs link
            await this.createDocsNotification(userId, title, docsUrl, userRepo, channelId || null, channelName);

            logger.info(`[DocsService] Docs published successfully: ${docsUrl}`);

            return {
                success: true,
                docsUrl,
                docsPath: gcsPath,
            };
        } catch (error) {
            logger.error('[DocsService] Failed to publish docs:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    private async storeDocsMetadata(
        docsPath: string,
        entryFile: string,
        userRepo: string,
        channelId: string | null,
        quartoDocumentType: string
    ): Promise<void> {
        const metadata = {
            entryFile,
            userRepo,
            channelId,
            quartoDocumentType,
            publishedAt: new Date().toISOString(),
        };
        const metadataPath = `${docsPath}/_docs_metadata.json`;
        await this.storageService.uploadFileV2(Buffer.from(JSON.stringify(metadata)), { path: metadataPath, contentType: 'application/json' });
        logger.debug(`[DocsService] Stored metadata at ${metadataPath}`);
    }

    /**
     * Get docs metadata
     */
    async getDocsMetadata(docsPath: string): Promise<{ entryFile: string } | null> {
        try {
            const metadataPath = `${docsPath}/_docs_metadata.json`;
            const exists = await this.storageService.fileExists(metadataPath);

            if (!exists) {
                return null;
            }

            const buffer = await this.storageService.getFileBuffer(metadataPath);
            return JSON.parse(buffer.toString()) as { entryFile: string };
        } catch (error) {
            logger.warn(`[DocsService] Could not read metadata: ${error}`);
            return null;
        }
    }

    private generateDocsUrl(baseUrl: string, userRepo: string): string {
        return `${baseUrl}/docs/${userRepo}`;
    }

    /**
     * Create a DM notification with the docs link
     */
    private async createDocsNotification(
        userId: string,
        title: string,
        docsUrl: string,
        userRepo: string,
        channelId: string | null,
        channelName: string
    ): Promise<void> {
        // Get the bot user from the database
        const botUser = await unifiedBotUserService.getBotByBotId(DOCS_PUBLISHER_BOT_ID);
        if (!botUser) {
            logger.error('[DocsService] Docs Publisher bot not found - cannot send notification');
            throw new Error('Docs Publisher bot not found');
        }

        const channelRepository = new ChannelRepository();
        const channelParticipantRepository = new ChannelParticipantRepository();
        const conversationRepository = new ConversationRepository();
        const messageRepository = new MessageRepository();

        // Get user's workspaceId
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { workspaceId: true }
        });
        if (!user?.workspaceId) {
            throw new Error('User workspace not found');
        }

        // Find or create DM channel with the docs publisher bot (using database user ID)
        const dmChannelId = await channelRepository.findOrCreateDMChannel(
            userId,
            [botUser.id],
            channelParticipantRepository,
            user.workspaceId
        );

        const parsed = this.parseQuartoRepo(userRepo);
        const repoDisplay = parsed ? `${parsed.repoName} (${parsed.branchName})` : userRepo;

        // Create the message content with link preview metadata
        const messageContent = `📚 Your documentation has been published!\n\n📁 Repository: ${repoDisplay}\n📂 Channel: ${channelName}\n🔗 ${docsUrl}`;

        logger.info(`[DocsService] Creating notification message with content: ${messageContent.substring(0, 100)}...`);

        // Generate conversation ID
        const conversationId = uuidv4();

        // First create the message with the conversationId (using database user ID)
        const message = await messageRepository.create({
            conversationId,
            senderId: botUser.id,
            content: messageContent,
            msgType: MessageType.BOT,
            hasAttachment: false,
            metadata: {
                docsUrl,
                title,
                userRepo,
                channelId,
                type: 'docs_published',
                linkPreview: {
                    url: docsUrl,
                    title: title,
                    description: `Published from ${repoDisplay}`,
                    siteName: 'Xyne Docs',
                },
            },
        });

        // Then create the conversation with the message ID
        await conversationRepository.create({
            conversationId,
            channelId: dmChannelId,
            createdBy: botUser.id,
            initialMessageId: message.messageId,
            metadata: {
                type: 'docs_published',
                docsUrl,
                title,
                userRepo,
                channelId,
            },
        });
        await messageMetadataService.syncInitialMessageMd(conversationId);

        logger.info(`[DocsService] Created docs notification for user ${userId}`);
    }

    private sanitizePath(pathSegment: string): string {
        return pathSegment
            .replace(/[^a-zA-Z0-9-_\/]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 200);
    }

    /**
     * Get a file from GCS
     */
    async getFile(filePath: string): Promise<{ buffer: Buffer; contentType: string } | null> {
        try {
            const exists = await this.storageService.fileExists(filePath);

            if (!exists) {
                return null;
            }

            const buffer = await this.storageService.getFileBuffer(filePath);
            const metadata = await this.storageService.getFileMetadata(filePath);
            const contentType = metadata.contentType || 'application/octet-stream';

            return { buffer, contentType };
        } catch (error) {
            logger.error(`[DocsService] Failed to get file ${filePath}:`, error);
            return null;
        }
    }

    async getDocsZip(userRepo: string): Promise<{ buffer: Buffer; entryFile: string } | null> {
        try {
            const safeUserRepo = this.sanitizePath(userRepo);
            const docsPath = `quarto/${safeUserRepo}`;
            const zipFilePath = `${docsPath}/bundle.zip`;

            logger.info(`[DocsService] getDocsZip called with userRepo: ${userRepo}, safeUserRepo: ${safeUserRepo}, zipFilePath: ${zipFilePath}, bucket: ${config.gcs.docsBucketName}`);

            const exists = await this.storageService.fileExists(zipFilePath);

            if (!exists) {
                logger.warn(`[DocsService] Zip bundle not found at ${zipFilePath} in bucket ${config.gcs.docsBucketName}`);
                return null;
            }

            const buffer = await this.storageService.getFileBuffer(zipFilePath);

            // Get metadata to find entry file
            const metadata = await this.getDocsMetadata(docsPath);
            const entryFile = metadata?.entryFile || 'index.html';

            logger.info(`[DocsService] Retrieved zip bundle from ${zipFilePath} (${buffer.length} bytes), entryFile: ${entryFile}`);

            return { buffer, entryFile };
        } catch (error) {
            logger.error(`[DocsService] Failed to get docs zip:`, error);
            return null;
        }
    }

    async getShareTargets(userId: string, channelId?: string): Promise<Array<{
        id: string;
        name: string;
        type: 'channel' | 'dm' | 'group_dm';
        channelId?: string;
    }>> {
        try {
            const channelParticipantRepository = new ChannelParticipantRepository();
            const targets: Array<{
                id: string;
                name: string;
                type: 'channel' | 'dm' | 'group_dm';
                channelId?: string;
            }> = [];

            const userChannelParticipations = await channelParticipantRepository.getUserChannels(userId);
            const channelIds = userChannelParticipations.map(cp => cp.channelId);

            if (channelIds.length === 0) {
                return targets;
            }

            const channels = await prisma.channel.findMany({
                where: { id: { in: channelIds } },
            });

            const dmGroupDmChannels = channels.filter(c => c.scopeType === 'DM' || c.scopeType === 'GROUP_DM');
            const dmGroupDmChannelIds = dmGroupDmChannels.map(c => c.id);

            let participantsByChannel: Map<string, Array<{ userId: string; userName: string }>> = new Map();
            if (dmGroupDmChannelIds.length > 0) {
                const participants = await prisma.channelParticipant.findMany({
                    where: { channelId: { in: dmGroupDmChannelIds } },
                    select: { channelId: true, userId: true },
                });

                const allUserIds = [...new Set(participants.map(p => p.userId))];
                const users = await prisma.user.findMany({
                    where: { id: { in: allUserIds } },
                    select: { id: true, name: true },
                });
                const userMap = new Map(users.map(u => [u.id, u.name || 'User']));

                for (const p of participants) {
                    if (!participantsByChannel.has(p.channelId)) {
                        participantsByChannel.set(p.channelId, []);
                    }
                    participantsByChannel.get(p.channelId)!.push({
                        userId: p.userId,
                        userName: userMap.get(p.userId) || 'User',
                    });
                }
            }

            for (const channel of channels) {
                if (channelId && channel.id !== channelId && channel.scopeType === 'DEFAULT') {
                    continue;
                }

                let channelName = channel.name;
                let channelType: 'channel' | 'dm' | 'group_dm' = 'channel';

                if (channel.scopeType === 'DM') {
                    const participants = participantsByChannel.get(channel.id) || [];
                    const otherParticipant = participants.find(p => p.userId !== userId);
                    channelName = otherParticipant?.userName || 'Direct Message';
                    channelType = 'dm';
                } else if (channel.scopeType === 'GROUP_DM') {
                    const participants = participantsByChannel.get(channel.id) || [];
                    const otherNames = participants
                        .filter(p => p.userId !== userId)
                        .map(p => p.userName)
                        .slice(0, 3);
                    channelName = otherNames.join(', ') || 'Group DM';
                    channelType = 'group_dm';
                }

                targets.push({
                    id: channel.id,
                    name: channelName,
                    type: channelType,
                    channelId: channel.id,
                });
            }

            targets.sort((a, b) => {
                if (a.type !== b.type) {
                    const order = { channel: 0, group_dm: 1, dm: 2 };
                    return order[a.type] - order[b.type];
                }
                return a.name.localeCompare(b.name);
            });

            return targets;
        } catch (error) {
            logger.error('[DocsService] Failed to get share targets:', error);
            return [];
        }
    }

    async shareDocToChannel(
        userId: string,
        targetChannelId: string,
        docsUrl: string,
        title: string,
        userRepo?: string
    ): Promise<{ success: boolean; messageId?: string; error?: string; statusCode?: number }> {
        try {
            const conversationRepository = new ConversationRepository();
            const messageRepository = new MessageRepository();

            const participation = await prisma.channelParticipant.findFirst({
                where: { channelId: targetChannelId, userId },
            });

            if (!participation) {
                return { success: false, error: 'You are not a participant in this channel', statusCode: 403 };
            }

            const parsed = userRepo ? this.parseQuartoRepo(userRepo) : null;
            const repoDisplay = parsed ? `${parsed.repoName} (${parsed.branchName})` : (userRepo || '');
            const messageContent = `📚 Shared documentation: ${title}\n${repoDisplay ? `📁 ${repoDisplay}` : ''}\n🔗 ${docsUrl}`;

            const conversationId = uuidv4();

            const message = await messageRepository.create({
                conversationId,
                senderId: userId,
                content: messageContent,
                msgType: MessageType.USER,
                hasAttachment: false,
                metadata: {
                    docsUrl,
                    title,
                    userRepo,
                    type: 'docs_shared',
                    linkPreview: {
                        url: docsUrl,
                        title: title,
                        description: repoDisplay ? `Documentation from ${repoDisplay}` : 'Shared documentation',
                        siteName: 'Xyne Docs',
                    },
                },
            });

            await conversationRepository.create({
                conversationId,
                channelId: targetChannelId,
                createdBy: userId,
                initialMessageId: message.messageId,
                metadata: {
                    type: 'docs_shared',
                    docsUrl,
                    title,
                },
            });
            await messageMetadataService.syncInitialMessageMd(conversationId);

            logger.info(`[DocsService] Shared doc to channel ${targetChannelId}`);

            return { success: true, messageId: message.messageId };
        } catch (error) {
            logger.error('[DocsService] Failed to share doc to channel:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                statusCode: 500,
            };
        }
    }
}

// Export singleton instance
export const docsService = new DocsService();
