import { useSelector } from '@xstate/react';
import {
  knowledgeBaseActor,
  ActiveCollectionInfo,
  ViewMode,
} from '../../../machines/knowledgeBaseMachine';
import { CollectionTreeNode } from '../tree/treeTypes';
import { FailedCollectionItem } from '../../../services/Knowledge/collectionService';

export type { ActiveCollectionInfo };

const sortedChildrenCacheRef: React.MutableRefObject<Record<string, Record<string, string[]>>> = {
  current: {},
};

export const setProjectId = (id: string | null): void => {
  knowledgeBaseActor.send({ type: 'SET_PROJECT_ID', id });
};

export const setChannelId = (id: string | null): void => {
  knowledgeBaseActor.send({ type: 'SET_CHANNEL_ID', id });
};

export const setActiveCollection = (info: ActiveCollectionInfo | null): void => {
  const currentId = knowledgeBaseActor.getSnapshot().context.activeCollection?.id;
  if (info?.id !== currentId) {
    sortedChildrenCacheRef.current = {};
  }
  knowledgeBaseActor.send({ type: 'SET_ACTIVE_COLLECTION', info });
};

export const setCurrentFolderId = (
  idOrUpdater: string | null | ((prev: string | null) => string | null),
): void => {
  const current = knowledgeBaseActor.getSnapshot().context.currentFolderId;
  const next = typeof idOrUpdater === 'function' ? idOrUpdater(current) : idOrUpdater;
  knowledgeBaseActor.send({ type: 'SET_CURRENT_FOLDER_ID', id: next });
};

export const setCurrentFileId = (id: string | null): void => {
  knowledgeBaseActor.send({ type: 'SET_CURRENT_FILE_ID', id });
};

export const setViewMode = (mode: ViewMode): void => {
  knowledgeBaseActor.send({ type: 'SET_VIEW_MODE', mode });
};

export const toggleFolder = (folderId: string): void => {
  knowledgeBaseActor.send({ type: 'TOGGLE_FOLDER', folderId });
};

export const expandFolder = (folderId: string): void => {
  knowledgeBaseActor.send({ type: 'EXPAND_FOLDER', folderId });
};

export const collapseFolder = (folderId: string): void => {
  knowledgeBaseActor.send({ type: 'COLLAPSE_FOLDER', folderId });
};

export const resetExpansion = (): void => {
  knowledgeBaseActor.send({ type: 'RESET_EXPANSION' });
};

export const invalidateSortedCache = (
  parentId: string | null,
  invalidateAll: boolean = false,
): void => {
  if (invalidateAll) {
    sortedChildrenCacheRef.current = {};
  } else {
    const cacheKey = parentId ?? 'root';
    const updated = { ...sortedChildrenCacheRef.current };
    delete updated[cacheKey];
    sortedChildrenCacheRef.current = updated;
  }
};
export interface ProjectCollectionsValue {
  projectId: string | null;
  setProjectId: typeof setProjectId;
  channelId: string | null;
  setChannelId: typeof setChannelId;
  activeCollection: ActiveCollectionInfo | null;
  setActiveCollection: typeof setActiveCollection;
  currentFolderId: string | null;
  setCurrentFolderId: typeof setCurrentFolderId;
  currentFileId: string | null;
  setCurrentFileId: typeof setCurrentFileId;
  viewMode: ViewMode;
  setViewMode: typeof setViewMode;
  expansionState: Record<string, boolean>;
  toggleFolder: typeof toggleFolder;
  expandFolder: typeof expandFolder;
  collapseFolder: typeof collapseFolder;
  resetExpansion: typeof resetExpansion;
  sortedChildrenCacheRef: React.MutableRefObject<Record<string, Record<string, string[]>>>;
  invalidateSortedCache: typeof invalidateSortedCache;
  nodes: Record<string, CollectionTreeNode>;
  rootChildrenIds: string[];
  failedItems: FailedCollectionItem[];
  isInitialLoading: boolean;
}

export function useProjectCollections(): ProjectCollectionsValue {
  const projectId = useSelector(knowledgeBaseActor, s => s.context.projectId);
  const channelId = useSelector(knowledgeBaseActor, s => s.context.channelId);
  const activeCollection = useSelector(knowledgeBaseActor, s => s.context.activeCollection);
  const currentFolderId = useSelector(knowledgeBaseActor, s => s.context.currentFolderId);
  const currentFileId = useSelector(knowledgeBaseActor, s => s.context.currentFileId);
  const viewMode = useSelector(knowledgeBaseActor, s => s.context.viewMode);
  const expansionState = useSelector(knowledgeBaseActor, s => s.context.expansionState);
  const nodes = useSelector(knowledgeBaseActor, s => s.context.nodes);
  const rootChildrenIds = useSelector(knowledgeBaseActor, s => s.context.rootChildrenIds);
  const failedItems = useSelector(knowledgeBaseActor, s => s.context.failedItems);
  const isInitialLoading = useSelector(knowledgeBaseActor, s => s.context.isInitialLoading);

  return {
    projectId,
    setProjectId,
    channelId,
    setChannelId,
    activeCollection,
    setActiveCollection,
    currentFolderId,
    setCurrentFolderId,
    currentFileId,
    setCurrentFileId,
    viewMode,
    setViewMode,
    expansionState,
    toggleFolder,
    expandFolder,
    collapseFolder,
    resetExpansion,
    sortedChildrenCacheRef,
    invalidateSortedCache,
    nodes,
    rootChildrenIds,
    failedItems,
    isInitialLoading,
  };
}
