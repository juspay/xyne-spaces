import { PrismaClient, Collection, CollectionItemType, CollectionItem, CollectionItemVersion, UploadStatus, CollectionRole } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseClient } from '@/database/client';

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
    type: string;
    createdAt: Date;
    updatedAt: Date;
    uploadedByEmail: string | null;
    uploadStatus: string;
    fileSize: bigint | null;
    mimeType: string | null;
    parentId: string | null;
};

export type FolderCounters = {
    id: string;
    name: string;
    parentId: string | null;
    totalFiles: number;
    pendingFiles: number;
    processingFiles: number;
    completedFiles: number;
    failedFiles: number;
};

export class CollectionRepository {
    protected db: PrismaClient;

    constructor() {
        this.db = DatabaseClient.getInstance();
    }

    /**
     * Find all non-deleted collections for a given projectId
     */
    async findCollectionsByProjectId(projectId: string, userId: string): Promise<CollectionSummary[]> {
        // Get user's group memberships
        const userGroups = await this.db.userGroupMapping.findMany({
            where: { userId },
            select: { userGroupId: true },
        });
        const userGroupIds = userGroups.map(ug => ug.userGroupId);

        // Only return collections the user has access to: owner or has a permission (direct or via group)
        const permissionCondition =
            userGroupIds.length > 0
                ? { OR: [{ userId }, { userGroupId: { in: userGroupIds } }] }
                : { userId };

        const collections = await this.db.collection.findMany({
            where: {
                projectId,
                deletedAt: null,
                OR: [
                    { ownerId: userId },
                    { permissions: { some: permissionCondition } },
                ],
            },
            select: {
                id: true,
                name: true,
                description: true,
                createdAt: true,
                updatedAt: true,
                ownerId: true,
                permissions: {
                    where: {
                        OR: [
                            { userId: userId },
                            { userGroupId: { in: userGroupIds } },
                        ],
                    },
                    select: {
                        role: true,
                        userId: true,
                        userGroupId: true,
                        canShare: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return collections.map(collection => {
            // Determine role with hierarchy: OWNER > EDITOR > VIEWER
            let role: CollectionRole = CollectionRole.VIEWER;
            let canShare = false;

            // If user is the owner, role is OWNER
            if (collection.ownerId === userId) {
                role = CollectionRole.OWNER;
                canShare = true;
            } else if (collection.permissions.length > 0) {
                // Get the highest permission level from all applicable permissions
                const roleHierarchy: Record<CollectionRole, number> = {
                    [CollectionRole.OWNER]: 3,
                    [CollectionRole.EDITOR]: 2,
                    [CollectionRole.VIEWER]: 1,
                };
                let maxRoleValue = 0;

                for (const permission of collection.permissions) {
                    const roleValue = roleHierarchy[permission.role];
                    if (roleValue > maxRoleValue) {
                        maxRoleValue = roleValue;
                        role = permission.role;
                        canShare = permission.canShare || false;
                    }
                }
            }

            return {
                id: collection.id,
                name: collection.name,
                description: collection.description,
                createdAt: collection.createdAt,
                updatedAt: collection.updatedAt,
                ownerId: collection.ownerId,
                canShare,
                role,
            };
        });
    }

    /**
     * Find all items for a given collectionId, optionally filtered by parentId (null for top-level)
     */
    async findItemsByCollectionAndParentId(collectionId: string, parentId: string | null): Promise<CollectionItemSummary[]> {
        return await this.db.collectionItem.findMany({
            where: {
                collectionId,
                parentId,
                deletedAt: null,
            },
            select: {
                id: true,
                name: true,
                type: true,
                createdAt: true,
                updatedAt: true,
                uploadedByEmail: true,
                uploadStatus: true,
                fileSize: true,
                mimeType: true,
                parentId: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Find all top-level (parentId is null) items for a given collectionId
     */
    async findTopLevelItemsByCollectionId(collectionId: string): Promise<CollectionItemSummary[]> {
        return this.findItemsByCollectionAndParentId(collectionId, null);
    }

    /**
     * Get folder counters for a single folder by its id.
     */
    async findFolderCountersByFolderId(
        collectionId: string,
        folderId: string
    ): Promise<FolderCounters | null> {
        const isRoot = folderId === collectionId;

        if (isRoot) {
            const rootFolders = await this.db.collectionItem.findMany({
                where: {
                    collectionId,
                    parentId: null,
                    type: CollectionItemType.FOLDER,
                    deletedAt: null,
                },
                select: {
                    totalFiles: true,
                    pendingFiles: true,
                    processingFiles: true,
                    completedFiles: true,
                    failedFiles: true,
                },
            });
            const aggregated = rootFolders.reduce<{
                totalFiles: number;
                pendingFiles: number;
                processingFiles: number;
                completedFiles: number;
                failedFiles: number;
            }>(
                (acc, f) => ({
                    totalFiles: acc.totalFiles + (f.totalFiles ?? 0),
                    pendingFiles: acc.pendingFiles + (f.pendingFiles ?? 0),
                    processingFiles: acc.processingFiles + (f.processingFiles ?? 0),
                    completedFiles: acc.completedFiles + (f.completedFiles ?? 0),
                    failedFiles: acc.failedFiles + (f.failedFiles ?? 0),
                }),
                { totalFiles: 0, pendingFiles: 0, processingFiles: 0, completedFiles: 0, failedFiles: 0 },
            );
            return {
                id: collectionId,
                name: 'Root',
                parentId: null,
                ...aggregated,
            };
        }

        const folder = await this.db.collectionItem.findUnique({
            where: {
                id: folderId,
                collectionId,
                type: CollectionItemType.FOLDER,
                deletedAt: null,
            },
            select: {
                id: true,
                name: true,
                parentId: true,
                totalFiles: true,
                pendingFiles: true,
                processingFiles: true,
                completedFiles: true,
                failedFiles: true,
            },
        });
        if (!folder) return null;
        return {
            id: folder.id,
            name: folder.name,
            parentId: folder.parentId,
            totalFiles: folder.totalFiles ?? 0,
            pendingFiles: folder.pendingFiles ?? 0,
            processingFiles: folder.processingFiles ?? 0,
            completedFiles: folder.completedFiles ?? 0,
            failedFiles: folder.failedFiles ?? 0,
        };
    }

    /**
     * Find an item and all its ancestors up to the collection root.
     * Returns [item, parent, grandparent, ..., root-level-ancestor] ordered from item to root.
     * Used for hydrating the tree context on deep-link/refresh when intermediate nodes are unknown.
     */
    async findItemAncestors(itemId: string, collectionId: string): Promise<CollectionItemSummary[]> {
        const ancestors: CollectionItemSummary[] = [];
        let currentId: string | null = itemId;
        const visited = new Set<string>();

        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const item: CollectionItemSummary | null = await this.db.collectionItem.findUnique({
                where: { id: currentId, deletedAt: null, collectionId },
                select: {
                    id: true,
                    name: true,
                    type: true,
                    createdAt: true,
                    updatedAt: true,
                    uploadedByEmail: true,
                    uploadStatus: true,
                    fileSize: true,
                    mimeType: true,
                    parentId: true,
                },
            });
            if (!item) break;
            ancestors.push(item);
            currentId = item.parentId;
        }

        return ancestors;
    }

    /**
     * Find item by ID
     */
    async findItemById(id: string) {
        return await this.db.collectionItem.findUnique({
            where: { id },
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
     * Create a new collection
     */
    async createCollection(data: {
        userId: string;
        projectId: string;
        name: string;
        description?: string;
        email: string;
        metadata?: any;
    }): Promise<Collection> {
        return await this.db.collection.create({
            data: {
                ownerId: data.userId,
                projectId: data.projectId,
                name: data.name,
                description: data.description,
                vespaDocId: uuidv4(),
                isPrivate: true,
                totalItems: 0,
                lastUpdatedByEmail: data.email,
                lastUpdatedById: data.userId,
                metadata: data.metadata || {},
            },
        });
    }

    /**
     * Create a folder item
     */
    async createFolder(data: {
        collectionId: string;
        parentId: string | null;
        name: string;
        metadata: any;
        ownerId: string;
        ownerEmail: string;
    }): Promise<CollectionItem> {
        let path = `/${data.name}`;
        if (data.parentId) {
            const parent = await this.db.collectionItem.findUnique({
                where: { id: data.parentId },
            });
            if (parent) {
                path = `${parent.path}/${data.name}`;
            }
        }

        return await this.db.collectionItem.create({
            data: {
                collectionId: data.collectionId,
                parentId: data.parentId,
                ownerId: data.ownerId,
                name: data.name,
                type: CollectionItemType.FOLDER,
                path: path,
                vespaDocId: uuidv4(),
                metadata: data.metadata || {},
                uploadedByEmail: data.ownerEmail,
                uploadedById: data.ownerId,
                uploadStatus: UploadStatus.NONE,
            },
        });
    }

    /**
     * Create a file item
     */
    async createFileItem(data: {
        collectionId: string;
        parentId: string | null;
        name: string;
        storageKey: string;
        mimeType: string;
        fileSize: number;
        checksum: string;
        metadata: any;
        ownerId: string;
        ownerEmail: string;
        uploadStatus?: UploadStatus;
    }): Promise<CollectionItem> {
        let path = `/${data.name}`;
        if (data.parentId) {
            const parent = await this.db.collectionItem.findUnique({
                where: { id: data.parentId },
            });
            if (parent) {
                path = `${parent.path}/${data.name}`;
            }
        }

        const item = await this.db.collectionItem.create({
            data: {
                collectionId: data.collectionId,
                parentId: data.parentId,
                ownerId: data.ownerId,
                name: data.name,
                type: CollectionItemType.FILE,
                path: path,
                vespaDocId: uuidv4(),
                storageKey: data.storageKey,
                mimeType: data.mimeType,
                fileSize: BigInt(data.fileSize),
                checksum: data.checksum,
                metadata: data.metadata || {},
                uploadedByEmail: data.ownerEmail,
                uploadedById: data.ownerId,
                uploadStatus: data.uploadStatus || UploadStatus.PENDING,
            },
        });

        // Update parent folder sizes
        if (data.parentId && data.fileSize > 0) {
            await this.updateParentSizes(data.parentId, BigInt(data.fileSize));
        }

        // Increment counters in ancestor folders
        await this.incrementFileCountersInAncestors(
            data.parentId,
            item.uploadStatus,
        );

        return item;
    }

    /**
     * Find item by path (for duplicate checking)
     */
    async findItemByPath(
        collectionId: string,
        parentId: string | null,
        name: string
    ): Promise<CollectionItem | null> {
        return await this.db.collectionItem.findFirst({
            where: {
                collectionId,
                parentId,
                name: {
                    equals: name,
                    mode: 'insensitive',
                },
                deletedAt: null,
            },
        });
    }

    /**
     * Find items by checksum (for detecting identical files)
     */
    async findItemsByChecksum(
        collectionId: string,
        checksum: string
    ): Promise<CollectionItem[]> {
        return await this.db.collectionItem.findMany({
            where: {
                collectionId,
                checksum,
                type: CollectionItemType.FILE,
                deletedAt: null,
            },
        });
    }

    /**
     * Update item upload status
     */
    async updateItemUploadStatus(
        itemId: string,
        status: UploadStatus
    ): Promise<CollectionItem> {
        return await this.db.collectionItem.update({
            where: { id: itemId },
            data: { uploadStatus: status },
        });
    }

    /**
     * Soft delete an item
     */
    async softDeleteItem(itemId: string): Promise<CollectionItem> {
        return await this.db.collectionItem.update({
            where: { id: itemId },
            data: { deletedAt: new Date() },
        });
    }

    /**
     * Poll items status for multiple collections
     */
    async pollItemsStatus(collectionIds: string[], userId: string) {
        return await this.db.collectionItem.findMany({
            where: {
                collectionId: {
                    in: collectionIds,
                },
                collection: {
                    ownerId: userId,
                    deletedAt: null,
                },
                deletedAt: null,
            },
            select: {
                id: true,
                uploadStatus: true,
                statusMessage: true,
                retryCount: true,
                collectionId: true,
            },
        });
    }

    /**
     * Soft delete a collection
     */
    async deleteCollection(collectionId: string, userId: string): Promise<boolean> {
        const collection = await this.db.collection.findUnique({
            where: { id: collectionId },
            select: { ownerId: true },
        });

        if (!collection) {
            return false;
        }

        if (collection.ownerId !== userId) {
            throw new Error('Unauthorized: Only the owner can delete the collection');
        }

        await this.db.collection.update({
            where: { id: collectionId },
            data: { deletedAt: new Date() },
        });

        return true;
    }

    /**
     * Get user IDs that are members of the project (participants in any channel of that project).
     * Used to restrict collection sharing to project members only.
     */
    async getProjectMemberUserIds(projectId: string): Promise<Set<string>> {
        const channels = await this.db.channel.findMany({
            where: { projectId },
            select: { id: true },
        });
        const channelIds = channels.map(c => c.id);
        if (channelIds.length === 0) {
            return new Set();
        }
        const participants = await this.db.channelParticipant.findMany({
            where: { channelId: { in: channelIds } },
            select: { userId: true },
        });
        return new Set(participants.map(p => p.userId));
    }

    /**
     * Update a collection
     */
    async updateCollection(collectionId: string, userId: string, data: { name?: string; permissions?: { userId?: string; userGroupId?: string; role: CollectionRole; canShare?: boolean }[] }): Promise<Collection> {
        // Fetch collection to check permissions
        const collection = await this.db.collection.findUnique({
            where: { id: collectionId },
            include: { permissions: true },
        });

        if (!collection) {
            throw new Error('Collection not found');
        }

        // Get user's permission for this collection
        const isOwner = collection.ownerId === userId;
        const userPermission = collection.permissions.find(p => p.userId === userId);

        // Check authorization for renaming (requires EDITOR or OWNER role)
        if (data.name !== undefined) {
            let canRename = isOwner;
            if (!canRename && userPermission) {
                canRename = userPermission.role === CollectionRole.OWNER || userPermission.role === CollectionRole.EDITOR;
            }
            if (!canRename) {
                throw new Error('Unauthorized: Only editors and owners can rename collections');
            }
        }

        // Check authorization for updating permissions (requires canShare permission or be owner)
        if (data.permissions !== undefined) {
            let canShare = isOwner;
            if (!canShare && userPermission) {
                canShare = userPermission.canShare === true;
            }
            if (!canShare) {
                throw new Error('Unauthorized: You do not have permission to share this collection');
            }

            // Restrict sharing to project members only: every userId being granted access must be in the collection's project
            const projectMemberIds = await this.getProjectMemberUserIds(collection.projectId);
            for (const perm of data.permissions) {
                if (perm.userId && !projectMemberIds.has(perm.userId)) {
                    throw new Error(`User ${perm.userId} is not a member of this project. Collections can only be shared with users who belong to the project.`);
                }
            }

            // Validate that user can only assign permissions they're allowed to assign
            // Determine user's effective role and canShare status
            const userRole = isOwner ? CollectionRole.OWNER : (userPermission?.role || CollectionRole.VIEWER);
            const userCanShare = isOwner ? true : (userPermission?.canShare || false);

            // Validate each permission being assigned
            for (const perm of data.permissions) {
                // OWNER can assign everything - skip validation
                if (userRole === CollectionRole.OWNER) {
                    continue;
                }

                // VIEWER can only assign VIEWER role
                if (userRole === CollectionRole.VIEWER && perm.role !== CollectionRole.VIEWER) {
                    throw new Error('Unauthorized: Viewers can only assign viewer access');
                }

                // EDITOR can assign VIEWER and EDITOR, but not OWNER
                if (userRole === CollectionRole.EDITOR) {
                    if (perm.role === CollectionRole.OWNER) {
                        throw new Error('Unauthorized: Editors cannot assign owner access');
                    }
                    if (perm.role !== CollectionRole.VIEWER && perm.role !== CollectionRole.EDITOR) {
                        throw new Error('Unauthorized: Invalid role assignment');
                    }
                }

                // Check canShare permission: only users with canShare=true can grant it
                if (perm.canShare === true && !userCanShare) {
                    throw new Error('Unauthorized: You do not have permission to grant share access');
                }
            }
        }

        // Transaction for permissions update
        if (data.permissions) {
            return await this.db.$transaction(async (tx) => {
                if (data.name) {
                    await tx.collection.update({
                        where: { id: collectionId },
                        data: { name: data.name },
                    });
                }

                // Delete existing permissions
                await tx.collectionPermission.deleteMany({
                    where: { collectionId },
                });

                // Create new permissions
                if (data.permissions && data.permissions.length > 0) {
                    await tx.collectionPermission.createMany({
                        data: data.permissions.map(p => ({
                            collectionId,
                            userId: p.userId,
                            userGroupId: p.userGroupId,
                            role: p.role,
                            canShare: p.canShare || false,
                        })),
                    });
                }

                return await tx.collection.findUniqueOrThrow({
                    where: { id: collectionId },
                    include: { permissions: true },
                });
            });
        } else {
            return await this.db.collection.update({
                where: { id: collectionId },
                data: { name: data.name },
            });
        }
    }

    /**
     * Delete collection item
     */
    async deleteItem(itemId: string, collectionId: string, userId: string): Promise<boolean> {
        // Find item and verify it belongs to collection
        const item = await this.db.collectionItem.findUnique({
            where: { id: itemId },
            include: { collection: { include: { permissions: true } } },
        });

        if (!item || item.collectionId !== collectionId || item.deletedAt) {
            return false;
        }

        // Check permissions
        const collection = item.collection;
        let canDelete = collection.ownerId === userId;
        if (!canDelete) {
            const userPermission = collection.permissions.find(p => p.userId === userId);
            if (userPermission && (userPermission.role === CollectionRole.OWNER || userPermission.role === CollectionRole.EDITOR)) {
                canDelete = true;
            }
        }

        if (!canDelete) {
            throw new Error('Unauthorized: You do not have permission to delete items in this collection');
        }

        // Get file state before deletion for counter updates
        const fileState = item.uploadStatus;
        const fileParentId = item.parentId;

        // Update parent sizes if file
        if (item.type === CollectionItemType.FILE && item.fileSize && item.parentId) {
            await this.updateParentSizes(item.parentId, -BigInt(item.fileSize));
        }

        await this.db.collectionItem.update({
            where: { id: itemId },
            data: { deletedAt: new Date() },
        });

        // Decrement counters in ancestor folders if file
        if (item.type === CollectionItemType.FILE) {
            await this.decrementFileCountersInAncestors(fileParentId, fileState);
        }

        return true;
    }

    /**
     * Update collection item
     */
    async updateItem(itemId: string, collectionId: string, userId: string, name: string): Promise<CollectionItem> {
        // Find item and verify
        const item = await this.db.collectionItem.findUnique({
            where: { id: itemId },
            include: { collection: { include: { permissions: true } } },
        });

        if (!item || item.collectionId !== collectionId || item.deletedAt) {
            throw new Error('Item not found or does not belong to collection');
        }

        // Check permissions
        const collection = item.collection;
        let canUpdate = collection.ownerId === userId;
        if (!canUpdate) {
            const userPermission = collection.permissions.find(p => p.userId === userId);
            if (userPermission && (userPermission.role === CollectionRole.OWNER || userPermission.role === CollectionRole.EDITOR)) {
                canUpdate = true;
            }
        }

        if (!canUpdate) {
            throw new Error('Unauthorized: You do not have permission to update items in this collection');
        }

        // Check for duplicates in the same folder if name changes
        if (name !== item.name) {
            const existing = await this.findItemByPath(collectionId, item.parentId, name);
            if (existing && existing.id !== itemId) {
                throw new Error('Item with this name already exists in the folder');
            }

            // Calculate new path
            let newPath = `/${name}`;
            if (item.parentId) {
                const parent = await this.db.collectionItem.findUnique({ where: { id: item.parentId } });
                if (parent) {
                    newPath = `${parent.path}/${name}`;
                }
            }

            const oldPath = item.path;

            // Use transaction to update item and descendants
            return await this.db.$transaction(async (tx) => {
                if (item.type === CollectionItemType.FOLDER) {
                    await this.updateItemPathRecursive(itemId, oldPath, newPath, tx);
                }

                return await tx.collectionItem.update({
                    where: { id: itemId },
                    data: { name, path: newPath },
                });
            });
        }

        return await this.db.collectionItem.update({
            where: { id: itemId },
            data: { name },
        });
    }

    /**
     * Recursively update paths for descendants
     */
    private async updateItemPathRecursive(itemId: string, oldPathPrefix: string, newPathPrefix: string, tx: any): Promise<void> {
        // Find children
        const children = await tx.collectionItem.findMany({
            where: {
                parentId: itemId,
                deletedAt: null,
            },
        });

        for (const child of children) {
            const newChildPath = child.path.replace(oldPathPrefix, newPathPrefix);
            await tx.collectionItem.update({
                where: { id: child.id },
                data: { path: newChildPath },
            });

            if (child.type === CollectionItemType.FOLDER) {
                await this.updateItemPathRecursive(child.id, oldPathPrefix, newPathPrefix, tx);
            }
        }
    }

    /**
     * Recursively update file size for ancestor folders
     */
    private async updateParentSizes(parentId: string | null, sizeDelta: bigint): Promise<void> {
        if (!parentId || sizeDelta === BigInt(0)) {
            return;
        }

        const parent = await this.db.collectionItem.findUnique({
            where: { id: parentId },
            select: { id: true, parentId: true, fileSize: true },
        });

        if (!parent) {
            return;
        }

        // Update current parent
        const currentSize = parent.fileSize || BigInt(0);
        const newSize = currentSize + sizeDelta;

        // Ensure non-negative
        const finalSize = newSize < BigInt(0) ? BigInt(0) : newSize;

        await this.db.collectionItem.update({
            where: { id: parentId },
            data: { fileSize: finalSize },
        });

        // Recurse up
        if (parent.parentId) {
            await this.updateParentSizes(parent.parentId, sizeDelta);
        }
    }

    /**
     * Find all files recursively within a folder (including nested subfolders)
     * Returns files with their relative paths for zip creation
     */
    async findAllFilesInFolderRecursively(folderId: string, collectionId: string): Promise<Array<{
        id: string;
        name: string;
        storageKey: string;
        relativePath: string;
        mimeType: string | null;
    }>> {
        const files: Array<{
            id: string;
            name: string;
            storageKey: string;
            relativePath: string;
            mimeType: string | null;
        }> = [];

        // Get the folder to use as base for relative paths
        const folder = await this.db.collectionItem.findUnique({
            where: { id: folderId, deletedAt: null, collectionId },
        });

        if (!folder || folder.type !== CollectionItemType.FOLDER) {
            return files;
        }

        // Recursive function to collect files
        const collectFiles = async (parentId: string, currentPath: string): Promise<void> => {
            const items = await this.db.collectionItem.findMany({
                where: {
                    parentId,
                    collectionId,
                    deletedAt: null,
                },
                select: {
                    id: true,
                    name: true,
                    type: true,
                    storageKey: true,
                    mimeType: true,
                },
            });

            for (const item of items) {
                const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;

                if (item.type === CollectionItemType.FILE) {
                    if (item.storageKey) {
                        files.push({
                            id: item.id,
                            name: item.name,
                            storageKey: item.storageKey,
                            relativePath: itemPath,
                            mimeType: item.mimeType,
                        });
                    }
                } else if (item.type === CollectionItemType.FOLDER) {
                    // Recurse into subfolder
                    await collectFiles(item.id, itemPath);
                }
            }
        };

        // Start recursion from the folder's children
        await collectFiles(folderId, '');

        return files;
    }

    /**
     * Find all items with FAILED upload status in a collection
     */
    async findFailedItemsByCollectionId(collectionId: string): Promise<CollectionItemSummary[]> {
        return await this.db.collectionItem.findMany({
            where: {
                collectionId,
                uploadStatus: UploadStatus.FAILED,
                deletedAt: null,
            },
            select: {
                id: true,
                name: true,
                type: true,
                createdAt: true,
                updatedAt: true,
                uploadedByEmail: true,
                uploadStatus: true,
                fileSize: true,
                mimeType: true,
                parentId: true,
                statusMessage: true,
                retryCount: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Search items by name (or title in metadata) in a collection
     */
    async searchItemsByCollectionId(
        collectionId: string,
        searchQuery: string
    ): Promise<CollectionItemSummary[]> {
        const searchTerm = searchQuery.trim();
        
        if (!searchTerm) {
            return [];
        }

        // Search in name field (case-insensitive)
        return await this.db.collectionItem.findMany({
            where: {
                collectionId,
                deletedAt: null,
                name: {
                    contains: searchTerm,
                    mode: 'insensitive',
                },
            },
            select: {
                id: true,
                name: true,
                type: true,
                createdAt: true,
                updatedAt: true,
                uploadedByEmail: true,
                uploadStatus: true,
                fileSize: true,
                mimeType: true,
                parentId: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Helper: Map UploadStatus to counter field name
     */
    private getCounterFieldForStatus(status: UploadStatus): string {
        const mapping: Record<UploadStatus, string> = {
            [UploadStatus.PENDING]: 'pendingFiles',
            [UploadStatus.PROCESSING]: 'processingFiles',
            [UploadStatus.COMPLETED]: 'completedFiles',
            [UploadStatus.FAILED]: 'failedFiles',
            [UploadStatus.NONE]: 'pendingFiles', // Treat NONE as pending for counters
        };
        return mapping[status] || 'pendingFiles';
    }

    /**
     * Atomically increment counters for all ancestor folders when file is created
     * Uses raw SQL for true atomicity
     * Emits FOLDER_AGGREGATION_CHANGED events for all affected folders
     */
    async incrementFileCountersInAncestors(
        parentId: string | null,
        initialState: UploadStatus,
    ): Promise<void> {
        if (!parentId) return;

        // Walk up ancestor chain and collect folder info
        let currentParentId: string | null = parentId;
        const folderInfo: Array<{ id: string; collectionId: string }> = [];

        while (currentParentId) {
            const parent: { id: string; parentId: string | null; type: CollectionItemType; collectionId: string } | null = await this.db.collectionItem.findUnique({
                where: { id: currentParentId },
                select: { id: true, parentId: true, type: true, collectionId: true },
            });

            if (!parent || parent.type !== CollectionItemType.FOLDER) break;
            folderInfo.push({ id: parent.id, collectionId: parent.collectionId });
            currentParentId = parent.parentId;
        }

        if (folderInfo.length === 0) return;

        const folderIds = folderInfo.map(f => f.id);

        // Atomic updates for all folders in one transaction
        const counterField = this.getCounterFieldForStatus(initialState);
        
        // Use raw SQL with parameterized queries (column name is safe - we control the mapping)
        await this.db.$transaction(
            folderIds.map(folderId =>
                this.db.$executeRawUnsafe(
                    `UPDATE collection_items
                     SET 
                       "totalFiles" = COALESCE("totalFiles", 0) + 1,
                       "${counterField}" = COALESCE("${counterField}", 0) + 1,
                       "updatedAt" = NOW()
                     WHERE id = $1 AND "deletedAt" IS NULL`,
                    folderId
                )
            )
        );
    }

    /**
     * Atomically update counters when file state transitions
     * Ensures idempotency by checking current state
     */
    async updateFileStateCounters(
        fileId: string,
        oldState: UploadStatus,
        newState: UploadStatus
    ): Promise<void> {
        if (oldState === newState) return; // No-op transition

        // Get file and verify current state matches expected
        const file = await this.db.collectionItem.findUnique({
            where: { id: fileId },
            select: { id: true, parentId: true, uploadStatus: true, type: true },
        });

        if (!file || file.type !== CollectionItemType.FILE) {
            throw new Error('File not found or not a file');
        }

        // Idempotency check: if state already changed, abort
        if (file.uploadStatus !== oldState) {
            // Already updated, safe to ignore (idempotent)
            return;
        }

        // Walk ancestor chain
        let currentParentId = file.parentId;
        const folderIds: string[] = [];

        while (currentParentId) {
            const parent: { id: string; parentId: string | null; type: CollectionItemType } | null = await this.db.collectionItem.findUnique({
                where: { id: currentParentId },
                select: { id: true, parentId: true, type: true },
            });

            if (!parent || parent.type !== CollectionItemType.FOLDER) break;
            folderIds.push(parent.id);
            currentParentId = parent.parentId;
        }

        if (folderIds.length === 0) return;

        // Atomic decrement old state, increment new state
        const oldCounterField = this.getCounterFieldForStatus(oldState);
        const newCounterField = this.getCounterFieldForStatus(newState);

        await this.db.$transaction(
            folderIds.map(folderId =>
                this.db.$executeRawUnsafe(
                    `UPDATE collection_items
                     SET 
                       "${oldCounterField}" = GREATEST(COALESCE("${oldCounterField}", 0) - 1, 0),
                       "${newCounterField}" = COALESCE("${newCounterField}", 0) + 1,
                       "updatedAt" = NOW()
                     WHERE id = $1 AND "deletedAt" IS NULL`,
                    folderId
                )
            )
        );
    }

    /**
     * Atomically decrement counters when file is deleted
     * Emits FOLDER_AGGREGATION_CHANGED events for all affected folders
     */
    async decrementFileCountersInAncestors(
        parentId: string | null,
        currentState: UploadStatus,
    ): Promise<void> {
        if (!parentId) return;

        // Walk ancestor chain and collect folder info
        let currentParentId: string | null = parentId;
        const folderInfo: Array<{ id: string; collectionId: string }> = [];

        while (currentParentId) {
            const parent: { id: string; parentId: string | null; type: CollectionItemType; collectionId: string } | null = await this.db.collectionItem.findUnique({
                where: { id: currentParentId },
                select: { id: true, parentId: true, type: true, collectionId: true },
            });

            if (!parent || parent.type !== CollectionItemType.FOLDER) break;
            folderInfo.push({ id: parent.id, collectionId: parent.collectionId });
            currentParentId = parent.parentId;
        }

        if (folderInfo.length === 0) return;

        const folderIds = folderInfo.map(f => f.id);
        const counterField = this.getCounterFieldForStatus(currentState);

        await this.db.$transaction(
            folderIds.map(folderId =>
                this.db.$executeRawUnsafe(
                    `UPDATE collection_items
                     SET 
                       "totalFiles" = GREATEST(COALESCE("totalFiles", 0) - 1, 0),
                       "${counterField}" = GREATEST(COALESCE("${counterField}", 0) - 1, 0),
                       "updatedAt" = NOW()
                     WHERE id = $1 AND "deletedAt" IS NULL`,
                    folderId
                )
            )
        );
    }

    /**
     * Update entity tags for an item
     */
    async updateItemTags(
        itemId: string,
        entityTags: {
            people: string[];
            productSpecifications: string[];
            merchants: string[];
        }
    ): Promise<CollectionItem> {
        // Get existing metadata
        const item = await this.db.collectionItem.findUnique({
            where: { id: itemId },
            select: { metadata: true },
        });

        const existingMeta = (item?.metadata as Record<string, unknown>) ?? {};

        return await this.db.collectionItem.update({
            where: { id: itemId },
            data: {
                metadata: {
                    ...existingMeta,
                    entityTags: entityTags as unknown as Record<string, string[]>,
                },
            },
        });
    }

    /**
     * Update file upload status with counter updates
     * This is the ONLY way to change file upload status
     * IMPORTANT: Update folder counters first (while file still has oldStatus), then update file row.
     * If we update the file first, updateFileStateCounters would re-read the file, see newStatus,
     * fail the idempotency check (file.uploadStatus !== oldState), and skip counter updates.
     */
    async updateFileUploadStatusWithCounters(
        itemId: string,
        oldStatus: UploadStatus,
        newStatus: UploadStatus
    ): Promise<CollectionItem> {
        // Update ancestor counters first (while file still has oldStatus in DB)
        await this.updateFileStateCounters(itemId, oldStatus, newStatus);

        // Then update file status
        return await this.db.collectionItem.update({
            where: { id: itemId },
            data: { uploadStatus: newStatus },
        });
    }

    // ── Version history ──

    async createItemVersion(data: {
        itemId: string;
        versionNumber: number;
        storageKey: string;
        mimeType: string;
        fileSize: bigint;
        checksum: string;
        uploadedById: string;
        uploadedByEmail: string;
        restoredFromVersionId?: string | null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata?: any;
    }): Promise<CollectionItemVersion> {
        return this.db.collectionItemVersion.create({
            data: {
                itemId: data.itemId,
                versionNumber: data.versionNumber,
                storageKey: data.storageKey,
                mimeType: data.mimeType,
                fileSize: data.fileSize,
                checksum: data.checksum,
                uploadedById: data.uploadedById,
                uploadedByEmail: data.uploadedByEmail,
                restoredFromVersionId: data.restoredFromVersionId ?? null,
                metadata: data.metadata ?? {},
            },
        });
    }

    async findItemVersions(itemId: string): Promise<CollectionItemVersion[]> {
        return this.db.collectionItemVersion.findMany({
            where: { itemId },
            orderBy: { versionNumber: 'desc' },
        });
    }

    async findItemVersionById(versionId: string): Promise<CollectionItemVersion | null> {
        return this.db.collectionItemVersion.findUnique({ where: { id: versionId } });
    }

    async updateItemFileFields(itemId: string, data: {
        storageKey: string;
        mimeType: string;
        fileSize: bigint;
        checksum: string;
        uploadedById: string;
        uploadedByEmail: string;
        currentVersionNumber: number;
        versionCount: number;
        uploadStatus: UploadStatus;
    }): Promise<CollectionItem> {
        return this.db.collectionItem.update({
            where: { id: itemId },
            data,
        });
    }
}
