import { Request, Response } from 'express';
import { Readable } from 'stream';
import { CollectionRepository } from '../database/repositories/collectionRepository';
import { logger } from '@/utils/logger';
import { gcsService } from '@/services/gcsService';
import { z } from 'zod';
import { createFolderSchema } from '../validators/folderValidator';
import { uploadFilesSchema, DuplicateStrategy } from '../validators/fileUploadValidator';
import { calculateChecksum, detectMimeType, generateUniqueName, checkFileSize } from '@/utils/fileHelpers';
import { vespaQueue } from '@/queues/vespaQueue';
import { SubApp, fileSchema } from '@/vespa/src/types';
import vespaClient from '@/vespa/client';
import { CollectionRole, CollectionPermission, UploadStatus, Collection } from '@prisma/client';
import { notificationService } from '@/services/notificationService';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { parseSlideUrlCsv } from '@/utils/fileProcessor/csvSlideParser';
import { triggerTagExtraction, triggerFileRename } from '@/services/collections/entityTagExtractor';

export class CollectionController {
    private collectionRepository: CollectionRepository;

    constructor() {
        this.collectionRepository = new CollectionRepository();
    }

    /**
     * Get user IDs that are members of the project (participants in any channel of that project).
     * Used by the share-collection UI to only show project members as share targets.
     */
    getProjectMembers = async (req: Request, res: Response): Promise<void> => {
        try {
            const { projectId } = req.params;

            if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
                res.status(400).json({ error: 'Project ID is required' });
                return;
            }

            const memberIds = await this.collectionRepository.getProjectMemberUserIds(projectId.trim());
            res.status(200).json({
                success: true,
                userIds: Array.from(memberIds),
            });
        } catch (error) {
            logger.error('Error fetching project members:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    getCollectionsByProject = async (req: Request, res: Response): Promise<void> => {
        try {
            const { projectId, userId } = req.params;

            if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
                res.status(400).json({ error: 'Project ID is required' });
                return;
            }

            if (!userId || typeof userId !== 'string' || userId.trim() === '') {
                res.status(400).json({ error: 'User ID is required' });
                return;
            }

            const collections = await this.collectionRepository.findCollectionsByProjectId(projectId.trim(), userId.trim());

            res.status(200).json({
                success: true,
                collections,
            });
        } catch (error) {
            logger.error('Error fetching collections by project:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    getItemsByCollection = async (req: Request, res: Response): Promise<void> => {
        try {
            const { collectionId } = req.params;
            const parentId = (req.query.parentId as string) || null;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!collectionId || typeof collectionId !== 'string' || collectionId.trim() === '') {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            const { role } = await this.getCollectionOrRole(collectionId, userId);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have permission to access this collection' });
                return;
            }

            const items = await this.collectionRepository.findItemsByCollectionAndParentId(
                collectionId.trim(),
                parentId ? parentId.trim() : null
            );

            // Convert BigInt fileSize to string for JSON serialization
            const serializedItems = items.map(item => ({
                ...item,
                fileSize: item.fileSize?.toString() ?? null,
            }));

            res.status(200).json({
                success: true,
                items: serializedItems,
            });
        } catch (error) {
            logger.error('Error fetching collection items:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    /**
     * Get folder counters for a single folder by its id.
     * GET /:collectionId/folder-counters/:folderId
     */
    getFolderCountersByFolderId = async (req: Request, res: Response): Promise<void> => {
        try {
            const { collectionId, folderId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!collectionId || typeof collectionId !== 'string' || collectionId.trim() === '') {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            if (!folderId || typeof folderId !== 'string' || folderId.trim() === '') {
                res.status(400).json({ error: 'Folder ID is required' });
                return;
            }

            const { role } = await this.getCollectionOrRole(collectionId, userId);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have permission to access this collection' });
                return;
            }

            const counter = await this.collectionRepository.findFolderCountersByFolderId(
                collectionId.trim(),
                folderId.trim()
            );

            res.status(200).json({
                success: true,
                collectionId: collectionId.trim(),
                folderId: folderId.trim(),
                counter,
            });
        } catch (error) {
            logger.error('Error fetching folder counters by folder id:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    getItemContent = async (req: Request, res: Response): Promise<void> => {
        try {
            const { itemId } = req.params;
            const withMetadata = req.query.withMetadata === 'true';
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
                res.status(400).json({ error: 'Item ID is required' });
                return;
            }

            const item = await this.collectionRepository.findItemById(itemId.trim());

            if (!item) {
                res.status(404).json({ error: 'Item not found' });
                return;
            }

            if (item.type !== 'FILE') {
                res.status(400).json({ error: 'Item is not a file' });
                return;
            }

            if (!item.storageKey) {
                logger.error(`File item ${itemId} has no storage key`);
                res.status(500).json({ error: 'File storage path missing' });
                return;
            }

            const { role } = await this.getCollectionOrRole(item.collectionId, userId);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have permission to access this item' });
                return;
            }

            const buffer = await gcsService.getFileBuffer(item.storageKey);

            // If withMetadata is true, return JSON with metadata and base64 encoded file
            if (withMetadata) {
                const base64Content = buffer.toString('base64');
                res.status(200).json({
                    success: true,
                    metadata: {
                        id: item.id,
                        name: item.name,
                        size: buffer.length,
                        mimeType: item.mimeType || 'application/octet-stream',
                    },
                    content: base64Content,
                });
                return;
            }

            // Default behavior: return binary file with headers (for direct downloads)
            const escapedFilename = item.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            
            res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${escapedFilename}"`);
            res.setHeader('Content-Length', buffer.length.toString());

            res.send(buffer);
        } catch (error) {
            logger.error('Error fetching file content:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    /**
     * Get an item and all its ancestors up to the collection root.
     * Used by the frontend to hydrate the tree context on deep-link/refresh.
     * Returns items ordered from the target item up to the root-level ancestor.
     */
    getItemAncestors = async (req: Request, res: Response): Promise<void> => {
        try {
            const { itemId } = req.params;
            const collectionId = req.query.collectionId as string;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
                res.status(400).json({ error: 'Item ID is required' });
                return;
            }

            if (!collectionId || typeof collectionId !== 'string' || collectionId.trim() === '') {
                res.status(400).json({ error: 'Collection ID is required (query param)' });
                return;
            }

            const { role } = await this.getCollectionOrRole(collectionId, userId);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have permission to access this item' });
                return;
            }

            const ancestors = await this.collectionRepository.findItemAncestors(
                itemId.trim(),
                collectionId.trim(),
            );

            // Convert BigInt fileSize to string for JSON serialization
            const serializedItems = ancestors.map(item => ({
                ...item,
                fileSize: item.fileSize?.toString() ?? null,
            }));

            res.status(200).json({
                success: true,
                items: serializedItems,
            });
        } catch (error) {
            logger.error('Error fetching item ancestors:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    createCollection = async (req: Request, res: Response): Promise<void> => {
        try {
            const { userId, projectId, name, description, email, metadata } = req.body;

            if (!userId || typeof userId !== 'string') {
                res.status(400).json({ error: 'userId is required' });
                return;
            }
            if (!projectId || typeof projectId !== 'string') {
                res.status(400).json({ error: 'projectId is required' });
                return;
            }
            if (!name || typeof name !== 'string') {
                res.status(400).json({ error: 'name is required' });
                return;
            }
            if (!email || typeof email !== 'string') {
                res.status(400).json({ error: 'email is required' });
                return;
            }

            const collection = await this.collectionRepository.createCollection({
                userId,
                projectId,
                name,
                description,
                email,
                metadata,
            });

            const filteredCollection = {
                id: collection.id,
                name: collection.name,
                description: collection.description,
                ownerId: collection.ownerId,
                canShare: collection.ownerId === userId,
                role: collection.ownerId === userId ? 'OWNER' : 'VIEWER',
            };

            res.status(201).json(filteredCollection);
        } catch (error) {
            logger.error('Error creating collection:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    deleteCollection = async (req: Request, res: Response): Promise<void> => {
        try {
            const { collectionId } = req.params;
            const { userId } = req.body;

            if (!collectionId) {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            if (!userId) {
                res.status(400).json({ error: 'User ID is required' });
                return;
            }

            const { role, collection: collectionWithPermissions } = await this.getCollectionOrRole(collectionId, userId, true);
            if (!role || role !== CollectionRole.OWNER) {
                res.status(403).json({ error: 'Forbidden: You do not have permission to delete this collection' });
                return;
            }

            if (!collectionWithPermissions) {
                res.status(404).json({ error: 'Collection not found' });
                return;
            }

            // Build list of users who have access to this collection (before deletion)
            const usersToNotify = new Set<string>();
            
            // Add owner
            usersToNotify.add(collectionWithPermissions.ownerId);
            
            // Add all users from permissions
            if (collectionWithPermissions.permissions) {
                for (const perm of collectionWithPermissions.permissions) {
                    if (perm.userId) {
                        usersToNotify.add(perm.userId);
                    }
                }
            }

            const success = await this.collectionRepository.deleteCollection(collectionId, userId);

            if (!success) {
                res.status(404).json({ error: 'Collection not found' });
                return;
            }

            // Send notifications to users who had access to this collection
            const deleterUser = req.user;
            for (const targetUserId of usersToNotify) {
                if (targetUserId === deleterUser?.id) {
                    continue;
                }
                try {
                    await notificationService.createNotification(targetUserId, {
                        type: 'DIRECT_MESSAGE' as any,
                        title: `Collection deleted by ${deleterUser?.name || 'a user'}`,
                        message: `"${collectionWithPermissions.name}" has been deleted`,
                        actionUrl: `/knowledge-base/${collectionWithPermissions.projectId}`,
                        relatedEntityType: 'collection' as any,
                        relatedEntityId: collectionWithPermissions.id,
                        metadata: {
                            notificationType: 'collection_deleted',
                            collectionId: collectionWithPermissions.id,
                            collectionName: collectionWithPermissions.name,
                            projectId: collectionWithPermissions.projectId,
                            deletedBy: deleterUser?.name || 'Unknown',
                            deletedById: userId
                        }
                    });

                    logger.info(`📬 [NOTIFICATION] Sent collection_deleted notification to user ${targetUserId} for collection ${collectionId}`);
                } catch (notifError) {
                    logger.error(`Failed to send collection_deleted notification to user ${targetUserId}:`, notifError);
                    // Don't fail the request if notification fails
                }
            }

            logger.info(`📚 [COLLECTION] Collection ${collectionId} deleted by user ${userId}`);

            res.status(200).json({ success: true, message: 'Collection deleted successfully' });
        } catch (error: any) {
            logger.error('Error deleting collection:', error);
            if (error.message.includes('Unauthorized')) {
                res.status(403).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    };

    updateCollection = async (req: Request, res: Response): Promise<void> => {
        try {
            const { collectionId } = req.params;
            const { userId, name, permissions, notify } = req.body;

            if (!collectionId) {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            if (!userId) {
                res.status(400).json({ error: 'User ID is required' });
                return;
            }

            const { role } = await this.getCollectionOrRole(collectionId, userId);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }
            if (role === CollectionRole.VIEWER) {
                res.status(403).json({ error: 'Forbidden: You do not have edit access to this collection' });
                return;
            }
 
            const filteredPermissions = permissions.filter((perm: { userId?: string; userGroupId?: string; role: CollectionRole; canShare?: boolean }) => perm.userId !== userId);

            await this.collectionRepository.updateCollection(collectionId, userId, { name, permissions: filteredPermissions });

            // Fetch collection with permissions to get all users who should receive the update
            const collectionWithPermissions = await this.collectionRepository.findCollectionByIdWithPermissions(collectionId);
            
            if (!collectionWithPermissions) {
                logger.error(`Collection ${collectionId} not found after update`);
                return;
            }

            // Send notifications to newly shared users (if permissions were updated and notify is true)
            if (notify && filteredPermissions && Array.isArray(filteredPermissions)) {
                const sharerUser = req.user; // Assuming user is attached to request by auth middleware
                
                for (const perm of filteredPermissions) {
                    // Only notify users who are not the sharer themselves
                    if (perm.userId && perm.userId !== userId) {
                        try {
                            // Use generic notification type since collection_shared might not be defined
                            await notificationService.createNotification(perm.userId, {
                                type: 'DIRECT_MESSAGE' as any, // Use existing type as fallback
                                title: `Collection shared by ${sharerUser?.name || 'a user'}`,
                                message: `"${collectionWithPermissions.name}" gave you ${perm.role} access`,
                                actionUrl: `/knowledge-base/${collectionWithPermissions.projectId}/${collectionWithPermissions.id}`,
                                relatedEntityType: 'collection' as any,
                                relatedEntityId: collectionWithPermissions.id,
                                metadata: {
                                    notificationType: 'collection_shared', // Store actual type in metadata
                                    collectionId: collectionWithPermissions.id,
                                    collectionName: collectionWithPermissions.name,
                                    projectId: collectionWithPermissions.projectId,
                                    role: perm.role,
                                    sharedBy: sharerUser?.name || 'Unknown',
                                    sharedById: userId
                                }
                            });

                            logger.info(`📬 [NOTIFICATION] Sent collection_shared notification to user ${perm.userId} for collection ${collectionId}`);
                        } catch (notifError) {
                            logger.error(`Failed to send collection_shared notification to user ${perm.userId}:`, notifError);
                            // Don't fail the request if notification fails
                        }
                    }
                }
            }

            logger.info(`📚 [COLLECTION] Collection ${collectionId} updated by user ${userId}`);

            res.status(200).json({ success: true, message: 'Collection updated successfully' });
        } catch (error: any) {
            logger.error('Error updating collection:', error);
            if (error.message?.includes('Unauthorized')) {
                res.status(403).json({ error: error.message });
            } else if (error.message?.includes('not found')) {
                res.status(404).json({ error: error.message });
            } else if (error.message?.includes('not a member of this project')) {
                res.status(400).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    };

    deleteItem = async (req: Request, res: Response): Promise<void> => {
        try {
            const { itemId } = req.params;
            const { collectionId, userId } = req.body;

            if (!itemId) {
                res.status(400).json({ error: 'Item ID is required' });
                return;
            }

            if (!collectionId) {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            if (!userId) {
                res.status(400).json({ error: 'User ID is required' });
                return;
            }

            const { role } = await this.getCollectionOrRole(collectionId, userId);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }
            if (role === CollectionRole.VIEWER) {
                res.status(403).json({ error: 'Forbidden: You do not have edit access to this collection' });
                return;
            }

            // Get item details before deleting
            const item = await this.collectionRepository.findItemById(itemId);
            if (!item || item.collectionId !== collectionId) {
                res.status(404).json({ error: 'Item not found or access denied' });
                return;
            }

            const success = await this.collectionRepository.deleteItem(itemId, collectionId, userId);

            if (!success) {
                res.status(404).json({ error: 'Item not found or access denied' });
                return;
            }

            logger.info(`📄 [NODE] Node ${itemId} deleted from collection ${collectionId} by user ${userId}`);

            res.status(200).json({ success: true, message: 'Item deleted successfully' });
        } catch (error: any) {
            logger.error('Error deleting item:', error);
            if (error.message.includes('Unauthorized')) {
                res.status(403).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    };

    updateItem = async (req: Request, res: Response): Promise<void> => {
        try {
            const { itemId } = req.params;
            const { collectionId, userId, name } = req.body;

            if (!itemId) {
                res.status(400).json({ error: 'Item ID is required' });
                return;
            }

            if (!collectionId) {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            if (!userId) {
                res.status(400).json({ error: 'User ID is required' });
                return;
            }

            if (!name) {
                res.status(400).json({ error: 'Name is required' });
                return;
            }

            const { role } = await this.getCollectionOrRole(collectionId, userId);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }
            if (role === CollectionRole.VIEWER) {
                res.status(403).json({ error: 'Forbidden: You do not have edit access to this collection' });
                return;
            }

            await this.collectionRepository.updateItem(itemId, collectionId, userId, name);

            // Fire-and-forget: keep Vespa fileName in sync with DB name
            vespaClient.crudService.update([{ docId: itemId, fields: { fileName: name } }], fileSchema).catch(err => {
                logger.warn(`[UPDATE_ITEM] Failed to update Vespa fileName for ${itemId}`, {
                    error: err instanceof Error ? err.message : String(err),
                });
            });

            logger.info(`📄 [NODE] Node ${itemId} updated in collection ${collectionId} by user ${userId}`);

            res.status(200).json({ success: true, message: 'Item updated successfully' });
        } catch (error: any) {
            logger.error('Error updating item:', error);
            if (error.message.includes('Unauthorized')) {
                res.status(403).json({ error: error.message });
            } else if (error.message.includes('not found')) {
                res.status(404).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    };

    createFolder = async (req: Request, res: Response): Promise<void> => {
        try {
            const { collectionId } = req.params;
            const user = req.user;

            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!collectionId || typeof collectionId !== 'string' || collectionId.trim() === '') {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            const validatedData = createFolderSchema.parse(req.body);

            // Check if collection exists
            const collection = await this.collectionRepository.findCollectionById(collectionId.trim());
            if (!collection) {
                res.status(404).json({ error: 'Collection not found' });
                return;
            }

            const { role } = await this.getCollectionOrRole(collectionId.trim(), user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }
            if (role === CollectionRole.VIEWER) {
                res.status(403).json({ error: 'Forbidden: You do not have edit access to this collection' });
                return;
            }

            const folder = await this.collectionRepository.createFolder({
                collectionId: collectionId.trim(),
                parentId: validatedData.parentId || null,
                name: validatedData.name,
                metadata: validatedData.metadata || {},
                ownerId: user.id,
                ownerEmail: user.email,
            });
            await vespaQueue.addJob({
                schema: 'file',
                docId: folder.id,
                jobType: 'feed',
                userId: user.id,
                app: SubApp.COLLECTIONS,
            });

            logger.info(`📁 [NODE] Folder ${folder.id} created in collection ${collectionId} by user ${user.id}`);

            res.status(201).json({
                success: true,
                folder,
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                res.status(400).json({ error: 'Validation failed', details: error.errors });
                return;
            }
            logger.error('Error creating folder:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    uploadFiles = async (req: Request, res: Response): Promise<void> => {
        const MAX_FILE_SIZE_MB = 100;

        try {
            const { collectionId } = req.params;
            const user = req.user;

            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!collectionId || typeof collectionId !== 'string' || collectionId.trim() === '') {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            // Check if collection exists
            const { role } = await this.getCollectionOrRole(collectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }
            if (role === CollectionRole.VIEWER) {
                res.status(403).json({ error: 'Forbidden: You do not have edit access to this collection' });
                return;
            }

            // Validate files
            if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
                res.status(400).json({ error: 'No files provided' });
                return;
            }

            // Validate request body
            const validatedData = uploadFilesSchema.parse({
                duplicateStrategy: req.body.duplicateStrategy || 'rename',
                parentId: req.body.parentId || null,
                sessionId: req.body.sessionId,
            });
            const isBdTeam = req.body.isBdTeam === 'true';
            logger.info(`[UPLOAD] isBdTeam=${isBdTeam}, raw=${req.body.isBdTeam}`);
            // Parse paths if provided (JSON array)
            let paths: string[] = [];
            if (req.body.paths) {
                try {
                    paths = JSON.parse(req.body.paths);
                    if (!Array.isArray(paths)) {
                        paths = [];
                    }
                } catch {
                    logger.warn('Failed to parse paths, using empty array');
                }
            }

            const files = req.files as Express.Multer.File[];
            const results: any[] = [];
            const errors: any[] = [];

            logger.info(`[UPLOAD] Starting upload of ${files.length} files to collection ${collectionId}`);

            // First pass: parse CSV files to extract slide URL mappings
            // Map: pdf_filename → { "slideNumber": "url", ... }
            let slideUrlMap = new Map<string, Record<string, string>>();
            const csvFileIndices = new Set<number>();
            if (isBdTeam) {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    if (file.originalname.toLowerCase().endsWith('.csv')) {
                        try {
                            const parsed = parseSlideUrlCsv(file.buffer);
                            if (Object.keys(parsed).length > 0) {
                                csvFileIndices.add(i);
                                // Derive matching PDF filename from CSV filename
                                const pdfFilename = file.originalname.replace(/\.csv$/i, '.pdf');
                                slideUrlMap.set(pdfFilename, parsed);
                                logger.info(`[UPLOAD] Parsed slide URL CSV: ${file.originalname} → ${pdfFilename} (${Object.keys(parsed).length} slides)`);
                            }
                        } catch (error) {
                            logger.warn(`[UPLOAD] Failed to parse CSV ${file.originalname} as slide URL mapping, treating as regular file`, error);
                        }
                    }
                }
            }

            // Process each file
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const filePath = paths[i] || '';

                try {
                    // Skip CSV files that were parsed as slide URL mappings
                    if (csvFileIndices.has(i)) {
                        logger.info(`[UPLOAD] Skipping slide URL CSV: ${file.originalname}`);
                        results.push({
                            fileName: file.originalname,
                            status: 'success',
                            reason: 'slide_url_csv',
                        });
                        continue;
                    }

                    // Check if this is a ZIP file
                    if (this.isZipFile(file)) {
                        logger.info(`[UPLOAD] Detected ZIP file: ${file.originalname}`);
                        // Map string value to enum
                        const strategyMap: Record<string, DuplicateStrategy> = {
                            'skip': DuplicateStrategy.SKIP,
                            'rename': DuplicateStrategy.RENAME,
                            'overwrite': DuplicateStrategy.OVERWRITE,
                        };
                        const duplicateStrategy = strategyMap[validatedData.duplicateStrategy] || DuplicateStrategy.RENAME;
                        await this.processZipFile(
                            file,
                            collectionId,
                            validatedData.parentId ?? null,
                            { id: user.id, email: user.email },
                            duplicateStrategy,
                            validatedData.sessionId,
                            results,
                            errors
                        );
                        continue;
                    }
                
                    // Validate file size
                    checkFileSize(file.size, MAX_FILE_SIZE_MB);

                    // Calculate checksum
                    const checksum = calculateChecksum(file.buffer);

                    // Detect MIME type
                    const mimeType = await detectMimeType(
                        file.originalname,
                        file.buffer,
                        file.mimetype
                    );

                    // Determine parent folder (create if needed)
                    let parentId: string | null = validatedData.parentId ?? null;
                    if (filePath) {
                        parentId = await this.ensureFolderPath(
                            collectionId,
                            filePath,
                            validatedData.parentId ?? null,
                            user.id,
                            user.email
                        );
                    }

                    // Handle duplicate checking
                    let finalFileName = file.originalname;
                    const existingItem = await this.collectionRepository.findItemByPath(
                        collectionId,
                        parentId,
                        file.originalname
                    );

                    if (existingItem) {
                        if (validatedData.duplicateStrategy === DuplicateStrategy.SKIP) {
                            logger.info(`[UPLOAD] Skipping duplicate file: ${file.originalname}`);
                            results.push({
                                fileName: file.originalname,
                                status: 'skipped',
                                reason: 'duplicate',
                            });
                            continue;
                        } else if (validatedData.duplicateStrategy === DuplicateStrategy.RENAME) {
                            // Get all existing names in the same folder
                            const siblingItems = await this.collectionRepository.findItemsByCollectionAndParentId(
                                collectionId,
                                parentId
                            );
                            const existingNames = siblingItems.map(item => item.name);
                            finalFileName = generateUniqueName(file.originalname, existingNames);
                            logger.info(`[UPLOAD] Renamed ${file.originalname} to ${finalFileName}`);
                        } else if (validatedData.duplicateStrategy === DuplicateStrategy.OVERWRITE) {
                            // Soft delete the existing item
                            await this.collectionRepository.softDeleteItem(existingItem.id);
                            logger.info(`[UPLOAD] Overwriting existing file: ${file.originalname}`);
                        }
                    }

                    // Upload to GCS
                   const result = await gcsService.uploadFile(file.buffer, {
                        filename: finalFileName,
                        contentType: mimeType,
                        scopeType: 'collection',
                        scopeId: collectionId,
                    });

                    // Generate storage key for DB record (GCS generates its own path)
                    const storageKey = result.gcsPath;

                    // Create database record
                    const fileSlideUrls = slideUrlMap.get(file.originalname);
                    const item = await this.collectionRepository.createFileItem({
                        collectionId,
                        parentId,
                        name: finalFileName,
                        storageKey,
                        mimeType,
                        fileSize: file.size,
                        checksum,
                        metadata: {
                            originalName: file.originalname,
                            uploadedAt: new Date().toISOString(),
                            sessionId: validatedData.sessionId,
                            ...(fileSlideUrls ? { slideUrls: fileSlideUrls } : {}),
                        },
                        ownerId: user.id,
                        ownerEmail: user.email,
                        uploadStatus: UploadStatus.PENDING,
                    });

                    // Queue for Vespa indexing
                    await vespaQueue.addJob({
                        schema: 'file',
                        docId: item.id,
                        jobType: 'feed',
                        userId: user.id,
                        app: SubApp.COLLECTIONS,
                    });

                    // Fire-and-forget entity tag extraction
                    triggerTagExtraction(item.id, storageKey, mimeType).catch(err =>
                      logger.warn(`[UPLOAD] Entity tag extraction failed for ${item.id}`, {
                        error: err instanceof Error ? err.message : String(err),
                      })
                    );

                    // Fire-and-forget: rename file based on its content via LLM
                    triggerFileRename(item.id, storageKey, file.originalname).catch(err =>
                      logger.warn(`[UPLOAD] File rename failed for ${item.id}`, {
                        error: err instanceof Error ? err.message : String(err),
                      })
                    );

                    logger.info(`[UPLOAD] Successfully uploaded: ${finalFileName} (ID: ${item.id})`);

                    results.push({
                        fileName: finalFileName,
                        itemId: item.id,
                        status: 'success',
                        size: file.size,
                        mimeType,
                    });
                } catch (error) {
                    logger.error(`[UPLOAD] Failed to upload ${file.originalname}:`, error);
                    errors.push({
                        fileName: file.originalname,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                }
            }

            // Flush EventBatcher to emit batched events (SYNC_REQUIRED)
            logger.info(`[UPLOAD] Flushed event batcher for collection ${collectionId}`);

            const response = {
                success: errors.length === 0,
                uploaded: results.length,
                failed: errors.length,
                results,
                errors: errors.length > 0 ? errors : undefined,
            };

            res.status(errors.length === files.length ? 500 : 200).json(response);
        } catch (error) {
            if (error instanceof z.ZodError) {
                res.status(400).json({ error: 'Validation failed', details: error.errors });
                return;
            }
            logger.error('[UPLOAD] Error in uploadFiles:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    /**
     * Check if user has access to a collection
     */
    private async getCollectionOrRole(collectionId: string, userId: string, getCollection: boolean = false): Promise<{role: CollectionRole | null, collection: ({permissions: CollectionPermission[]} & Collection) | null}> {
        const collection = await this.collectionRepository.findCollectionByIdWithPermissions(collectionId);
        if (!collection) {
            return {role: null, collection: null};
        }
        let role: CollectionRole | null = collection.ownerId === userId ? CollectionRole.OWNER : null;
        if (!role && collection.permissions) {
            const permission = collection.permissions.find(p => p.userId === userId);
            if (permission) {
                role = permission.role;
            }
        }
        return {role: role, collection: getCollection ? collection : null};
    }

    /**
     * Helper method to ensure folder path exists, creating folders as needed
     */
    private async ensureFolderPath(
        collectionId: string,
        filePath: string,
        baseParentId: string | null,
        ownerId: string,
        ownerEmail: string
    ): Promise<string | null> {
        if (!filePath || filePath === '/') {
            return baseParentId;
        }

        // Split path into parts, removing empty strings
        const parts = filePath.split('/').filter(p => p.trim() !== '');
        if (parts.length === 0) {
            return baseParentId;
        }

        let currentParentId = baseParentId;

        // Create each folder in the path if it doesn't exist
        for (const folderName of parts) {
            const existingFolder = await this.collectionRepository.findItemByPath(
                collectionId,
                currentParentId,
                folderName
            );

            if (existingFolder) {
                currentParentId = existingFolder.id;
            } else {
                const newFolder = await this.collectionRepository.createFolder({
                    collectionId,
                    parentId: currentParentId,
                    name: folderName,
                    metadata: { autoCreated: true },
                    ownerId,
                    ownerEmail,
                });
                currentParentId = newFolder.id;
                logger.info(`[UPLOAD] Auto-created folder: ${folderName}`);
                await vespaQueue.addJob({
                    schema: 'file',
                    docId: newFolder.id,
                    jobType: 'feed',
                    userId: ownerId,
                    app: SubApp.COLLECTIONS,
                });

                // Push to EventBatcher instead of publishing immediately
                // This will be batched with other folder/file creation events
            }
        }

        return currentParentId;
    }

    /**
     * Check if a file is a ZIP archive
     */
    private isZipFile(file: Express.Multer.File): boolean {
        const zipMimeTypes = [
            'application/zip',
            'application/x-zip-compressed',
            'application/x-zip',
            'multipart/x-zip',
        ];
        const hasZipMimeType = zipMimeTypes.includes(file.mimetype);
        const hasZipExtension = file.originalname.toLowerCase().endsWith('.zip');
        return hasZipMimeType || hasZipExtension;
    }

    /**
     * Check if a file extension is dangerous/executable
     */
    private isDangerousExtension(fileName: string): boolean {
        const dangerousExtensions = [
            '.exe', '.bat', '.cmd', '.sh', '.msi', '.dmg', '.app',
            '.jar', '.js', '.vbs', '.ps1', '.scr', '.com', '.pif',
        ];
        const lowerFileName = fileName.toLowerCase();
        return dangerousExtensions.some(ext => lowerFileName.endsWith(ext));
    }

    /**
     * Sanitize file path to prevent path traversal attacks
     */
    private sanitizeFilePath(filePath: string): string {
        // Remove any path traversal attempts
        let sanitized = filePath.replace(/\.\.[\\/]/g, '');
        // Remove leading slashes
        sanitized = sanitized.replace(/^[\\/]+/, '');
        // Normalize path separators
        sanitized = sanitized.replace(/\\/g, '/');
        return sanitized;
    }

    /**
     * Process a ZIP file by extracting and uploading each entry
     */
    private async processZipFile(
        zipFile: Express.Multer.File,
        collectionId: string,
        baseParentId: string | null,
        user: { id: string; email: string },
        duplicateStrategy: DuplicateStrategy,
        sessionId: string | undefined,
        results: any[],
        errors: any[]
    ): Promise<void> {
        const MAX_FILES_IN_ZIP = 10000;
        const MAX_TOTAL_SIZE_MB = 500;
        const MAX_TOTAL_SIZE_BYTES = MAX_TOTAL_SIZE_MB * 1024 * 1024;

        logger.info(`[ZIP] Starting extraction of ZIP file: ${zipFile.originalname}`);

        let fileCount = 0;
        let totalExtractedSize = 0;

        try {
            // Create a readable stream from the buffer
            const stream = Readable.from(zipFile.buffer);
            const directory = stream.pipe(unzipper.Parse({ forceStream: true }));

            for await (const entry of directory) {
                const entryPath = entry.path;
                const entryType = entry.type;

                // Skip directories
                if (entryType === 'Directory') {
                    entry.autodrain();
                    continue;
                }

                // Check file count limit
                fileCount++;
                if (fileCount > MAX_FILES_IN_ZIP) {
                    entry.autodrain();
                    errors.push({
                        fileName: zipFile.originalname,
                        error: `ZIP contains too many files. Maximum allowed: ${MAX_FILES_IN_ZIP}`,
                    });
                    logger.error(`[ZIP] Exceeded max file count in ZIP: ${zipFile.originalname}`);
                    return;
                }

                // Sanitize the file path
                const sanitizedPath = this.sanitizeFilePath(entryPath);
                const fileName = sanitizedPath.split('/').pop() || sanitizedPath;

                // Skip dangerous file extensions
                if (this.isDangerousExtension(fileName)) {
                    entry.autodrain();
                    logger.warn(`[ZIP] Skipping dangerous file: ${fileName}`);
                    errors.push({
                        fileName: `${zipFile.originalname}/${fileName}`,
                        error: 'Dangerous file type blocked',
                    });
                    continue;
                }

                // Collect the entry data
                const chunks: Buffer[] = [];
                entry.on('data', (chunk: Buffer) => chunks.push(chunk));

                await new Promise<void>((resolve, reject) => {
                    entry.on('end', () => resolve());
                    entry.on('error', (err: Error) => reject(err));
                });

                const fileBuffer = Buffer.concat(chunks);
                const fileSize = fileBuffer.length;

                // Check total extracted size
                totalExtractedSize += fileSize;
                if (totalExtractedSize > MAX_TOTAL_SIZE_BYTES) {
                    errors.push({
                        fileName: zipFile.originalname,
                        error: `Total extracted size exceeds ${MAX_TOTAL_SIZE_MB}MB limit`,
                    });
                    logger.error(`[ZIP] Exceeded max total size for ZIP: ${zipFile.originalname}`);
                    return;
                }

                // Process this file like a normal upload
                try {
                    const result = await this.processSingleFile(
                        fileBuffer,
                        fileName,
                        sanitizedPath,
                        fileSize,
                        collectionId,
                        baseParentId,
                        user,
                        duplicateStrategy,
                        sessionId
                    );

                    if (result) {
                        results.push(result);
                    }
                } catch (error) {
                    logger.error(`[ZIP] Failed to process file ${fileName} from ZIP:`, error);
                    errors.push({
                        fileName: `${zipFile.originalname}/${fileName}`,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                }
            }

            logger.info(`[ZIP] Successfully extracted ${fileCount} files from ${zipFile.originalname}`);
        } catch (error) {
            logger.error(`[ZIP] Error processing ZIP file ${zipFile.originalname}:`, error);
            errors.push({
                fileName: zipFile.originalname,
                error: error instanceof Error ? error.message : 'Failed to process ZIP file',
            });
        }
    }

    /**
     * Process a single file (used for both normal uploads and ZIP extraction)
     */
    private async processSingleFile(
        fileBuffer: Buffer,
        originalName: string,
        filePath: string,
        fileSize: number,
        collectionId: string,
        baseParentId: string | null,
        user: { id: string; email: string },
        duplicateStrategy: DuplicateStrategy,
        sessionId: string | undefined
    ): Promise<{ fileName: string; itemId: string; status: string; size: number; mimeType: string } | null> {
        const MAX_FILE_SIZE_MB = 100;

        // Validate file size
        checkFileSize(fileSize, MAX_FILE_SIZE_MB);

        // Calculate checksum
        const checksum = calculateChecksum(fileBuffer);

        // Detect MIME type
        const mimeType = await detectMimeType(originalName, fileBuffer, undefined);

        // Determine parent folder (create if needed)
        let parentId: string | null = baseParentId;
        const pathDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
        if (pathDir) {
            parentId = await this.ensureFolderPath(
                collectionId,
                pathDir,
                baseParentId,
                user.id,
                user.email
            );
        }

        // Handle duplicate checking
        let finalFileName = originalName;
        const existingItem = await this.collectionRepository.findItemByPath(
            collectionId,
            parentId,
            originalName
        );

        if (existingItem) {
            if (duplicateStrategy === DuplicateStrategy.SKIP) {
                logger.info(`[UPLOAD] Skipping duplicate file: ${originalName}`);
                return null;
            } else if (duplicateStrategy === DuplicateStrategy.RENAME) {
                const siblingItems = await this.collectionRepository.findItemsByCollectionAndParentId(
                    collectionId,
                    parentId
                );
                const existingNames = siblingItems.map(item => item.name);
                finalFileName = generateUniqueName(originalName, existingNames);
                logger.info(`[UPLOAD] Renamed ${originalName} to ${finalFileName}`);
            } else if (duplicateStrategy === DuplicateStrategy.OVERWRITE) {
                await this.collectionRepository.softDeleteItem(existingItem.id);
                logger.info(`[UPLOAD] Overwriting existing file: ${originalName}`);
            }
        }

        // Upload to GCS
        const result = await gcsService.uploadFile(fileBuffer, {
            filename: finalFileName,
            contentType: mimeType,
            scopeType: 'collection',
            scopeId: collectionId,
        });

        const storageKey = result.gcsPath;

        // Create database record
        const item = await this.collectionRepository.createFileItem({
            collectionId,
            parentId,
            name: finalFileName,
            storageKey,
            mimeType,
            fileSize: fileSize,
            checksum,
            metadata: {
                originalName,
                uploadedAt: new Date().toISOString(),
                sessionId,
                extractedFromZip: true,
            },
            ownerId: user.id,
            ownerEmail: user.email,
            uploadStatus: UploadStatus.PENDING,
        });

        // Queue for Vespa indexing
        await vespaQueue.addJob({
            schema: 'file',
            docId: item.id,
            jobType: 'feed',
            userId: user.id,
            app: SubApp.COLLECTIONS,
        });

        logger.info(`[UPLOAD] Successfully uploaded: ${finalFileName} (ID: ${item.id})`);

        return {
            fileName: finalFileName,
            itemId: item.id,
            status: 'success',
            size: fileSize,
            mimeType,
        };
    }

    /**
     * Download a folder as a zip file
     * Streams files from GCS and creates zip on-the-fly (memory efficient)
     */
    downloadFolder = async (req: Request, res: Response): Promise<void> => {
        try {
            const { itemId } = req.params;
            const user = req.user;

            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
                res.status(400).json({ error: 'Item ID is required' });
                return;
            }

            // Get the folder item
            const folder = await this.collectionRepository.findItemById(itemId.trim());

            if (!folder) {
                res.status(404).json({ error: 'Folder not found' });
                return;
            }

            if (folder.type !== 'FOLDER') {
                res.status(400).json({ error: 'Item is not a folder' });
                return;
            }

            // Check permissions on the collection
            const { role } = await this.getCollectionOrRole(folder.collectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }

            // Get all files recursively
            const files = await this.collectionRepository.findAllFilesInFolderRecursively(
                itemId.trim(),
                folder.collectionId
            );

            // Set headers for zip download
            const escapedFilename = folder.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${escapedFilename}.zip"`);

            // Create archiver instance
            const archive = archiver('zip', {
                zlib: { level: 9 }, // Maximum compression
            });

            // Handle archiver errors
            archive.on('error', (err) => {
                logger.error('Archiver error:', err);
                // Only send error if headers haven't been sent yet
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to create zip archive' });
                }
            });

            // Pipe archive to response
            archive.pipe(res);

            // Add each file to the archive
            for (const file of files) {
                try {
                    const stream = await gcsService.createReadStream(file.storageKey);
                    // GCS returns a NodeJS.ReadableStream which is compatible with archiver
                    // We cast through unknown to satisfy TypeScript
                    archive.append(stream as unknown as Parameters<typeof archive.append>[0], { name: file.relativePath });
                } catch (error) {
                    logger.error(`Failed to add file ${file.name} to archive:`, error);
                    // Continue with other files, don't fail the entire download
                }
            }

            // Finalize the archive
            await archive.finalize();

            logger.info(`📦 [DOWNLOAD] Folder "${folder.name}" (${files.length} files) downloaded by user ${user.id}`);
        } catch (error) {
            logger.error('Error downloading folder:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    };

    /**
     * Download a single file
     * Streams file from GCS to response
     */
    downloadFile = async (req: Request, res: Response): Promise<void> => {
        try {
            const { itemId } = req.params;
            const user = req.user;

            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
                res.status(400).json({ error: 'Item ID is required' });
                return;
            }

            // Get the file item
            const file = await this.collectionRepository.findItemById(itemId.trim());

            if (!file) {
                res.status(404).json({ error: 'File not found' });
                return;
            }

            if (file.type !== 'FILE') {
                res.status(400).json({ error: 'Item is not a file' });
                return;
            }

            if (!file.storageKey) {
                logger.error(`File item ${itemId} has no storage key`);
                res.status(500).json({ error: 'File storage path missing' });
                return;
            }

            // Check permissions on the collection
            const { role } = await this.getCollectionOrRole(file.collectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }

            // Set headers for file download
            const escapedFilename = file.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${escapedFilename}"`);

            // Stream file from GCS to response
            const stream = await gcsService.createReadStream(file.storageKey);
            stream.pipe(res);

            stream.on('error', (err) => {
                logger.error(`Error streaming file ${itemId}:`, err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to stream file' });
                }
            });

            logger.info(`📄 [DOWNLOAD] File "${file.name}" downloaded by user ${user.id}`);
        } catch (error) {
            logger.error('Error downloading file:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    };

    getFailedItems = async (req: Request, res: Response): Promise<void> => {
        try {
            const { collectionId } = req.params;
            const user = req.user;

            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!collectionId || typeof collectionId !== 'string' || collectionId.trim() === '') {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            // Check permissions on the collection
            const { role } = await this.getCollectionOrRole(collectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }

            const items = await this.collectionRepository.findFailedItemsByCollectionId(collectionId.trim());

            // Convert BigInt fileSize to string for JSON serialization
            const serializedItems = items.map(item => ({
                ...item,
                fileSize: item.fileSize?.toString() ?? null,
            }));

            res.status(200).json({
                success: true,
                items: serializedItems,
            });
        } catch (error) {
            logger.error('Error fetching failed items:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    searchItems = async (req: Request, res: Response): Promise<void> => {
        try {
            const { collectionId } = req.params;
            const { query } = req.query;
            const user = req.user;

            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!collectionId || typeof collectionId !== 'string' || collectionId.trim() === '') {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            // Check permissions on the collection
            const { role } = await this.getCollectionOrRole(collectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }

            // Support both 'q' and 'query' query parameters
            const searchQuery = (query as string) || '';

            if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim() === '') {
                res.status(400).json({ error: 'Search query is required (use ?q= or ?query= parameter)' });
                return;
            }

            const items = await this.collectionRepository.searchItemsByCollectionId(
                collectionId.trim(),
                searchQuery.trim()
            );

            // Convert BigInt fileSize to string for JSON serialization
            const serializedItems = items.map(item => ({
                ...item,
                fileSize: item.fileSize?.toString() ?? null,
            }));

            res.status(200).json({
                success: true,
                items: serializedItems,
                query: searchQuery.trim(),
            });
        } catch (error) {
            logger.error('Error searching items:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    /**
     * Update entity tags for an item
     * PATCH /items/:itemId/tags
     */
    updateItemTags = async (req: Request, res: Response): Promise<void> => {
        try {
            const { itemId } = req.params;
            const { entityTags } = req.body;
            const user = req.user;

            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
                res.status(400).json({ error: 'Item ID is required' });
                return;
            }

            // Validate entityTags structure
            if (!entityTags || typeof entityTags !== 'object') {
                res.status(400).json({ error: 'entityTags is required and must be an object' });
                return;
            }

            const { people, productSpecifications, merchants } = entityTags;

            // Validate each category is an array of strings
            const validateTagArray = (arr: unknown, fieldName: string): string[] => {
                if (!Array.isArray(arr)) {
                    throw new Error(`${fieldName} must be an array`);
                }
                return arr.filter((item): item is string => typeof item === 'string');
            };

            let validatedTags: { people: string[]; productSpecifications: string[]; merchants: string[] };
            try {
                validatedTags = {
                    people: validateTagArray(people, 'people'),
                    productSpecifications: validateTagArray(productSpecifications, 'productSpecifications'),
                    merchants: validateTagArray(merchants, 'merchants'),
                };
            } catch (validationError) {
                res.status(400).json({ error: validationError instanceof Error ? validationError.message : 'Invalid tags format' });
                return;
            }

            // Get the item to check collection access
            const item = await this.collectionRepository.findItemById(itemId.trim());
            if (!item) {
                res.status(404).json({ error: 'Item not found' });
                return;
            }

            // Check permissions on the collection
            const { role } = await this.getCollectionOrRole(item.collectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }
            if (role === CollectionRole.VIEWER) {
                res.status(403).json({ error: 'Forbidden: You do not have edit access to this collection' });
                return;
            }

            // Update the tags
            const updatedItem = await this.collectionRepository.updateItemTags(itemId.trim(), validatedTags);

            // Sync tags to Vespa
            const structuredTags = {
                people: validatedTags.people,
                merchants: validatedTags.merchants,
                productSpecs: validatedTags.productSpecifications,
            };
            vespaClient.crudService.update([{ docId: itemId, fields: { tags: structuredTags } }], fileSchema).catch(err => {
                logger.warn(`[UPDATE_TAGS] Failed to update Vespa tags for ${itemId}`, {
                    error: err instanceof Error ? err.message : String(err),
                });
            });

            logger.info(`🏷️ [TAGS] Updated entity tags for item ${itemId} by user ${user.id}`);

            res.status(200).json({
                success: true,
                item: {
                    id: updatedItem.id,
                    metadata: updatedItem.metadata,
                },
            });
        } catch (error) {
            logger.error('Error updating item tags:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    // ── Version history endpoints ──

    /**
     * Upload a new version of an existing file.
     * The current file is snapshotted to version history before being replaced.
     * POST /items/:itemId/versions
     */
    uploadNewVersion = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = req.user;
            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { itemId } = req.params;
            if (!itemId) {
                res.status(400).json({ error: 'itemId is required' });
                return;
            }

            const item = await this.collectionRepository.findItemById(itemId);
            if (!item) {
                res.status(404).json({ error: 'Item not found' });
                return;
            }
            if (item.type !== 'FILE') {
                res.status(400).json({ error: 'Item is not a file' });
                return;
            }
            if (!item.storageKey || !item.mimeType || item.fileSize === null || item.fileSize === undefined || !item.checksum || !item.uploadedById || !item.uploadedByEmail) {
                res.status(400).json({ error: 'Item file data is incomplete' });
                return;
            }

            const { role } = await this.getCollectionOrRole(item.collectionId, user.id);
            if (!role || role === CollectionRole.VIEWER) {
                res.status(403).json({ error: 'Forbidden: Only editors and owners can replace files' });
                return;
            }

            const file = req.file;
            if (!file) {
                res.status(400).json({ error: 'No file provided' });
                return;
            }

            const MAX_FILE_SIZE_MB = 100;
            checkFileSize(file.size, MAX_FILE_SIZE_MB);
            const checksum = calculateChecksum(file.buffer);
            const mimeType = await detectMimeType(file.originalname, file.buffer, file.mimetype);

            // Snapshot the current version
            await this.collectionRepository.createItemVersion({
                itemId: item.id,
                versionNumber: item.currentVersionNumber,
                storageKey: item.storageKey,
                mimeType: item.mimeType,
                fileSize: item.fileSize,
                checksum: item.checksum,
                uploadedById: item.uploadedById,
                uploadedByEmail: item.uploadedByEmail,
            });

            // Upload new file to GCS
            const result = await gcsService.uploadFile(file.buffer, {
                filename: item.name,
                contentType: mimeType,
                scopeType: 'collection',
                scopeId: item.collectionId,
            });
            const newStorageKey = result.gcsPath;

            // Update item to point to new file
            const newVersionNumber = item.currentVersionNumber + 1;
            await this.collectionRepository.updateItemFileFields(itemId, {
                storageKey: newStorageKey,
                mimeType,
                fileSize: BigInt(file.size),
                checksum,
                uploadedById: user.id,
                uploadedByEmail: user.email,
                currentVersionNumber: newVersionNumber,
                versionCount: item.versionCount + 1,
                uploadStatus: UploadStatus.PENDING,
            });

            // Queue Vespa re-indexing
            await vespaQueue.addJob({
                schema: 'file',
                docId: item.id,
                jobType: 'feed',
                userId: user.id,
                app: SubApp.COLLECTIONS,
            });

            logger.info(`[VERSION] Uploaded version ${newVersionNumber} for item ${itemId} by ${user.email}`);
            res.status(200).json({ success: true, versionNumber: newVersionNumber });
        } catch (error) {
            logger.error('Error uploading new version:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    /**
     * List all versions of a file item.
     * The current active version is synthesized as the leading entry with isCurrent=true.
     * GET /items/:itemId/versions
     */
    getItemVersions = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = req.user;
            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { itemId } = req.params;
            if (!itemId) {
                res.status(400).json({ error: 'itemId is required' });
                return;
            }

            const item = await this.collectionRepository.findItemById(itemId);
            if (!item) {
                res.status(404).json({ error: 'Item not found' });
                return;
            }

            const { role } = await this.getCollectionOrRole(item.collectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }

            const historicalVersions = await this.collectionRepository.findItemVersions(itemId);

            // Synthesize the current version as the leading entry
            const currentEntry = {
                id: null,
                itemId: item.id,
                versionNumber: item.currentVersionNumber,
                mimeType: item.mimeType,
                fileSize: item.fileSize !== null ? item.fileSize.toString() : null,
                checksum: item.checksum,
                uploadedById: item.uploadedById,
                uploadedByEmail: item.uploadedByEmail,
                restoredFromVersionId: null,
                metadata: {},
                createdAt: item.updatedAt.toISOString(),
                isCurrent: true,
            };

            const mappedVersions = historicalVersions.map(v => ({
                id: v.id,
                itemId: v.itemId,
                versionNumber: v.versionNumber,
                mimeType: v.mimeType,
                fileSize: v.fileSize.toString(),
                checksum: v.checksum,
                uploadedById: v.uploadedById,
                uploadedByEmail: v.uploadedByEmail,
                restoredFromVersionId: v.restoredFromVersionId,
                metadata: v.metadata,
                createdAt: v.createdAt.toISOString(),
                isCurrent: false,
            }));

            res.status(200).json({ success: true, versions: [currentEntry, ...mappedVersions] });
        } catch (error) {
            logger.error('Error getting item versions:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    /**
     * Restore a file to a previous version.
     * The current version is snapshotted before being replaced.
     * POST /items/:itemId/versions/:versionId/restore
     */
    restoreItemVersion = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = req.user;
            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { itemId, versionId } = req.params;
            if (!itemId || !versionId) {
                res.status(400).json({ error: 'itemId and versionId are required' });
                return;
            }

            const item = await this.collectionRepository.findItemById(itemId);
            if (!item) {
                res.status(404).json({ error: 'Item not found' });
                return;
            }

            const version = await this.collectionRepository.findItemVersionById(versionId);
            if (!version || version.itemId !== itemId) {
                res.status(404).json({ error: 'Version not found' });
                return;
            }

            const { role } = await this.getCollectionOrRole(item.collectionId, user.id);
            if (!role || role === CollectionRole.VIEWER) {
                res.status(403).json({ error: 'Forbidden: Only editors and owners can restore versions' });
                return;
            }

            if (!item.storageKey || !item.mimeType || item.fileSize === null || item.fileSize === undefined || !item.checksum || !item.uploadedById || !item.uploadedByEmail) {
                res.status(400).json({ error: 'Item file data is incomplete' });
                return;
            }

            // Snapshot current version (mark it as a restore-triggered snapshot)
            await this.collectionRepository.createItemVersion({
                itemId: item.id,
                versionNumber: item.currentVersionNumber,
                storageKey: item.storageKey,
                mimeType: item.mimeType,
                fileSize: item.fileSize,
                checksum: item.checksum,
                uploadedById: item.uploadedById,
                uploadedByEmail: item.uploadedByEmail,
                restoredFromVersionId: versionId,
            });

            // Update item to point at the old version's file
            const newVersionNumber = item.currentVersionNumber + 1;
            await this.collectionRepository.updateItemFileFields(itemId, {
                storageKey: version.storageKey,
                mimeType: version.mimeType,
                fileSize: version.fileSize,
                checksum: version.checksum,
                uploadedById: user.id,
                uploadedByEmail: user.email,
                currentVersionNumber: newVersionNumber,
                versionCount: item.versionCount + 1,
                uploadStatus: UploadStatus.PENDING,
            });

            // Queue Vespa re-indexing
            await vespaQueue.addJob({
                schema: 'file',
                docId: item.id,
                jobType: 'feed',
                userId: user.id,
                app: SubApp.COLLECTIONS,
            });

            logger.info(`[VERSION] Restored item ${itemId} to version ${version.versionNumber} by ${user.email}`);
            res.status(200).json({ success: true, versionNumber: newVersionNumber });
        } catch (error) {
            logger.error('Error restoring item version:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    /**
     * Download a specific historical version of a file.
     * GET /items/:itemId/versions/:versionId/download
     */
    downloadItemVersion = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = req.user;
            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { itemId, versionId } = req.params;
            if (!itemId || !versionId) {
                res.status(400).json({ error: 'itemId and versionId are required' });
                return;
            }

            const item = await this.collectionRepository.findItemById(itemId);
            if (!item) {
                res.status(404).json({ error: 'Item not found' });
                return;
            }

            const version = await this.collectionRepository.findItemVersionById(versionId);
            if (!version || version.itemId !== itemId) {
                res.status(404).json({ error: 'Version not found' });
                return;
            }

            const { role } = await this.getCollectionOrRole(item.collectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }

            const escapedFilename = item.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            res.setHeader('Content-Type', version.mimeType);
            res.setHeader('Content-Disposition', `attachment; filename="${escapedFilename}"`);

            const stream = await gcsService.createReadStream(version.storageKey);
            stream.pipe(res);

            stream.on('error', (err) => {
                logger.error(`Error streaming version ${versionId} of item ${itemId}:`, err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to stream file' });
                }
            });
        } catch (error) {
            logger.error('Error downloading item version:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}
