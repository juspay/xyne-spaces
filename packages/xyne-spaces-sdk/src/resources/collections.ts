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
import type {
  Collection,
  CollectionItem,
  CollectionPermission,
  CollectionRole,
} from '../types/index.js';

export class CollectionsResource extends Resource {
  /**
   * List root collections.
   *
   * @param options.scopeType - Narrow to one kind of scope, e.g. `'channel'`.
   * @param options.scopeId - Id within that scope.
   * @returns Root collections, without their files.
   * @example
   * const collections = await sdk.collections.list();
   */
  list(options?: { scopeType?: string; scopeId?: string }): Promise<Collection[]> {
    return this.call(collectionsOperations.list, options);
  }

  /**
   * List sub-collections beneath a root collection.
   *
   * @param rootCollectionId - Id of the root collection.
   * @returns Its sub-collections.
   * @example
   * const folders = await sdk.collections.listSubfolders('collection-1');
   */
  listSubfolders(rootCollectionId: string): Promise<Collection[]> {
    return this.call(collectionsOperations.listSubfolders, { rootCollectionId });
  }

  /**
   * List who a collection is shared with.
   *
   * @param collectionId - Id of the collection.
   * @returns One grant per user, group or channel with access.
   * @example
   * const grants = await sdk.collections.listPermissions('collection-1');
   */
  listPermissions(collectionId: string): Promise<CollectionPermission[]> {
    return this.call(collectionsOperations.listPermissions, { collectionId });
  }

  /**
   * List the files in a collection, latest versions only.
   *
   * @param collectionId - Id of the collection.
   * @returns Its own files, not those of its sub-collections.
   * @example
   * const files = await sdk.collections.listItems('collection-1');
   */
  listItems(collectionId: string): Promise<CollectionItem[]> {
    return this.call(collectionsOperations.listItems, { collectionId });
  }

  /**
   * Get one collection by id.
   *
   * @param id - Id of the collection.
   * @returns The collection, or `null` if it does not exist or was deleted.
   * @example
   * const collection = await sdk.collections.get('collection-1');
   */
  get(id: string): Promise<Collection | null> {
    return this.call(collectionsOperations.get, { id });
  }

  /**
   * Every latest-version file beneath a root collection, across its subfolders.
   *
   * Unlike {@link listItems}, which returns one collection's own files, this
   * walks the whole tree under the root and joins each file's attachment.
   *
   * @param rootCollectionId - Id of the root collection.
   * @returns Every latest-version file beneath it.
   * @example
   * const files = await sdk.collections.listFilesByRoot('collection-1');
   */
  listFilesByRoot(rootCollectionId: string): Promise<CollectionItem[]> {
    return this.call(collectionsOperations.listFilesByRoot, { rootCollectionId });
  }

  /**
   * Root collections with their files already joined.
   *
   * Same scoping as {@link list}; one round trip instead of a list followed by
   * a `listItems` per collection.
   *
   * @param options.scopeType - Narrow to one kind of scope, e.g. `'channel'`.
   * @param options.scopeId - Id within that scope.
   * @returns Root collections with their files attached.
   * @example
   * const collections = await sdk.collections.listWithItems();
   */
  listWithItems(options?: { scopeType?: string; scopeId?: string }): Promise<Collection[]> {
    return this.call(collectionsOperations.listWithItems, options);
  }

  /**
   * Create a root collection.
   *
   * @param data - The collection to create.
   * @param data.name - Display name.
   * @param data.scopeType - What it belongs to, e.g. `'channel'`.
   * @param data.scopeId - Id within that scope.
   * @param data.description - Optional description.
   * @param data.isPrivate - Restrict it to explicitly granted members.
   * @returns The new collection id, and the id of the creator's own grant.
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

  /**
   * Rename a collection or change its description or privacy.
   *
   * @param id - Id of the collection.
   * @param data - Fields to change; omitted fields are left alone.
   * @param data.name - New display name.
   * @param data.description - New description.
   * @param data.isPrivate - Whether access is restricted to explicit grants.
   * @example
   * await sdk.collections.update('collection-1', { name: 'Runbooks' });
   */
  update(
    id: string,
    data: { name?: string; description?: string; isPrivate?: boolean }
  ): Promise<void> {
    return this.call(collectionsOperations.update, { id, ...data });
  }

  /**
   * Delete a collection and everything under it.
   *
   * @param id - Id of the collection.
   * @example
   * await sdk.collections.delete('collection-1');
   */
  delete(id: string): Promise<void> {
    return this.call(collectionsOperations.delete, { id });
  }

  /**
   * Create a sub-collection under a parent.
   *
   * @param parentId - Collection to nest it under.
   * @param name - Display name.
   * @returns The new sub-collection's id.
   * @example
   * const { id } = await sdk.collections.createFolder('collection-1', 'Postmortems');
   */
  async createFolder(parentId: string, name: string): Promise<{ id: string }> {
    const id = newId();
    await this.call(collectionsOperations.createFolder, { id, parentId, name });
    return { id };
  }

  /**
   * Rename a file or sub-collection.
   *
   * @param id - Id of the item.
   * @param collectionId - Collection it belongs to.
   * @param name - New name.
   * @example
   * await sdk.collections.renameItem('item-1', 'collection-1', 'runbook.md');
   */
  renameItem(id: string, collectionId: string, name: string): Promise<void> {
    return this.call(collectionsOperations.renameItem, { id, collectionId, name });
  }

  /**
   * Remove a file or sub-collection.
   *
   * @param id - Id of the item.
   * @param collectionId - Collection it belongs to.
   * @example
   * await sdk.collections.deleteItem('item-1', 'collection-1');
   */
  deleteItem(id: string, collectionId: string): Promise<void> {
    return this.call(collectionsOperations.deleteItem, { id, collectionId });
  }

  /**
   * Grant a user, group or channel access to a collection.
   *
   * Set exactly one of `userId`, `userGroupId` or `channelId`. This also
   * re-indexes the collection's files so search reflects the new access.
   *
   * Anyone holding a role may share, and may grant any role up to their own —
   * only an `OWNER` can grant `OWNER`, and a `VIEWER` can grant only `VIEWER`.
   * A channel grant is restricted to `VIEWER`.
   *
   * @param data - Who to grant, and what to give them.
   * @param data.collectionId - Collection being shared.
   * @param data.role - Access to grant.
   * @param data.userId - Grant to one person.
   * @param data.userGroupId - Grant to a group.
   * @param data.channelId - Grant to a channel's members. `VIEWER` only.
   * @returns The grant's id, needed to revoke it later.
   * @example
   * const { id } = await sdk.collections.grantPermission({
   *   collectionId: 'collection-1',
   *   role: 'EDITOR',
   *   userId: 'user-1',
   * });
   */
  async grantPermission(data: {
    collectionId: string;
    role: CollectionRole;
    userId?: string;
    userGroupId?: string;
    channelId?: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(collectionsOperations.grantPermission, { id, ...data });
    return { id };
  }

  /**
   * Revoke a grant.
   *
   * @param id - Id of the grant, from {@link listPermissions}.
   * @param collectionId - Collection the grant is on.
   * @example
   * await sdk.collections.revokePermission('grant-1', 'collection-1');
   */
  revokePermission(id: string, collectionId: string): Promise<void> {
    return this.call(collectionsOperations.revokePermission, { id, collectionId });
  }
}
