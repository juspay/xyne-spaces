/**
 * ProjectCollectionsProvider - Manages collection list for a project
 *
 * Responsibilities:
 * - Track active project and collection
 * - Provide collection mutation operations via Zero mutators
 * - Real-time sync is handled automatically by Zero's replication
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { CollectionRole } from '../../../services/Knowledge/collectionService';

// ─── Types ────────────────────────────────────────────────────────────────

/** Consolidated active collection info */
export interface ActiveCollectionInfo {
  id: string;
  name?: string | undefined;
  role?: CollectionRole | undefined;
  canShare?: boolean | undefined;
  ownerId?: string | undefined;
}

interface ProjectCollectionsContextValue {
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  /** All synced properties for the currently active collection */
  activeCollection: ActiveCollectionInfo | null;
  /** Replace the active collection entirely (e.g. when user selects a different collection) */
  setActiveCollection: (info: ActiveCollectionInfo | null) => void;
  // ── Collection operations ──
  /** Rename a collection */
  renameCollection: (collectionId: string, newName: string) => Promise<void>;
  /** Delete a collection */
  deleteCollection: (collectionId: string) => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────

const ProjectCollectionsContext = createContext<ProjectCollectionsContextValue | null>(null);

export const useProjectCollections = (): ProjectCollectionsContextValue => {
  const ctx = useContext(ProjectCollectionsContext);
  if (!ctx) {
    throw new Error('useProjectCollections must be used within a ProjectCollectionsProvider');
  }
  return ctx;
};

// ─── Provider ─────────────────────────────────────────────────────────────

interface ProjectCollectionsProviderProps {
  children: React.ReactNode;
}

export const ProjectCollectionsProvider: React.FC<ProjectCollectionsProviderProps> = ({
  children,
}) => {
  const zero = useZero();

  const [projectId, setProjectIdState] = useState<string | null>(null);
  const [activeCollection, setActiveCollection] = useState<ActiveCollectionInfo | null>(null);

  const activeCollectionRef = useRef(activeCollection);
  useEffect(() => {
    activeCollectionRef.current = activeCollection;
  }, [activeCollection]);

  // ── Wrapper to clear active collection when project changes ──

  const setProjectId = useCallback(
    (id: string | null) => {
      if (id !== projectId) {
        if ((projectId !== null && id !== null) || id === null) {
          setActiveCollection(null);
        }
      }
      setProjectIdState(id);
    },
    [projectId],
  );

  // ── Rename Collection ──

  const renameCollection = useCallback(
    async (collectionId: string, newName: string) => {
      await zero.mutate(
        mutators.collection.updateCollection({
          id: collectionId,
          name: newName,
          timestamp: Date.now(),
        }),
      ).server;

      // Keep active collection in sync if it's the renamed one
      const currentActive = activeCollectionRef.current;
      if (currentActive && currentActive.id === collectionId) {
        setActiveCollection(prev => (prev ? { ...prev, name: newName } : prev));
      }
    },
    [zero],
  );

  // ── Delete Collection ──

  const deleteCollection = useCallback(
    async (collectionId: string) => {
      const currentActive = activeCollectionRef.current;

      await zero.mutate(
        mutators.collection.deleteCollection({
          id: collectionId,
          timestamp: Date.now(),
        }),
      ).server;

      // Clear active collection if the deleted one was active
      if (currentActive && collectionId === currentActive.id) {
        setActiveCollection(null);
      }
    },
    [zero],
  );

  // ── Context value ──

  const value: ProjectCollectionsContextValue = {
    projectId,
    setProjectId,
    activeCollection,
    setActiveCollection,
    renameCollection,
    deleteCollection,
  };

  return (
    <ProjectCollectionsContext.Provider value={value}>
      {children}
    </ProjectCollectionsContext.Provider>
  );
};
