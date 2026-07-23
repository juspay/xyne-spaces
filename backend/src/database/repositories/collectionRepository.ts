import { PrismaClient, Collection, CollectionItem, MessageAttachment, IngestionStatus, CollectionRole, AttachmentEntityType } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { v4 as uuidv4 } from 'uuid';

type WithAttachment = { attachment: MessageAttachment | null };

export type CollectionSummary = {
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    ownerId: string;
    canShare: boolean;
    role: CollectionRole;
};

export type CollectionItemSummary = {
    id: string;
    name: string;
    // 'folder' | 'file' — derived, not stored
    itemType: 'folder' | 'file';
    createdAt: Date;
    updatedAt: Date;
    ingestionStatus: string;
    fileSize: bigint | null;
    mimeType: string | null;
    collectionId: string;
};


export class CollectionRepository {
    protected db: PrismaClient;

    constructor() {
        this.db = DatabaseClient.getInstance();
    }

    private async fetchAttachmentsByItemIds(itemIds: string[]): Promise<Map<string, MessageAttachment>> {
        if (itemIds.length === 0) return new Map();
        const attachments = await this.db.messageAttachment.findMany({
            where: { entityId: { in: itemIds }, entityType: AttachmentEntityType.COLLECTION },
        });
        return new Map(attachments.map(a => [a.entityId, a]));
    }

    /**
     * List the immediate contents of a folder:
     *   - sub-folders: Collection rows where parentId = folderId
     *   - files: CollectionItem rows where collectionId = folderId AND isLatest = true
     *
     * folderId is always a Collection.id (for root collections, folderId === collectionId)
     */
    async findItemsByCollectionAndParentId(
        folderId: string
    ): Promise<CollectionItemSummary[]> {
        const [subFolders, files] = await Promise.all([
            this.db.collection.findMany({
                where: { parentId: folderId, deletedAt: null },
                select: {
                    id: true,
                    name: true,
                    createdAt: true,
                    updatedAt: true,
                },
                orderBy: { createdAt: 'desc' },
            }),
            this.db.collectionItem.findMany({
                where: { collectionId: folderId, isLatest: true, deletedAt: null },
                select: {
                    id: true,
                    name: true,
                    createdAt: true,
                    updatedAt: true,
                    ingestionStatus: true,
                    collectionId: true,
                },
                orderBy: { createdAt: 'desc' },
            }),
        ]);

        const attachmentMap = await this.fetchAttachmentsByItemIds(files.map(f => f.id));

        const folderSummaries: CollectionItemSummary[] = subFolders.map(f => ({
            id: f.id,
            name: f.name,
            itemType: 'folder',
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
            ingestionStatus: IngestionStatus.NONE,
            fileSize: null,
            mimeType: null,
            collectionId: folderId,
        }));

        const fileSummaries: CollectionItemSummary[] = files.map(f => {
            const att = attachmentMap.get(f.id);
            return {
                id: f.id,
                name: f.name,
                itemType: 'file',
                createdAt: f.createdAt,
                updatedAt: f.updatedAt,
                ingestionStatus: f.ingestionStatus,
                fileSize: att ? BigInt(att.size) : null,
                mimeType: att?.mimetype ?? null,
                collectionId: f.collectionId,
            };
        });

        // Folders first, then files, each sorted by createdAt desc
        return [...folderSummaries, ...fileSummaries];
    }

    /**
     * Find a canonical file item by ID (excludes version rows)
     */
    async findItemById(id: string): Promise<CollectionItem & WithAttachment | null> {
        const item =
            await this.db.collectionItem.findUnique({ where: { id } }) ??
            await this.db.collectionItem.findFirst({ where: { fileId: id, isLatest: true } });
        if (!item) return null;
        const attachment = await this.db.messageAttachment.findFirst({
            where: { entityId: item.id, entityType: AttachmentEntityType.COLLECTION },
        });
        return { ...item, attachment };
    }

    /**
     * Find a folder (Collection row) by ID
     */
    async findFolderById(id: string): Promise<Collection | null> {
        return await this.db.collection.findUnique({
            where: { id, deletedAt: null },
        });
    }

    /**
     * Find a sub-folder by name within a parent folder
     */
    async findFolderByName(parentFolderId: string, name: string): Promise<Collection | null> {
        return await this.db.collection.findFirst({
            where: {
                parentId: parentFolderId,
                name: { equals: name, mode: 'insensitive' },
                deletedAt: null,
            },
        });
    }

    /**
     * Find collection by ID
     */
    async findCollectionById(id: string): Promise<Collection | null> {
        return await this.db.collection.findUnique({
            where: { id, deletedAt: null },
        });
    }

