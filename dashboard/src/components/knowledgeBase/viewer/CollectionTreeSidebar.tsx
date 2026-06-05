import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { TreeNode } from '../tree/TreeNode';
import { TreeSearchInput } from '../tree/TreeSearchInput';
import { TreeNodeData } from '../tree/treeTypes';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { useTreeData } from '../hooks/useTreeData';
import { NodeType } from '../../../services/Knowledge/collectionService';

interface CollectionTreeSidebarProps {
  collectionId?: string | null;
}

export const CollectionTreeSidebar: React.FC<CollectionTreeSidebarProps> = ({
  collectionId: propCollectionId,
}) => {
  const {
    projectId,
    channelId,
    collectionId: paramCollectionId,
    folderId: paramFolderId,
    fileId,
  } = useParams<{
    projectId?: string;
    channelId?: string;
    collectionId?: string;
    folderId?: string;
    fileId?: string;
  }>();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const collectionId = propCollectionId || paramCollectionId || null;

  const resolvedFolderId = paramFolderId === '_' ? null : (paramFolderId ?? null);

  const {
    activeCollection,
    setActiveCollection,
    currentFolderId,
    sortedChildrenCacheRef,
    invalidateSortedCache,
    expansionState,
    toggleFolder,
    nodes,
    rootChildrenIds,
    isInitialLoading,
  } = useProjectCollections();
  const contextCollectionId = activeCollection?.id ?? null;
  const { getTreeData } = useTreeData({
    collectionId: contextCollectionId,
    nodes,
    rootChildrenIds,
    sortedChildrenCacheRef,
    expansionState,
  });

  useEffect(() => {
    if (collectionId && collectionId !== contextCollectionId) {
      if (activeCollection?.id === collectionId) return;
      setActiveCollection({ id: collectionId });
    }
  }, [collectionId, contextCollectionId, activeCollection, setActiveCollection]);

  const treeData = useMemo(() => {
    const raw = getTreeData(collectionId || undefined, 'Collection Files', currentFolderId);
    if (!raw || !searchQuery.trim()) return raw;

    const filterNode = (node: TreeNodeData): TreeNodeData | null => {
      const matches = node.name.toLowerCase().includes(searchQuery.toLowerCase());
      const filteredChildren = (node.children ?? [])
        .map(filterNode)
        .filter((c): c is TreeNodeData => c !== null);

      if (matches || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren.length > 0 ? filteredChildren : (node.children ?? []),
        };
      }
      return null;
    };

    return filterNode(raw);
  }, [getTreeData, collectionId, searchQuery, currentFolderId]);

  const handleNodeSelect = (nodeId: string, type: NodeType): void => {
    if (collectionId && projectId && channelId && type === 'FILE') {
      const folder = resolvedFolderId || '_';
      void navigate(
        `/knowledge-base/${projectId}/${channelId}/${collectionId}/${folder}/${nodeId}`,
      );
    }
  };

  if (isInitialLoading) {
    return (
      <div className='h-full flex items-center justify-center p-4'>
        <div className='text-center'>
          <Loader2 size={20} className='mx-auto text-blue-500 animate-spin mb-2' />
          <p className='text-sm text-gray-500'>Loading files...</p>
        </div>
      </div>
    );
  }

  if (!collectionId) {
    return (
      <div className='h-full flex items-center justify-center p-4'>
        <div className='text-center text-sm text-gray-500'>
          <p>No collection found</p>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col'>
      {/* Header */}
      <div className='p-4'>
        <TreeSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder='Search files...'
        />
      </div>

      {/* Tree */}
      <div className='flex-1 overflow-auto'>
        {treeData ? (
          <div className='py-2'>
            {treeData.children?.map(node => (
              <TreeNode
                key={node.id}
                node={node}
                selectedNodeId={fileId || null}
                onSelect={handleNodeSelect}
                onToggle={folderId => {
                  void toggleFolder(folderId);
                  invalidateSortedCache(folderId);
                }}
                level={0}
                variant='compact'
              />
            ))}
          </div>
        ) : (
          <div className='p-4 text-center text-sm text-gray-500'>No files in this collection</div>
        )}
      </div>
    </div>
  );
};
