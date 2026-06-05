import React, { useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useProjectCollections } from './useProjectCollections';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { useCollectionNodes } from './useCollectionNodes';
import { knowledgeBaseActor } from '../../../machines/knowledgeBaseMachine';

interface CollectionTreeDataSyncProps {
  children: React.ReactNode;
}

export const CollectionTreeDataSync: React.FC<CollectionTreeDataSyncProps> = ({ children }) => {
  const { activeCollection, currentFolderId, setCurrentFolderId } = useProjectCollections();
  const collectionId = activeCollection?.id ?? null;

  const params = useParams<{
    projectId?: string;
    collectionId?: string;
    folderId?: string;
    fileId?: string;
  }>();
  const urlFolderId = params.folderId && params.folderId !== '_' ? params.folderId : null;

  const queryEnabled = !!collectionId;

  const [zeroRootItems, { type: rootItemsQueryType }] = useCachedQuery(
    queries.collectionItems({ collectionId: collectionId ?? '' }),
    queryEnabled,
  );

  const navigatingSubfolder = !!currentFolderId && currentFolderId !== collectionId;
  const [zeroFolderItems, { type: folderItemsQueryType }] = useCachedQuery(
    queries.collectionItems({ collectionId: currentFolderId ?? '' }),
    queryEnabled && navigatingSubfolder,
  );

  const [zeroFolders] = useCachedQuery(
    queries.collectionSubfolders({ rootCollectionId: collectionId ?? '' }),
    queryEnabled,
  );

  const zeroItems = useMemo(() => {
    if (!navigatingSubfolder) {
      return zeroRootItems;
    }
    const seen = new Set<string>();
    const merged: typeof zeroRootItems = [];
    for (const item of zeroRootItems) {
      const id = (item as { id: string }).id;
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(item);
      }
    }
    for (const item of zeroFolderItems) {
      const id = (item as { id: string }).id;
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(item);
      }
    }
    return merged;
  }, [zeroRootItems, zeroFolderItems, navigatingSubfolder]);

  const isInitialLoading = queryEnabled && rootItemsQueryType !== 'complete';

  const { nodes, rootChildrenIds, failedItems } = useCollectionNodes({
    zeroItems,
    zeroFolders,
    collectionId,
  });

  useEffect(() => {
    knowledgeBaseActor.send({
      type: 'SET_COLLECTION_DATA',
      nodes,
      rootChildrenIds,
      failedItems,
      isInitialLoading,
    });
  }, [nodes, rootChildrenIds, failedItems, isInitialLoading]);

  // Sync the URL folder param into machine state once queries have settled.
  useEffect(() => {
    if (!collectionId || !urlFolderId || rootItemsQueryType !== 'complete') return;
    if (navigatingSubfolder && folderItemsQueryType !== 'complete') return;
    if (!nodes[urlFolderId]) return;
    setCurrentFolderId(prev => (prev !== urlFolderId ? urlFolderId : prev));
  }, [
    collectionId,
    urlFolderId,
    rootItemsQueryType,
    folderItemsQueryType,
    navigatingSubfolder,
    nodes,
    setCurrentFolderId,
  ]);

  return <>{children}</>;
};
