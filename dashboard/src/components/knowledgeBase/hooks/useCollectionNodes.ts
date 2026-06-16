import { useMemo } from 'react';
import { NodeType, FailedCollectionItem } from '../../../services/Knowledge/collectionService';
import { CollectionItem, IngestionStatus, MessageAttachment } from '@xyne/shared';
import { CollectionTreeNode } from '../tree/treeTypes';

interface ZeroFolder {
  id: string;
  name: string;
  parentId: string | null;
  rootCollectionId: string | null;
  updatedAt: number;
}

type CollectionItemWithAttachment = CollectionItem & {
  attachment?: MessageAttachment | undefined;
};

interface UseCollectionNodesParams {
  zeroItems: CollectionItemWithAttachment[];
  zeroFolders: ZeroFolder[];
  collectionId: string | null;
}

export function useCollectionNodes({
  zeroItems,
  zeroFolders,
  collectionId,
}: UseCollectionNodesParams) {
  const nodes = useMemo(() => {
    const childrenMap: Record<string, string[]> = {};
    for (const folder of zeroFolders) {
      const parentKey = folder.parentId ?? collectionId ?? '';
      (childrenMap[parentKey] ??= []).push(folder.id);
    }
    for (const item of zeroItems) {
      if (item.collectionId !== collectionId) {
        (childrenMap[item.collectionId] ??= []).push(item.id);
      }
    }

    const result: Record<string, CollectionTreeNode> = {};

    for (const folder of zeroFolders) {
      result[folder.id] = {
        id: folder.id,
        name: folder.name,
        type: 'FOLDER' as NodeType,
        parentId: folder.parentId === collectionId ? null : (folder.parentId ?? null),
        uploadStatus: null,
        size: 0,
        updatedAt: folder.updatedAt
          ? new Date(folder.updatedAt).toISOString()
          : new Date().toISOString(),
        mimeType: '',
        childrenIds: childrenMap[folder.id] ?? [],
        isLoaded: true,
        isLoading: false,
      };
    }

    for (const item of zeroItems) {
      const attachment = item.attachment;
      result[item.id] = {
        id: item.id,
        fileId: item.fileId,
        name: item.name,
        type: 'FILE' as NodeType,
        parentId: item.collectionId === collectionId ? null : item.collectionId,
        uploadStatus: item.ingestionStatus !== IngestionStatus.NONE ? item.ingestionStatus : null,
        size: attachment?.size ?? 0,
        updatedAt: item.updatedAt
          ? new Date(item.updatedAt).toISOString()
          : new Date().toISOString(),
        mimeType: attachment?.mimetype ?? '',
        childrenIds: [],
        isLoaded: true,
        isLoading: false,
      };
    }

    return result;
  }, [zeroItems, zeroFolders, collectionId]);

  const rootChildrenIds = useMemo(() => {
    const rootFolderIds = zeroFolders
      .filter(f => (f.parentId ?? collectionId) === collectionId)
      .map(f => f.id);
    const rootFileIds = zeroItems
      .filter(item => item.collectionId === collectionId)
      .map(item => item.id);
    return [...rootFolderIds, ...rootFileIds];
  }, [zeroItems, zeroFolders, collectionId]);

  const failedItems: FailedCollectionItem[] = useMemo(() => {
    return zeroItems
      .filter(item => item.ingestionStatus === IngestionStatus.FAILED)
      .map(item => ({
        id: item.id,
        name: item.name,
        parentId: item.collectionId === collectionId ? null : item.collectionId,
        statusMessage: null,
      }));
  }, [zeroItems, collectionId]);

  return { nodes, rootChildrenIds, failedItems };
}
