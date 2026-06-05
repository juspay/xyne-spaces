import { useCallback } from 'react';
import { NodeType } from '../../../services/Knowledge/collectionService';
import { TreeNodeData } from '../tree/treeTypes';
import { CollectionTreeNode, SortOption } from '../tree/treeTypes';

const getSortKey = (sortOption: SortOption): string => {
  return `${sortOption.field}_${sortOption.order}`;
};

function buildTreeChildren(
  children: CollectionTreeNode[],
  buildNode: (nodeId: string) => TreeNodeData | null,
): TreeNodeData[] {
  return children.map(c => buildNode(c.id)).filter((n): n is TreeNodeData => n !== null);
}

interface UseTreeDataParams {
  collectionId: string | null;
  nodes: Record<string, CollectionTreeNode>;
  rootChildrenIds: string[];
  sortedChildrenCacheRef: React.MutableRefObject<Record<string, Record<string, string[]>>>;
  expansionState: Record<string, boolean>;
}

export function useTreeData({
  collectionId,
  nodes,
  rootChildrenIds,
  sortedChildrenCacheRef,
  expansionState,
}: UseTreeDataParams) {
  const getChildrenOf = useCallback(
    (parentId: string | null): CollectionTreeNode[] => {
      if (parentId === null) {
        return rootChildrenIds
          .map(id => nodes[id])
          .filter((n): n is CollectionTreeNode => n !== undefined);
      }
      const parent = nodes[parentId];
      if (!parent) return [];
      return parent.childrenIds
        .map(id => nodes[id])
        .filter((n): n is CollectionTreeNode => n !== undefined);
    },
    [nodes, rootChildrenIds],
  );

  const getSortedChildren = useCallback(
    (parentId: string | null, sortOption: SortOption): CollectionTreeNode[] => {
      const cacheKey = parentId ?? 'root';
      const sortKey = getSortKey(sortOption);

      const cached = sortedChildrenCacheRef.current[cacheKey]?.[sortKey];
      if (cached) {
        return cached.map(id => nodes[id]).filter((n): n is CollectionTreeNode => n !== undefined);
      }

      const children = getChildrenOf(parentId);

      const sorted = [...children].sort((a, b) => {
        if (a.type !== b.type) {
          return (a.type as string) === 'FOLDER' ? -1 : 1;
        }

        let comparison = 0;
        switch (sortOption.field) {
          case 'name':
            comparison = a.name.localeCompare(b.name);
            break;
          case 'date':
            comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
            break;
          case 'size':
            comparison = a.size - b.size;
            break;
        }

        return sortOption.order === 'asc' ? comparison : -comparison;
      });

      const sortedIds = sorted.map(n => n.id);
      sortedChildrenCacheRef.current = {
        ...sortedChildrenCacheRef.current,
        [cacheKey]: {
          ...sortedChildrenCacheRef.current[cacheKey],
          [sortKey]: sortedIds,
        },
      };

      return sorted;
    },
    [nodes, getChildrenOf, sortedChildrenCacheRef],
  );

  const buildTreeNode = useCallback(
    (nodeId: string): TreeNodeData | null => {
      const node = nodes[nodeId];
      if (!node) return null;

      const isExpanded = expansionState[nodeId] ?? false;
      const result: TreeNodeData = {
        id: node.id,
        name: node.name,
        type: node.type,
        status: node.uploadStatus,
        isExpanded,
        isLoading: node.isLoading,
      };

      if (node.type === 'FOLDER') {
        if (isExpanded && node.childrenIds.length > 0) {
          result.children = node.childrenIds
            .map(id => buildTreeNode(id))
            .filter((n): n is TreeNodeData => n !== null);
        } else if (node.childrenIds.length > 0) {
          result.children = [];
        }
      }

      return result;
    },
    [nodes, expansionState],
  );

  const buildTreeNodeSorted = useCallback(
    (nodeId: string, sortOption: SortOption): TreeNodeData | null => {
      const node = nodes[nodeId];
      if (!node) return null;

      const isExpanded = expansionState[nodeId] ?? false;
      const result: TreeNodeData = {
        id: node.id,
        name: node.name,
        type: node.type,
        status: node.uploadStatus,
        isExpanded,
        isLoading: node.isLoading,
      };

      if (node.type === 'FOLDER') {
        if (isExpanded && node.childrenIds.length > 0) {
          const sortedChildren = getSortedChildren(nodeId, sortOption);
          result.children = sortedChildren
            .map(child => buildTreeNodeSorted(child.id, sortOption))
            .filter((n): n is TreeNodeData => n !== null);
        } else if (node.childrenIds.length > 0) {
          result.children = [];
        }
      }

      return result;
    },
    [nodes, expansionState, getSortedChildren],
  );

  const getTreeData = useCallback(
    (
      rootId?: string,
      rootName?: string,
      startFromFolderId?: string | null,
      sortOption?: SortOption,
    ): TreeNodeData | null => {
      if (!collectionId) return null;

      const buildNode = sortOption
        ? (nodeId: string) => buildTreeNodeSorted(nodeId, sortOption)
        : buildTreeNode;

      const getChildren = sortOption
        ? (parentId: string | null) => getSortedChildren(parentId, sortOption)
        : getChildrenOf;

      if (startFromFolderId !== undefined && startFromFolderId !== null) {
        const startNode = nodes[startFromFolderId];
        if (!startNode || startNode.type !== 'FOLDER') {
          return null;
        }

        return {
          id: rootId || collectionId,
          name: rootName || 'Collection',
          type: 'FOLDER' as NodeType,
          children: buildTreeChildren(getChildren(startFromFolderId), buildNode),
          isExpanded: true,
        };
      }

      if (rootChildrenIds.length === 0) return null;

      return {
        id: rootId || collectionId,
        name: rootName || 'Collection',
        type: 'FOLDER' as NodeType,
        children: buildTreeChildren(getChildren(null), buildNode),
        isExpanded: true,
      };
    },
    [
      collectionId,
      rootChildrenIds,
      nodes,
      getSortedChildren,
      getChildrenOf,
      buildTreeNodeSorted,
      buildTreeNode,
    ],
  );

  return { getTreeData, getChildrenOf, getSortedChildren };
}
