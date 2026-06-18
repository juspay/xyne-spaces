import { Request, Response } from 'express';
import { CollectionRepository } from '../database/repositories/collectionRepository';
import { logger } from '@/utils/logger';
import { z } from 'zod';
import { uploadFilesSchema, DuplicateStrategy } from '../validators/fileUploadValidator';
import { storageService } from '@/services/storage';
import { fileValidationService } from '@/services/fileValidationService';
import { vespaQueue } from '@/queues/vespaQueue';
import { SubApp } from '@/vespa/src/types';
import { CollectionRole, CollectionPermission, IngestionStatus, Collection } from '@prisma/client';
import archiver from 'archiver';
import unzipper from 'unzipper';
import {
    resolveCollectionAccess,
    listAccessibleRootCollections,
    expandCollectionTrees,
} from '@/services/collectionAccess';

export class CollectionController {
    private collectionRepository: CollectionRepository;

    constructor() {
        this.collectionRepository = new CollectionRepository();
    }

uploadFiles = async (req: Request, res: Response): Promise<void> => {
        try {
            const { collectionId } = req.params;
            const user = req.user;

            if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }
            if (!collectionId || typeof collectionId !== 'string' || collectionId.trim() === '') {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            const { role } = await this.getCollectionOrRole(collectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }
            if (role === CollectionRole.VIEWER) {
                res.status(403).json({ error: 'Forbidden: You do not have edit access to this collection' });
                return;
            }

            if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
                res.status(400).json({ error: 'No files provided' });
                return;
            }

            const validatedData = uploadFilesSchema.parse({
                duplicateStrategy: req.body.duplicateStrategy || 'rename',
                parentId: req.body.parentId || null,
                sessionId: req.body.sessionId,
            });
            let paths: string[] = [];
            if (req.body.paths) {
                try {
                    paths = JSON.parse(req.body.paths);
                    if (!Array.isArray(paths)) paths = [];
                } catch {
                    logger.warn('Failed to parse paths, using empty array');
                }
            }

            const files = req.files as Express.Multer.File[];
            const results: any[] = [];
            const errors: any[] = [];

            logger.info(`[UPLOAD] Starting upload of ${files.length} files to collection ${collectionId}`);

            // parentFolderId: the immediate folder to upload into (defaults to root collection)
            const baseParentFolderId = validatedData.parentId ?? collectionId;

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const filePath = paths[i] || '';

                try {
                    if (this.isZipFile(file)) {
                        const strategyMap: Record<string, DuplicateStrategy> = {
                            skip: DuplicateStrategy.SKIP,
                            rename: DuplicateStrategy.RENAME,
                            overwrite: DuplicateStrategy.OVERWRITE,
                        };
                        const duplicateStrategy = strategyMap[validatedData.duplicateStrategy] || DuplicateStrategy.RENAME;
                        try {
                            await this.processZipFile(
                                file.path, file.originalname, collectionId, baseParentFolderId,
                                { id: user.id, email: user.email, workspaceId: user.workspaceId },
                                duplicateStrategy, results, errors
                            );
                        } finally {
                            // ZIP was streamed to GCS as a staging file; delete it after extraction
                            await storageService.deleteFile(file.path).catch((err: unknown) =>
                                logger.warn('[UPLOAD] Failed to delete staged ZIP from GCS', {
                                    path: file.path,
                                    error: err instanceof Error ? err.message : String(err),
                                })
                            );
                        }
                        continue;
                    }

                    const mimeType = file.mimetype;

                    // Resolve folder for this file
                    let parentFolderId = baseParentFolderId;
                    if (filePath) {
                        parentFolderId = await this.ensureFolderPath(
                            collectionId, filePath, baseParentFolderId, user.id
                        );
                    }

                    // Duplicate checking
                    let finalFileName = file.originalname;
                    const existingItem = await this.collectionRepository.findItemByPath(parentFolderId, file.originalname);

                    if (existingItem) {
                        if (validatedData.duplicateStrategy === DuplicateStrategy.SKIP) {
                            // File was already streamed to GCS; clean it up
                            await storageService.deleteFile(file.path).catch((err: unknown) =>
                                logger.warn('[UPLOAD] Failed to delete skipped duplicate from GCS', {
                                    path: file.path,
                                    error: err instanceof Error ? err.message : String(err),
                                })
                            );
                            results.push({ fileName: file.originalname, status: 'skipped', reason: 'duplicate' });
                            continue;
                        } else if (validatedData.duplicateStrategy === DuplicateStrategy.RENAME) {
                            const siblings = await this.collectionRepository.findItemsByCollectionAndParentId(parentFolderId);
                            finalFileName = this.generateUniqueName(file.originalname, siblings.map(s => s.name));
                        } else if (validatedData.duplicateStrategy === DuplicateStrategy.OVERWRITE) {
                            await this.collectionRepository.softDeleteItem(existingItem.id);
                        }
                    }

                    // File is already in GCS (uploaded by streaming middleware)
                    const storageKey = file.path;

                    const item = await this.collectionRepository.createFileItem({
                        rootCollectionId: collectionId,
                        collectionId: parentFolderId,
                        name: finalFileName,
                        storageKey,
                        mimeType,
                        fileSize: file.size,
                        ownerId: user.id,
                        workspaceId: user.workspaceId,
                        ingestionStatus: IngestionStatus.PENDING,
                    });

                    await vespaQueue.addJob({ schema: 'file', docId: item.fileId, jobType: 'feed', userId: user.id, app: SubApp.COLLECTIONS });

                    logger.info(`[UPLOAD] Successfully uploaded: ${finalFileName} (ID: ${item.id})`);
                    results.push({ fileName: finalFileName, itemId: item.id, status: 'success', size: file.size, mimeType });
                } catch (error) {
                    logger.error(`[UPLOAD] Failed to upload ${file.originalname}:`, error);
                    errors.push({ fileName: file.originalname, error: error instanceof Error ? error.message : 'Unknown error' });
                }
            }

