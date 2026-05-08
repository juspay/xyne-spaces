import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { TreeNode } from '../tree/TreeNode';
import { TreeSearchInput } from '../tree/TreeSearchInput';
import { TreeNodeData } from '../tree/treeTypes';
import { useCollectionTree } from '../context/CollectionTreeContext';
import { useProjectCollections } from '../context/ProjectCollectionsContext';
import { NodeType } from '../../../services/Knowledge/collectionService';

interface CollectionTreeSidebarProps {
  collectionId?: string | null;
}

/**
 * Collection Tree Sidebar Component
 * Shows tree of files within the collection of the currently viewed file.
 * Reads from CollectionTreeContext — no own API calls.
 * Always renders as a tree (never list view).
 * Shares expanded-folder state with the FileBrowser tree view.
 */
export const CollectionTreeSidebar: React.FC<CollectionTreeSidebarProps> = ({
  collectionId: propCollectionId,
}) => {
  const {
    projectId,
    collectionId: paramCollectionId,
    folderId: paramFolderId,
    fileId,
  } = useParams<{
    projectId?: string;
    collectionId?: string;
    folderId?: string;
    fileId?: string;
  }>();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  // Get collectionId from props or URL params
  const collectionId = propCollectionId || paramCollectionId || null;

  // '_' sentinel → null (collection root)
  const resolvedFolderId = paramFolderId === '_' ? null : (paramFolderId ?? null);

  // Shared tree context
  const {
    collectionId: contextCollectionId,
    isInitialLoading,
    getTreeData,
    toggleFolder,
    currentFolderId,
  } = useCollectionTree();

  // Project collections context to sync collectionId
  const { activeCollection, setActiveCollection } = useProjectCollections();

  // Sync the collectionId into context (if not already set by TreeLayout)
  useEffect(() => {
    if (collectionId && collectionId !== contextCollectionId) {
      // Preserve existing collection info if same id, otherwise create minimal info
      if (activeCollection?.id === collectionId) return; // Already set
      setActiveCollection({ id: collectionId });
    }
  }, [collectionId, contextCollectionId, activeCollection, setActiveCollection]);

  // Build tree data from context
  const treeData = useMemo(() => {
    // Build tree starting from current folder's children (or root if null)
    const raw = getTreeData(collectionId || undefined, 'Collection Files', currentFolderId);
    if (!raw || !searchQuery.trim()) return raw;

    // Client-side search filtering
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
    // Navigate to file when clicked, preserving projectId and collectionId
    if (collectionId && projectId && type === 'FILE') {
      const folder = resolvedFolderId || '_';
      void navigate(`/knowledge-base/${projectId}/${collectionId}/${folder}/${nodeId}`);
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
