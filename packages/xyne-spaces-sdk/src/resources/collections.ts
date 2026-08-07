/**
 * Collections Resource
 *
 * Knowledge-base collections: nested folders of files, and who can see them.
 *
 * Uploading files is not part of this API — these methods manage the structure
 * and permissions around files that already exist.
 */

import { Resource } from './base.js';
import { collectionsOperations } from '../registry/collections.js';
import { newId } from '../core/ids.js';
import type { Collection, CollectionItem } from '../types/index.js';

export class CollectionsResource extends Resource {
  /**
   * List root collections.
   *
   * @param options.scopeType - Narrow to one scope, e.g. a channel or project
   *
   * @example
   * const collections = await sdk.collections.list();
   */
  list(options?: { scopeType?: string; scopeId?: string }): Promise<Collection[]> {
    return this.call(collectionsOperations.list, options);
  }

  /** List sub-collections beneath a root collection. */
  listSubfolders(rootCollectionId: string): Promise<Collection[]> {
    return this.call(collectionsOperations.listSubfolders, { rootCollectionId });
  }

  /** List the files in a collection, latest versions only. */
  listItems(collectionId: string): Promise<CollectionItem[]> {
    return this.call(collectionsOperations.listItems, { collectionId });
  }

  /**
   * Create a root collection.
   *
   * @returns The ids of the collection and of the creator's permission row
   *
   * @example
   * const { id } = await sdk.collections.create({
   *   name: 'Runbooks',
   *   scopeType: 'channel',
   *   scopeId: 'channel-1',
   * });
   */
  async create(data: {
    name: string;
    scopeType: string;
    scopeId: string;
    description?: string;
    isPrivate?: boolean;
  }): Promise<{ id: string; permissionId: string }> {
    const id = newId();
    const permissionId = newId();
    await this.call(collectionsOperations.create, { id, permissionId, ...data });
    return { id, permissionId };
  }

  /** Rename a collection or change its description or privacy. */
  update(
    id: string,
    data: { name?: string; description?: string; isPrivate?: boolean }
  ): Promise<void> {
    return this.call(collectionsOperations.update, { id, ...data });
  }

  /** Delete a collection. */
  delete(id: string): Promise<void> {
    return this.call(collectionsOperations.delete, { id });
  }

  /**
   * Create a sub-collection under a parent.
   *
   * @returns The id of the new sub-collection
   */
  async createFolder(parentId: string, name: string): Promise<{ id: string }> {
    const id = newId();
    await this.call(collectionsOperations.createFolder, { id, parentId, name });
    return { id };
  }

  /** Rename a file or sub-collection. */
  renameItem(id: string, collectionId: string, name: string): Promise<void> {
    return this.call(collectionsOperations.renameItem, { id, collectionId, name });
  }

  /** Remove a file or sub-collection. */
  deleteItem(id: string, collectionId: string): Promise<void> {
    return this.call(collectionsOperations.deleteItem, { id, collectionId });
  }

  /**
   * Grant a user or group access to a collection.
   *
   * Set exactly one of `userId` or `userGroupId`. This also re-indexes the
   * collection's files so search results reflect the new access.
   *
   * @returns The id of the permission row, needed to revoke it later
   */
  async grantPermission(data: {
    collectionId: string;
    role: string;
    canShare: boolean;
    userId?: string;
    userGroupId?: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(collectionsOperations.grantPermission, { id, ...data });
    return { id };
  }

  /** Revoke a permission grant. */
  revokePermission(id: string, collectionId: string): Promise<void> {
    return this.call(collectionsOperations.revokePermission, { id, collectionId });
  }
}
