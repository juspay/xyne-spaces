import { useCallback } from 'react';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { useProjectCollections } from '../hooks/useProjectCollections';

export function useProjectCollectionMutations() {
  const zero = useZero();
  const { activeCollection, setActiveCollection } = useProjectCollections();

  const renameCollection = useCallback(
    async (collectionId: string, newName: string) => {
      await zero.mutate(
        mutators.collection.updateCollection({
          id: collectionId,
          name: newName,
          timestamp: Date.now(),
        }),
      ).server;

      if (activeCollection && activeCollection.id === collectionId) {
        setActiveCollection({ ...activeCollection, name: newName });
      }
    },
    [zero, activeCollection, setActiveCollection],
  );

  const deleteCollection = useCallback(
    async (collectionId: string) => {
      await zero.mutate(
        mutators.collection.deleteCollection({
          id: collectionId,
          timestamp: Date.now(),
        }),
      ).server;

      if (activeCollection && activeCollection.id === collectionId) {
        setActiveCollection(null);
      }
    },
    [zero, activeCollection, setActiveCollection],
  );

  return { renameCollection, deleteCollection };
}
