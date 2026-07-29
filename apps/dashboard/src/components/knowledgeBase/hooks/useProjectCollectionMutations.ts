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

  // Owner-only visibility flip. The server rejects non-owners; we surface that
  // error to the caller via `.server` so the UI can toast a useful message.
  const setCollectionVisibility = useCallback(
    async (collectionId: string, isPrivate: boolean) => {
      const serverRes = await zero.mutate(
        mutators.collection.updateCollection({
          id: collectionId,
          isPrivate,
          timestamp: Date.now(),
        }),
      ).server;
      if (serverRes.type === 'error') {
        throw new Error(serverRes.error.message || 'Failed to update visibility');
      }
    },
    [zero],
  );

  return { renameCollection, deleteCollection, setCollectionVisibility };
}
