import { setup, createActor, assign } from 'xstate';
import { CollectionRole, FailedCollectionItem } from '../services/Knowledge/collectionService';
import { CollectionTreeNode } from '../components/knowledgeBase/tree/treeTypes';

export interface ActiveCollectionInfo {
  id: string;
  name?: string | undefined;
  role?: CollectionRole | undefined;
  canShare?: boolean | undefined;
  ownerId?: string | undefined;
}

export type ViewMode = 'tree' | 'grid' | 'list';

export interface KnowledgeBaseContext {
  projectId: string | null;
  channelId: string | null;
  activeCollection: ActiveCollectionInfo | null;
  currentFolderId: string | null;
  currentFileId: string | null;
  viewMode: ViewMode;
  expansionState: Record<string, boolean>;
  nodes: Record<string, CollectionTreeNode>;
  rootChildrenIds: string[];
  failedItems: FailedCollectionItem[];
  isInitialLoading: boolean;
}

export type KnowledgeBaseEvent =
  | { type: 'SET_PROJECT_ID'; id: string | null }
  | { type: 'SET_CHANNEL_ID'; id: string | null }
  | { type: 'SET_ACTIVE_COLLECTION'; info: ActiveCollectionInfo | null }
  | { type: 'SET_VIEW_MODE'; mode: ViewMode }
  | { type: 'SET_CURRENT_FOLDER_ID'; id: string | null }
  | { type: 'SET_CURRENT_FILE_ID'; id: string | null }
  | { type: 'TOGGLE_FOLDER'; folderId: string }
  | { type: 'EXPAND_FOLDER'; folderId: string }
  | { type: 'COLLAPSE_FOLDER'; folderId: string }
  | { type: 'RESET_EXPANSION' }
  | {
      type: 'SET_COLLECTION_DATA';
      nodes: Record<string, CollectionTreeNode>;
      rootChildrenIds: string[];
      failedItems: FailedCollectionItem[];
      isInitialLoading: boolean;
    };

export const knowledgeBaseMachine = setup({
  types: {
    context: {} as KnowledgeBaseContext,
    events: {} as KnowledgeBaseEvent,
  },
  actions: {
    setProjectId: assign(({ event, context }) => {
      if (event.type !== 'SET_PROJECT_ID') return {};
      const idChanged = event.id !== context.projectId;
      return {
        projectId: event.id,
        ...(idChanged
          ? {
              channelId: null,
              activeCollection: null,
              currentFolderId: null,
              currentFileId: null,
              expansionState: {},
              nodes: {},
              rootChildrenIds: [],
              failedItems: [],
              isInitialLoading: false,
            }
          : {}),
      };
    }),
    setChannelId: assign(({ event, context }) => {
      if (event.type !== 'SET_CHANNEL_ID') return {};
      const idChanged = event.id !== context.channelId;
      return {
        channelId: event.id,
        ...(idChanged
          ? {
              activeCollection: null,
              currentFolderId: null,
              currentFileId: null,
              expansionState: {},
              nodes: {},
              rootChildrenIds: [],
              failedItems: [],
              isInitialLoading: false,
            }
          : {}),
      };
    }),
    setActiveCollection: assign(({ event, context }) => {
      if (event.type !== 'SET_ACTIVE_COLLECTION') return {};
      const idChanged = event.info?.id !== context.activeCollection?.id;
      return {
        activeCollection: event.info,
        ...(idChanged
          ? {
              currentFolderId: null,
              currentFileId: null,
              expansionState: {},
              nodes: {},
              rootChildrenIds: [],
              failedItems: [],
              isInitialLoading: !!event.info,
            }
          : {}),
      };
    }),
    setViewMode: assign(({ event }) => {
      if (event.type !== 'SET_VIEW_MODE') return {};
      return { viewMode: event.mode };
    }),
    setCurrentFolderId: assign(({ event }) => {
      if (event.type !== 'SET_CURRENT_FOLDER_ID') return {};
      return { currentFolderId: event.id };
    }),
    setCurrentFileId: assign(({ event }) => {
      if (event.type !== 'SET_CURRENT_FILE_ID') return {};
      return { currentFileId: event.id };
    }),
    toggleFolder: assign(({ event, context }) => {
      if (event.type !== 'TOGGLE_FOLDER') return {};
      if (event.folderId === context.activeCollection?.id) return {};
      return {
        expansionState: {
          ...context.expansionState,
          [event.folderId]: !context.expansionState[event.folderId],
        },
      };
    }),
    expandFolder: assign(({ event, context }) => {
      if (event.type !== 'EXPAND_FOLDER') return {};
      return {
        expansionState: { ...context.expansionState, [event.folderId]: true },
      };
    }),
    collapseFolder: assign(({ event, context }) => {
      if (event.type !== 'COLLAPSE_FOLDER') return {};
      return {
        expansionState: { ...context.expansionState, [event.folderId]: false },
      };
    }),
    resetExpansion: assign(() => {
      return { expansionState: {} };
    }),
    setCollectionData: assign(({ event }) => {
      if (event.type !== 'SET_COLLECTION_DATA') return {};
      return {
        nodes: event.nodes,
        rootChildrenIds: event.rootChildrenIds,
        failedItems: event.failedItems,
        isInitialLoading: event.isInitialLoading,
      };
    }),
  },
}).createMachine({
  id: 'knowledgeBase',
  initial: 'active',
  context: {
    projectId: null,
    channelId: null,
    activeCollection: null,
    currentFolderId: null,
    currentFileId: null,
    viewMode: 'list',
    expansionState: {},
    nodes: {},
    rootChildrenIds: [],
    failedItems: [],
    isInitialLoading: false,
  },
  states: {
    active: {
      on: {
        SET_PROJECT_ID: { actions: 'setProjectId' },
        SET_CHANNEL_ID: { actions: 'setChannelId' },
        SET_ACTIVE_COLLECTION: { actions: 'setActiveCollection' },
        SET_VIEW_MODE: { actions: 'setViewMode' },
        SET_CURRENT_FOLDER_ID: { actions: 'setCurrentFolderId' },
        SET_CURRENT_FILE_ID: { actions: 'setCurrentFileId' },
        TOGGLE_FOLDER: { actions: 'toggleFolder' },
        EXPAND_FOLDER: { actions: 'expandFolder' },
        COLLAPSE_FOLDER: { actions: 'collapseFolder' },
        RESET_EXPANSION: { actions: 'resetExpansion' },
        SET_COLLECTION_DATA: { actions: 'setCollectionData' },
      },
    },
  },
});

export const knowledgeBaseActor = createActor(knowledgeBaseMachine);
knowledgeBaseActor.start();
