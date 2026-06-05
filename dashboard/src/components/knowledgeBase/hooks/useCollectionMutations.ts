import { useCallback } from 'react';
import { useZero } from '../../../hooks/useZero';
import { useAuth } from '../../../hooks/useAuth';
import { mutators } from '../../../zero/mutators';
import { useProjectCollections } from '../hooks/useProjectCollections';

export function useCollectionMutations() {
  const zero = useZero();
  const { user } = useAuth();
  const { activeCollection, setCurrentFolderId, invalidateSortedCache, nodes } =
    useProjectCollections();
  const collectionId = activeCollection?.id ?? null;

  const hydrateAncestors = useCallback(
    (itemId: string | null, _cId: string | null): Promise<void> => {
      if (!itemId) return Promise.resolve();
      const item = nodes[itemId];
      if (!item) return Promise.resolve();
      if ((item.type as string) === 'FILE' && item.parentId) {
        setCurrentFolderId(item.parentId);
      }
      return Promise.resolve();
    },
    [nodes, setCurrentFolderId],
  );

  const renameNode = useCallback(
    async (nodeId: string, newName: string) => {
      const node = nodes[nodeId];
      if (!node) throw new Error('Node not found');
      if (!collectionId) throw new Error('No collection selected');
      if (!user?.id) throw new Error('User not authenticated');

      invalidateSortedCache(node.parentId);

      await zero.mutate(
        mutators.collection.renameItem({
          id: nodeId,
          collectionId,
          name: newName,
          timestamp: Date.now(),
        }),
      ).server;
    },
    [zero, nodes, collectionId, user?.id, invalidateSortedCache],
  );

  const deleteNode = useCallback(
    async (nodeId: string) => {
      const node = nodes[nodeId];
      if (!node) throw new Error('Node not found');
      if (!collectionId) throw new Error('No collection selected');
      if (!user?.id) throw new Error('User not authenticated');

      const parentId = node.parentId;

      invalidateSortedCache(parentId);

      try {
        await zero.mutate(
          mutators.collection.deleteItem({
            id: nodeId,
            collectionId,
            timestamp: Date.now(),
          }),
        ).server;

        setCurrentFolderId(prev => (prev === nodeId ? (parentId ?? null) : prev));
      } catch (err) {
        invalidateSortedCache(parentId);
        throw new Error('Failed to delete item', { cause: err });
      }
    },
    [zero, nodes, collectionId, user?.id, setCurrentFolderId, invalidateSortedCache],
  );

  return { renameNode, deleteNode, hydrateAncestors };
}
