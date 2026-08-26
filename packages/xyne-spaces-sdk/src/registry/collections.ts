/**
 * Collections Operation Registry
 *
 * Knowledge-base collections: nested folders of files that get ingested for
 * search. Access is granted per collection to a user or a user group.
 *
 * Collections nest — `parentId` is the immediate parent, `rootCollectionId` the
 * top of the tree — and files are versioned, with `isLatest` marking the current
 * revision. File *upload* is not in this catalog; these operations manage the
 * structure and permissions around files that already exist.
 */

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';
import type { Collection, CollectionItem } from '../types/index.js';

export const collectionsOperations = {
  // ----- Reads -----

  /**
   * Root collections, optionally narrowed to one scope.
   * Maps to: Zero query 'scopedCollections'
   */
  list: query<{ scopeType?: string; scopeId?: string } | undefined, Collection[]>(
    'scopedCollections',
    {
      mapArgs: (args) => ({ ...(args ?? {}) }),
    }
  ),

  /**
   * Sub-collections beneath a root.
   * Maps to: Zero query 'collectionSubfolders'
   */
  listSubfolders: query<{ rootCollectionId: string }, Collection[]>(
    'collectionSubfolders'
  ),

  /**
   * Files in a collection — latest versions only.
   * Maps to: Zero query 'collectionItems'
   */
  listItems: query<{ collectionId: string }, CollectionItem[]>('collectionItems'),

  /**
   * One collection by id, or nothing if it has been soft-deleted.
   * Maps to: Zero query 'collectionById'
   *
   * The query filters on the primary key but does **not** end in `.one()`, so
   * the wire shape is a list. Unwrapped here so the declared return type is
   * honest about there being at most one.
   */
  get: query<{ id: string }, Collection | null>('collectionById', {
    mapResult: (rows) => (rows as Collection[])[0] ?? null,
  }),

  /**
   * Every latest-version file beneath a root collection, across its subfolders,
   * with each file's attachment joined in.
   * Maps to: Zero query 'collectionFilesByRoot'
   *
   * Differs from {@link listItems}, which is one collection's own files:
   * this walks the whole tree under a root.
   */
  listFilesByRoot: query<{ rootCollectionId: string }, CollectionItem[]>(
    'collectionFilesByRoot'
  ),

  /**
   * Root collections with their files already joined.
   * Maps to: Zero query 'scopedCollectionsWithItems'
   *
   * Same scoping as {@link list} — omit both arguments for everything the
   * caller can reach — but one round trip instead of a list-then-fetch per
   * collection.
   */
  listWithItems: query<{ scopeType?: string; scopeId?: string } | undefined, Collection[]>(
    'scopedCollectionsWithItems',
    {
      mapArgs: (args) => ({ ...(args ?? {}) }),
    }
  ),

  // ----- Writes -----

  /**
   * Create a root collection. The creator's permission row is created with it.
   * Maps to: Zero mutator 'collection.createCollection'
   */
  create: mutator<
    {
      id: string;
      permissionId: string;
      name: string;
      scopeType: string;
      scopeId: string;
      description?: string;
      isPrivate?: boolean;
    },
    void
  >('collection.createCollection', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Rename a collection or change its description or privacy.
   * Maps to: Zero mutator 'collection.updateCollection'
   */
  update: mutator<
    { id: string; name?: string; description?: string; isPrivate?: boolean },
    void
  >('collection.updateCollection', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Delete a collection.
   * Maps to: Zero mutator 'collection.deleteCollection'
   */
  delete: mutator<{ id: string }, void>('collection.deleteCollection', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),

  /**
   * Create a sub-collection under a parent.
   * Maps to: Zero mutator 'collection.createFolder'
   */
  createFolder: mutator<{ id: string; parentId: string; name: string }, void>(
    'collection.createFolder',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Rename a file or sub-collection.
   * Maps to: Zero mutator 'collection.renameItem'
   */
  renameItem: mutator<{ id: string; collectionId: string; name: string }, void>(
    'collection.renameItem',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Remove a file or sub-collection.
   * Maps to: Zero mutator 'collection.deleteItem'
   */
  deleteItem: mutator<{ id: string; collectionId: string }, void>(
    'collection.deleteItem',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Grant a user or group access to a collection.
   *
   * Exactly one of `userId` or `userGroupId` should be set. Granting access also
   * re-indexes the collection's files so search reflects the new permissions.
   * Maps to: Zero mutator 'collection.grantPermission'
   */
  grantPermission: mutator<
    {
      id: string;
      collectionId: string;
      role: string;
      canShare: boolean;
      userId?: string;
      userGroupId?: string;
    },
    void
  >('collection.grantPermission', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Revoke a permission grant.
   * Maps to: Zero mutator 'collection.revokePermission'
   */
  revokePermission: mutator<{ id: string; collectionId: string }, void>(
    'collection.revokePermission'
  ),
} as const;