    /**
     * Find collection by ID with permissions
     */
    async findCollectionByIdWithPermissions(id: string) {
        return await this.db.collection.findUnique({
            where: { id, deletedAt: null },
            include: { permissions: true },
        });
    }

    /**
     * Create a sub-folder inside an existing Collection (root or sub-folder).
     * scopeType + scopeId are inherited from the parent collection.
     */
    async createFolder(data: {
        parentFolderId: string;
        name: string;
        ownerId: string;
        scopeType: string;
        scopeId: string;
    }): Promise<Collection> {
        const parent = await this.db.collection.findUnique({
            where: { id: data.parentFolderId },
            select: { parentId: true, rootCollectionId: true, workspaceId: true },
        });

        if (!parent?.workspaceId) {
            throw new Error(`Could not find workspaceId for parent collection ${data.parentFolderId}`);
        }

        // If parent is a root collection (parentId = null), rootCollectionId = parentFolderId
        // Otherwise inherit parent's rootCollectionId
        const rootCollectionId = parent?.parentId === null ? data.parentFolderId : (parent?.rootCollectionId ?? data.parentFolderId);

        // Inherit isPrivate from the root collection so public collections stay public
        const rootCollection = await this.db.collection.findUnique({
            where: { id: rootCollectionId },
            select: { isPrivate: true },
        });
        const isPrivate = rootCollection?.isPrivate ?? true;

        return await this.db.collection.create({
            data: {
                parentId: data.parentFolderId,
                ownerId: data.ownerId,
                workspaceId: parent.workspaceId,
                scopeType: data.scopeType,
                scopeId: data.scopeId,
                name: data.name,
                rootCollectionId,
                isPrivate,
                createdAt: new Date(),
            },
        });
    }

    /**
     * Create a file item in a folder
     * collectionId = immediate parent folder Collection.id
     * rootCollectionId = root Collection.id (for O(1) collection-scope queries)
     */
    async createFileItem(data: {
        rootCollectionId: string;
        collectionId: string;
        name: string;
        storageKey: string;
        mimeType: string;
        fileSize: number;
        ownerId: string;
        workspaceId: string;
        ingestionStatus?: IngestionStatus;
    }): Promise<CollectionItem> {
        const item = await this.db.collectionItem.create({
            data: {
                rootCollectionId: data.rootCollectionId,
                collectionId: data.collectionId,
                workspaceId: data.workspaceId,
                fileId: uuidv4(),
                ownerId: data.ownerId,
                name: data.name,
                uploadedById: data.ownerId,
                ingestionStatus: data.ingestionStatus ?? IngestionStatus.PENDING,
                versionNumber: 1,
                isLatest: true,
                createdAt: new Date(),
            },
        });

        await this.db.messageAttachment.create({
            data: {
                entityType: AttachmentEntityType.COLLECTION,
                entityId: item.id,
                workspaceId: data.workspaceId,
                storageProvider: 'GCS',
                originalFilename: data.name,
                mimetype: data.mimeType,
                size: data.fileSize,
                url: data.storageKey,
                uploadedByUserId: data.ownerId,
                createdBy: data.ownerId,
            },
        });

        return item;
    }

    /**
     * Find a canonical file by name in a specific folder (for duplicate checking)
     * parentFolderId is a Collection.id
     */
    async findItemByPath(parentFolderId: string, name: string): Promise<CollectionItem | null> {
        return await this.db.collectionItem.findFirst({
            where: {
                collectionId: parentFolderId,
                isLatest: true,
                name: { equals: name, mode: 'insensitive' },
                deletedAt: null,
            },
        });
    }

    /**
     * Update item upload status
     */
    async updateItemIngestionStatus(itemId: string, status: IngestionStatus): Promise<CollectionItem> {
        return await this.db.collectionItem.update({
            where: { id: itemId },
            data: { ingestionStatus: status },
        });
    }

    /**
     * Soft delete a canonical file item and its version rows
     */
    async softDeleteItem(itemId: string): Promise<CollectionItem> {
        const item = await this.db.collectionItem.findUniqueOrThrow({
            where: { id: itemId },
            select: { fileId: true },
        });
        await this.db.collectionItem.updateMany({
            where: { fileId: item.fileId },
            data: { deletedAt: new Date() },
        });
        return await this.db.collectionItem.findUniqueOrThrow({ where: { id: itemId } });
    }

    /**
     * Soft delete a root collection
     */
    async deleteCollection(collectionId: string): Promise<boolean> {
        const collection = await this.db.collection.findUnique({
            where: { id: collectionId },
            select: { id: true },
        });

        if (!collection) return false;

        await this.db.collection.update({
            where: { id: collectionId },
            data: { deletedAt: new Date() },
        });

        return true;
    }