            res.status(errors.length === files.length ? 500 : 200).json({
                success: errors.length === 0,
                uploaded: results.length,
                failed: errors.length,
                results,
                errors: errors.length > 0 ? errors : undefined,
            });
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
     * Check user role on a root collection (collectionId must be a root Collection.id).
     *
     * Delegates to services/collectionAccess.resolveCollectionAccess so that owner,
     * direct user permission, group-membership permission, and public-fallback are
     * all evaluated in one place. The earlier inline check honoured direct user
     * perms only — group-granted access was silently denied.
     */
    private async getCollectionOrRole(
        collectionId: string,
        userId: string
    ): Promise<{ role: CollectionRole | null; collection: ({ permissions: CollectionPermission[] } & Collection) | null }> {
        const collection = await this.collectionRepository.findCollectionByIdWithPermissions(collectionId);
        if (!collection) return { role: null, collection: null };

        const { role } = await resolveCollectionAccess(userId, {
            ownerId: collection.ownerId,
            isPrivate: collection.isPrivate,
            permissions: collection.permissions,
        });
        return { role, collection };
    }

    /**
     * GET /api/collections/accessible
     *
     * List every root collection the requesting user can access (owner, direct
     * permission, group permission, or public). When ?includeItems=1, expand
     * each root into its full sub-folder + file tree so the claw KB picker can
     * render a per-file selector.
     */
    listAccessibleCollections = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = req.user;
            if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }

            const includeItems = req.query.includeItems === '1' || req.query.includeItems === 'true';
            const scopeType = typeof req.query.scopeType === 'string' ? req.query.scopeType : undefined;
            const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;

            const roots = await listAccessibleRootCollections(user.id, { scopeType, scopeId });
            const collections = includeItems ? await expandCollectionTrees(roots) : roots;

            res.status(200).json({ success: true, collections });
        } catch (error) {
            logger.error('Error listing accessible collections:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    /**
     * Ensure all folders in a path exist under the given base folder, creating them if needed.
     * Returns the ID of the deepest folder.
     */
    private async ensureFolderPath(
        collectionId: string,
        filePath: string,
        baseParentFolderId: string,
        ownerId: string
    ): Promise<string> {
        if (!filePath || filePath === '/') return baseParentFolderId;

        const collection = await this.collectionRepository.findCollectionById(collectionId);
        if (!collection) return baseParentFolderId;

        const parts = filePath.split('/').filter(p => p.trim() !== '');
        if (parts.length === 0) return baseParentFolderId;

        let currentFolderId = baseParentFolderId;

        for (const folderName of parts) {
            const existing = await this.collectionRepository.findFolderByName(currentFolderId, folderName);
            if (existing) {
                currentFolderId = existing.id;
            } else {
                const newFolder = await this.collectionRepository.createFolder({
                    parentFolderId: currentFolderId,
                    name: folderName,
                    ownerId,
                    scopeType: collection.scopeType,
                    scopeId: collection.scopeId,
                });
                currentFolderId = newFolder.id;
                logger.info(`[UPLOAD] Auto-created folder: ${folderName}`);
                await vespaQueue.addJob({ schema: 'file', docId: newFolder.id, jobType: 'feed', userId: ownerId, app: SubApp.COLLECTIONS });
            }
        }

        return currentFolderId;
    }

    private generateUniqueName(filename: string, existingNames: string[]): string {
        const existing = new Set(existingNames);
        if (!existing.has(filename)) return filename;
        const lastDot = filename.lastIndexOf('.');
        const base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;
        const ext = lastDot !== -1 ? filename.slice(lastDot) : '';
        let counter = 1;
        let candidate = `${base} (${counter})${ext}`;
        while (existing.has(candidate)) { counter += 1; candidate = `${base} (${counter})${ext}`; }
        return candidate;
    }

    private isZipFile(file: Express.Multer.File): boolean {
        const zipMimeTypes = ['application/zip', 'application/x-zip-compressed', 'application/x-zip', 'multipart/x-zip'];
        return zipMimeTypes.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.zip');
    }

    private sanitizeFilePath(filePath: string): string {
        let sanitized = filePath.replace(/\.\.[\\/]/g, '');
        sanitized = sanitized.replace(/^[\\/]+/, '');
        sanitized = sanitized.replace(/\\/g, '/');
        return sanitized;
    }

    private async processZipFile(
        zipGcsPath: string,
        zipOriginalName: string,
        collectionId: string,
        baseParentFolderId: string,
        user: { id: string; email: string; workspaceId: string },
        duplicateStrategy: DuplicateStrategy,
        results: any[],
        errors: any[]
    ): Promise<void> {
        const MAX_FILES_IN_ZIP = 10000;
        const MAX_TOTAL_SIZE_BYTES = 500 * 1024 * 1024;

        logger.info(`[ZIP] Starting extraction of ZIP file: ${zipOriginalName}`);
        let fileCount = 0;
        let totalExtractedSize = 0;

        try {
            const gcsStream = await storageService.createReadStream(zipGcsPath);
            const directory = gcsStream.pipe(unzipper.Parse({ forceStream: true }));

            for await (const entry of directory) {
                const entryPath = entry.path;
                const entryType = entry.type;

                if (entryType === 'Directory') { entry.autodrain(); continue; }

                fileCount++;
                if (fileCount > MAX_FILES_IN_ZIP) {
                    entry.autodrain();
                    errors.push({ fileName: zipOriginalName, error: `ZIP contains too many files. Maximum: ${MAX_FILES_IN_ZIP}` });
                    return;
                }

                const sanitizedPath = this.sanitizeFilePath(entryPath);
                const fileName = sanitizedPath.split('/').pop() || sanitizedPath;

                if (!fileValidationService.isFileTypeAllowed('application/octet-stream', fileName)) {
                    entry.autodrain();
                    errors.push({ fileName: `${zipOriginalName}/${fileName}`, error: 'Dangerous file type blocked' });
                    continue;
                }

                const chunks: Buffer[] = [];
                entry.on('data', (chunk: Buffer) => chunks.push(chunk));
                await new Promise<void>((resolve, reject) => {
                    entry.on('end', () => resolve());
                    entry.on('error', (err: Error) => reject(err));
                });

                const fileBuffer = Buffer.concat(chunks);
                totalExtractedSize += fileBuffer.length;
                if (totalExtractedSize > MAX_TOTAL_SIZE_BYTES) {
                    errors.push({ fileName: zipOriginalName, error: 'Total extracted size exceeds 500MB limit' });
                    return;
                }

                try {
                    const result = await this.processSingleFile(
                        fileBuffer, fileName, sanitizedPath, fileBuffer.length,
                        collectionId, baseParentFolderId, user, duplicateStrategy
                    );
                    if (result) results.push(result);
                } catch (error) {
                    logger.error(`[ZIP] Failed to process file ${fileName} from ZIP:`, error);
                    errors.push({ fileName: `${zipOriginalName}/${fileName}`, error: error instanceof Error ? error.message : 'Unknown error' });
                }
            }
            logger.info(`[ZIP] Successfully extracted ${fileCount} files from ${zipOriginalName}`);
        } catch (error) {
            logger.error(`[ZIP] Error processing ZIP file ${zipOriginalName}:`, error);
            errors.push({ fileName: zipOriginalName, error: error instanceof Error ? error.message : 'Failed to process ZIP file' });
        }
    }

    private async processSingleFile(
        fileBuffer: Buffer,
        originalName: string,
        filePath: string,
        fileSize: number,
        collectionId: string,
        baseParentFolderId: string,
        user: { id: string; email: string; workspaceId: string },
        duplicateStrategy: DuplicateStrategy
    ): Promise<{ fileName: string; itemId: string; status: string; size: number; mimeType: string } | null> {
        const validation = await fileValidationService.validateFile({
            buffer: fileBuffer,
            originalName,
            mimeType: 'application/octet-stream',
            size: fileSize,
        });
        if (!validation.isValid) throw new Error(validation.errors.join(', '));
        const mimeType = 'application/octet-stream';

        let parentFolderId = baseParentFolderId;
        const pathDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
        if (pathDir) {
            parentFolderId = await this.ensureFolderPath(collectionId, pathDir, baseParentFolderId, user.id);
        }

        let finalFileName = originalName;
        const existingItem = await this.collectionRepository.findItemByPath(parentFolderId, originalName);

        if (existingItem) {
            if (duplicateStrategy === DuplicateStrategy.SKIP) return null;
            if (duplicateStrategy === DuplicateStrategy.RENAME) {
                const siblings = await this.collectionRepository.findItemsByCollectionAndParentId(parentFolderId);
                finalFileName = this.generateUniqueName(originalName, siblings.map(s => s.name));
            } else if (duplicateStrategy === DuplicateStrategy.OVERWRITE) {
                await this.collectionRepository.softDeleteItem(existingItem.id);
            }
        }

        const result = await storageService.uploadFile(fileBuffer, {
            filename: finalFileName,
            contentType: mimeType,
            scopeType: 'collection',
            scopeId: collectionId,
        });
        const storageKey = result.path;

        const item = await this.collectionRepository.createFileItem({
            rootCollectionId: collectionId,
            collectionId: parentFolderId,
            name: finalFileName,
            storageKey,
            mimeType,
            fileSize,
            ownerId: user.id,
            workspaceId: user.workspaceId,
            ingestionStatus: IngestionStatus.PENDING,
        });

        await vespaQueue.addJob({ schema: 'file', docId: item.id, jobType: 'feed', userId: user.id, app: SubApp.COLLECTIONS });
        logger.info(`[UPLOAD] Successfully uploaded: ${finalFileName} (ID: ${item.id})`);

        return { fileName: finalFileName, itemId: item.id, status: 'success', size: fileSize, mimeType };
    }

    downloadFolder = async (req: Request, res: Response): Promise<void> => {
        try {
            const { itemId } = req.params;
            const user = req.user;

            if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }
            if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
                res.status(400).json({ error: 'Item ID is required' });
                return;
            }

            const folder = await this.collectionRepository.findFolderById(itemId.trim());
            if (!folder) { res.status(404).json({ error: 'Folder not found' }); return; }

            const rootCollectionId = folder.rootCollectionId ?? folder.id;
            const { role } = await this.getCollectionOrRole(rootCollectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }

            const files = await this.collectionRepository.findAllFilesInFolderRecursively(itemId.trim());

            const escapedFilename = folder.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${escapedFilename}.zip"`);

            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.on('error', (err) => {
                logger.error('Archiver error:', err);
                if (!res.headersSent) res.status(500).json({ error: 'Failed to create zip archive' });
            });
            archive.pipe(res);

            for (const file of files) {
                try {
                    const stream = await storageService.createReadStream(file.storageKey);
                    archive.append(stream as unknown as Parameters<typeof archive.append>[0], { name: file.relativePath });
                } catch (error) {
                    logger.error(`Failed to add file ${file.name} to archive:`, error);
                }
            }

            await archive.finalize();
            logger.info(`📦 [DOWNLOAD] Folder "${folder.name}" (${files.length} files) downloaded by user ${user.id}`);
        } catch (error) {
            logger.error('Error downloading folder:', error);
            if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
        }
    };

    downloadFile = async (req: Request, res: Response): Promise<void> => {
        try {
            const { itemId } = req.params;
            const user = req.user;

            if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }
            if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
                res.status(400).json({ error: 'Item ID is required' });
                return;
            }

            const file = await this.collectionRepository.findItemById(itemId.trim());
            if (!file) { res.status(404).json({ error: 'File not found' }); return; }

            // Version rows are not directly downloadable via this endpoint
            if (!file.isLatest) {
                res.status(400).json({ error: 'Use the version download endpoint for historical versions' });
                return;
            }

            if (!file.attachment?.url) {
                logger.error(`File item ${itemId} has no storage key`);
                res.status(500).json({ error: 'File storage path missing' });
                return;
            }

            const { role } = await this.getCollectionOrRole(file.rootCollectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }

            const escapedFilename = file.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            res.setHeader('Content-Type', file.attachment?.mimetype || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${escapedFilename}"`);

            const stream = await storageService.createReadStream(file.attachment!.url);
            stream.pipe(res);
            stream.on('error', (err) => {
                logger.error(`Error streaming file ${itemId}:`, err);
                if (!res.headersSent) res.status(500).json({ error: 'Failed to stream file' });
            });

            logger.info(`📄 [DOWNLOAD] File "${file.name}" downloaded by user ${user.id}`);
        } catch (error) {
            logger.error('Error downloading file:', error);
            if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
        }
    };

    searchItems = async (req: Request, res: Response): Promise<void> => {
        try {
            const { collectionId } = req.params;
            const { query } = req.query;
            const user = req.user;

            if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }
            if (!collectionId || typeof collectionId !== 'string' || collectionId.trim() === '') {
                res.status(400).json({ error: 'Collection ID is required' });
                return;
            }

            const { role } = await this.getCollectionOrRole(collectionId, user.id);
            if (!role) {
                res.status(403).json({ error: 'Forbidden: You do not have access to this collection' });
                return;
            }

            const searchQuery = (query as string) || '';
            if (!searchQuery.trim()) {
                res.status(400).json({ error: 'Search query is required' });
                return;
            }

            const items = await this.collectionRepository.searchItemsByCollectionId(collectionId.trim(), searchQuery.trim());
            res.status(200).json({
                success: true,
                items: items.map(item => ({ ...item, fileSize: item.fileSize?.toString() ?? null })),
                query: searchQuery.trim(),
            });
        } catch (error) {
            logger.error('Error searching items:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    // ── Version history endpoints ──────────────────────────────────────────

    uploadNewVersion = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = req.user;
            if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }

            const { itemId } = req.params;
            if (!itemId) { res.status(400).json({ error: 'itemId is required' }); return; }

            const item = await this.collectionRepository.findItemById(itemId);
            if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
            if (!item.isLatest) { res.status(400).json({ error: 'Item is a historical version' }); return; }

            const { role } = await this.getCollectionOrRole(item.rootCollectionId, user.id);
            if (!role || role === CollectionRole.VIEWER) {
                res.status(403).json({ error: 'Forbidden: Only editors and owners can replace files' });
                return;
            }

            const file = req.file;
            if (!file) { res.status(400).json({ error: 'No file provided' }); return; }

            // File is already in GCS (streamed by versionUpload middleware)
            const newItem = await this.collectionRepository.createItemVersion({
                currentItemId: item.id,
                storageKey: file.path,
                mimeType: file.mimetype,
                fileSize: BigInt(file.size),
                uploadedById: user.id,
                workspaceId: user.workspaceId,
                ingestionStatus: IngestionStatus.PENDING,
            });

            // Same fileId — feed overwrites the Vespa doc in-place with new version's content
            await vespaQueue.addJob({ schema: 'file', docId: newItem.fileId, jobType: 'feed', userId: user.id, app: SubApp.COLLECTIONS });

            logger.info(`[VERSION] Uploaded version ${newItem.versionNumber} for item ${itemId} by ${user.email}`);
            res.status(200).json({ success: true, versionNumber: newItem.versionNumber });
        } catch (error) {
            logger.error('Error uploading new version:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    getItemVersions = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = req.user;
            if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }

            const { itemId } = req.params;
            if (!itemId) { res.status(400).json({ error: 'itemId is required' }); return; }

            const item = await this.collectionRepository.findItemById(itemId);
            if (!item) { res.status(404).json({ error: 'Item not found' }); return; }

            const { role } = await this.getCollectionOrRole(item.rootCollectionId, user.id);
            if (!role) { res.status(403).json({ error: 'Forbidden' }); return; }

            const allVersions = await this.collectionRepository.findItemVersions(item.fileId);

            const versions = allVersions.map(v => ({
                id: v.id,
                fileId: v.fileId,
                versionNumber: v.versionNumber,
                mimeType: v.attachment?.mimetype ?? null,
                fileSize: v.attachment?.size != null ? String(v.attachment.size) : null,
                uploadedById: v.uploadedById,
                createdAt: v.createdAt.toISOString(),
                isCurrent: v.isLatest,
            }));

            res.status(200).json({ success: true, versions });
        } catch (error) {
            logger.error('Error getting item versions:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    restoreItemVersion = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = req.user;
            if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }

            const { itemId, versionId } = req.params;
            if (!itemId || !versionId) { res.status(400).json({ error: 'itemId and versionId are required' }); return; }

            // itemId here is the current latest row's id
            const item = await this.collectionRepository.findItemById(itemId);
            if (!item || !item.isLatest) { res.status(404).json({ error: 'Item not found' }); return; }

            const version = await this.collectionRepository.findItemVersionById(versionId);
            if (!version || version.fileId !== item.fileId || version.isLatest) {
                res.status(404).json({ error: 'Version not found' });
                return;
            }

            const { role } = await this.getCollectionOrRole(item.rootCollectionId, user.id);
            if (!role || role === CollectionRole.VIEWER) {
                res.status(403).json({ error: 'Forbidden: Only editors and owners can restore versions' });
                return;
            }

            const restored = await this.collectionRepository.restoreItemVersion(item.id, versionId);

            // Same fileId — feed overwrites the Vespa doc in-place with the restored version's content
            await vespaQueue.addJob({ schema: 'file', docId: restored.fileId, jobType: 'feed', userId: user.id, app: SubApp.COLLECTIONS });

            logger.info(`[VERSION] Restored item ${item.fileId} to version ${restored.versionNumber} by ${user.email}`);
            res.status(200).json({ success: true, versionNumber: restored.versionNumber });
        } catch (error) {
            logger.error('Error restoring item version:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    downloadItemVersion = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = req.user;
            if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }

            const { itemId, versionId } = req.params;
            if (!itemId || !versionId) { res.status(400).json({ error: 'itemId and versionId are required' }); return; }

            const item = await this.collectionRepository.findItemById(itemId);
            if (!item) { res.status(404).json({ error: 'Item not found' }); return; }

            const version = await this.collectionRepository.findItemVersionById(versionId);
            if (!version || version.fileId !== item.fileId) { res.status(404).json({ error: 'Version not found' }); return; }

            const { role } = await this.getCollectionOrRole(item.rootCollectionId, user.id);
            if (!role) { res.status(403).json({ error: 'Forbidden' }); return; }

            if (!version.attachment?.url || !version.attachment?.mimetype) {
                res.status(500).json({ error: 'Version file data missing' });
                return;
            }

            const escapedFilename = item.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            res.setHeader('Content-Type', version.attachment!.mimetype);
            res.setHeader('Content-Disposition', `attachment; filename="${escapedFilename}"`);

            const stream = await storageService.createReadStream(version.attachment!.url);
            stream.pipe(res);
            stream.on('error', (err) => {
                logger.error(`Error streaming version ${versionId} of item ${itemId}:`, err);
                if (!res.headersSent) res.status(500).json({ error: 'Failed to stream file' });
            });
        } catch (error) {
            logger.error('Error downloading item version:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}