    /**
     * Update a collection (name and/or permissions). Auth must be enforced by the caller.
     */
    async updateCollection(
        collectionId: string,
        data: {
            name?: string;
            permissions?: { userId?: string; userGroupId?: string; role: CollectionRole; canShare?: boolean }[];
        }
    ): Promise<Collection> {
        if (data.permissions) {
            return await this.db.$transaction(async (tx) => {
                if (data.name) {
                    await tx.collection.update({ where: { id: collectionId }, data: { name: data.name } });
                }
                await tx.collectionPermission.deleteMany({ where: { collectionId } });
                if (data.permissions && data.permissions.length > 0) {
                    const now = new Date();
                    const collection = await tx.collection.findUniqueOrThrow({
                        where: { id: collectionId },
                        select: { workspaceId: true },
                    });
                    await tx.collectionPermission.createMany({
                        data: data.permissions.map(p => ({
                            collectionId,
                            workspaceId: collection.workspaceId,
                            userId: p.userId,
                            userGroupId: p.userGroupId,
                            role: p.role,
                            canShare: p.canShare || false,
                            createdAt: now,
                        })),
                    });
                }
                return await tx.collection.findUniqueOrThrow({
                    where: { id: collectionId },
                    include: { permissions: true },
                });
            });
        }

        return await this.db.collection.update({
            where: { id: collectionId },
            data: { name: data.name },
        });
    }

    /**
     * Delete a file item or soft-delete a folder (Collection row). Auth must be enforced by the caller.
     */
    async deleteItem(itemId: string, isFolder: boolean): Promise<boolean> {
        if (isFolder) {
            const folder = await this.db.collection.findUnique({ where: { id: itemId } });
            if (!folder || folder.deletedAt) return false;
            await this.db.collection.update({ where: { id: itemId }, data: { deletedAt: new Date() } });
            return true;
        }

        const item = await this.db.collectionItem.findUnique({ where: { id: itemId } });
        if (!item || !item.isLatest || item.deletedAt) return false;

        await this.softDeleteItem(itemId);
        return true;
    }

    /**
     * Rename a file item or folder. Auth must be enforced by the caller.
     */
    async updateItem(itemId: string, isFolder: boolean, name: string): Promise<Collection | CollectionItem> {
        if (isFolder) {
            const folder = await this.db.collection.findUnique({
                where: { id: itemId, deletedAt: null },
                select: { id: true, name: true, parentId: true },
            });
            if (!folder) throw new Error('Folder not found');

            if (name !== folder.name) {
                const existing = await this.findFolderByName(folder.parentId ?? itemId, name);
                if (existing && existing.id !== itemId) throw new Error('A folder with this name already exists here');
            }
            return await this.db.collection.update({ where: { id: itemId }, data: { name } });
        }

        // File rename
        const item = await this.db.collectionItem.findUnique({
            where: { id: itemId, deletedAt: null, isLatest: true },
        });
        if (!item) throw new Error('File not found');

        if (name !== item.name) {
            const existing = await this.findItemByPath(item.collectionId, name);
            if (existing && existing.id !== itemId) throw new Error('A file with this name already exists in this folder');
        }

        return await this.db.collectionItem.update({ where: { id: itemId }, data: { name } });
    }

    /**
     * Find all files recursively within a folder (including nested sub-folders)
     */
    async findAllFilesInFolderRecursively(folderId: string): Promise<Array<{
        id: string;
        name: string;
        storageKey: string;
        relativePath: string;
        mimeType: string | null;
    }>> {
        // Find all folders in the subtree using a recursive CTE
        const allFolders = await this.db.$queryRaw<Array<{ id: string; name: string; parentId: string | null }>>`
            WITH RECURSIVE folder_tree AS (
                SELECT id, name, "parentId"
                FROM collections
                WHERE id = ${folderId} AND "deletedAt" IS NULL
                UNION ALL
                SELECT c.id, c.name, c."parentId"
                FROM collections c
                INNER JOIN folder_tree ft ON c."parentId" = ft.id
                WHERE c."deletedAt" IS NULL
            )
            SELECT id, name, "parentId" FROM folder_tree
        `;

        const folderIds = allFolders.map(f => f.id);

        const items = await this.db.collectionItem.findMany({
            where: { collectionId: { in: folderIds }, isLatest: true, deletedAt: null },
            select: { id: true, name: true, collectionId: true },
        });

        const attachmentMap = await this.fetchAttachmentsByItemIds(items.map(i => i.id));
        const folderById = new Map(allFolders.map(f => [f.id, f]));

        return items
            .filter(item => attachmentMap.has(item.id))
            .map(item => {
                const att = attachmentMap.get(item.id)!;
                if (item.collectionId === folderId) {
                    return { id: item.id, name: item.name, storageKey: att.url, mimeType: att.mimetype, relativePath: item.name };
                }

                const parts: string[] = [];
                let current = folderById.get(item.collectionId);
                while (current && current.id !== folderId) {
                    parts.unshift(current.name);
                    current = current.parentId ? folderById.get(current.parentId) : undefined;
                }
                parts.push(item.name);
                return { id: item.id, name: item.name, storageKey: att.url, mimeType: att.mimetype, relativePath: parts.join('/') };
            });
    }

    /**
     * Search files by name in a root collection
     */
    async searchItemsByCollectionId(rootCollectionId: string, searchQuery: string): Promise<CollectionItemSummary[]> {
        const searchTerm = searchQuery.trim();
        if (!searchTerm) return [];

        const items = await this.db.collectionItem.findMany({
            where: {
                rootCollectionId,
                isLatest: true,
                deletedAt: null,
                name: { contains: searchTerm, mode: 'insensitive' },
            },
            select: { id: true, name: true, createdAt: true, updatedAt: true, ingestionStatus: true, collectionId: true },
            orderBy: { createdAt: 'desc' },
        });

        const attachmentMap = await this.fetchAttachmentsByItemIds(items.map(i => i.id));

        return items.map(i => {
            const att = attachmentMap.get(i.id);
            return { ...i, itemType: 'file' as const, fileSize: att ? BigInt(att.size) : null, mimeType: att?.mimetype ?? null };
        });
    }

    // ── Version history ──────────────────────────────────────────────────────

    /**
     * Upload a new version: mark current latest as not-latest, insert new row with same fileId
     */
    async createItemVersion(data: {
        currentItemId: string;
        storageKey: string;
        mimeType: string;
        fileSize: bigint;
        uploadedById: string;
        workspaceId: string;
        ingestionStatus: IngestionStatus;
    }): Promise<CollectionItem> {
        const current = await this.db.collectionItem.findUniqueOrThrow({
            where: { id: data.currentItemId },
            select: { rootCollectionId: true, collectionId: true, fileId: true, ownerId: true, name: true, versionNumber: true },
        });

        return await this.db.$transaction(async (tx) => {
            await tx.collectionItem.update({
                where: { id: data.currentItemId },
                data: { isLatest: false },
            });

            const newItem = await tx.collectionItem.create({
                data: {
                    rootCollectionId: current.rootCollectionId,
                    collectionId: current.collectionId,
                    workspaceId: data.workspaceId,
                    fileId: current.fileId,
                    ownerId: current.ownerId,
                    name: current.name,
                    uploadedById: data.uploadedById,
                    versionNumber: current.versionNumber + 1,
                    isLatest: true,
                    ingestionStatus: data.ingestionStatus,
                    createdAt: new Date(),
                },
            });

            await tx.messageAttachment.create({
                data: {
                    entityType: AttachmentEntityType.COLLECTION,
                    entityId: newItem.id,
                    workspaceId: data.workspaceId,
                    storageProvider: 'GCS',
                    originalFilename: current.name,
                    mimetype: data.mimeType,
                    size: Number(data.fileSize),
                    url: data.storageKey,
                    uploadedByUserId: data.uploadedById,
                    createdBy: data.uploadedById,
                },
            });

            return newItem;
        });
    }

    /**
     * Restore a version: flip isLatest between current latest and target version
     */
    async restoreItemVersion(currentItemId: string, targetVersionId: string): Promise<CollectionItem> {
        return await this.db.$transaction(async (tx) => {
            await tx.collectionItem.update({
                where: { id: currentItemId },
                data: { isLatest: false },
            });
            return await tx.collectionItem.update({
                where: { id: targetVersionId },
                data: { isLatest: true },
            });
        });
    }

    /**
     * Find all versions of a file (by fileId), ordered newest first
     */
    async findItemVersions(fileId: string): Promise<(CollectionItem & WithAttachment)[]> {
        const versions = await this.db.collectionItem.findMany({
            where: { fileId },
            orderBy: { versionNumber: 'desc' },
        });
        const attachmentMap = await this.fetchAttachmentsByItemIds(versions.map(v => v.id));
        return versions.map(v => ({ ...v, attachment: attachmentMap.get(v.id) ?? null }));
    }

    async findItemVersionById(versionId: string): Promise<CollectionItem & WithAttachment | null> {
        const version = await this.db.collectionItem.findUnique({ where: { id: versionId } });
        if (!version) return null;
        const attachment = await this.db.messageAttachment.findFirst({
            where: { entityId: version.id, entityType: AttachmentEntityType.COLLECTION },
        });
        return { ...version, attachment };
    }
}
