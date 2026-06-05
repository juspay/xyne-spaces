import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  MoreVertical,
  Download,
  Trash2,
  Pencil,
} from 'lucide-react';
import { TreeNodeData } from './treeTypes';
import { FileIcon } from '../shared/FileIcon';
import { TreeNodeLabel } from './TreeNodeLabel';
import { IngestionStatusBadge } from '../shared/UploadStatusBadge';
import { DownloadOverlay } from '../shared/DownloadOverlay';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { useCollectionMutations } from '../hooks/useCollectionMutations';
import { toast } from 'sonner';
import {
  NodeType,
  downloadFile,
  downloadFolder,
} from '../../../services/Knowledge/collectionService';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

interface TreeNodeProps {
  node: TreeNodeData;
  selectedNodeId: string | null;
  onSelect: (nodeId: string, type: NodeType) => void;
  onToggle?: ((nodeId: string) => void) | undefined;
  level: number;
  variant?: 'pill' | 'compact';
}

export const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  selectedNodeId,
  onSelect,
  onToggle,
  level,
  variant = 'compact',
}) => {
  const { activeCollection } = useProjectCollections();
  const collectionRole = activeCollection?.role;
  const { renameNode, deleteNode } = useCollectionMutations();

  const canRename = !collectionRole || collectionRole === 'EDITOR' || collectionRole === 'OWNER';
  const canDownload =
    !collectionRole ||
    collectionRole === 'EDITOR' ||
    collectionRole === 'OWNER' ||
    collectionRole === 'VIEWER';
  const canDelete = !collectionRole || collectionRole === 'EDITOR' || collectionRole === 'OWNER';

  const [localExpanded, setLocalExpanded] = useState(true);

  const isControlled = onToggle !== undefined;
  const isExpanded = isControlled ? (node.isExpanded ?? false) : localExpanded;
  const isLoading = node.isLoading ?? false;

  const isFolder = node.type === 'FOLDER';

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [isDownloading, setIsDownloading] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const hasChildren = node.children !== undefined && node.children.length > 0;
  const isExpandable = isFolder && (hasChildren || node.children !== undefined);
  const isSelected = selectedNodeId === node.id;

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
    }
  }, [isRenaming]);

  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleClick = (e: React.MouseEvent): void => {
    if (isRenaming) {
      e.stopPropagation();
      return;
    }

    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }

    if (isExpandable) {
      clickTimeoutRef.current = setTimeout(() => {
        if (isControlled && onToggle) {
          void onToggle(node.id);
        } else {
          setLocalExpanded(!localExpanded);
        }
        clickTimeoutRef.current = null;
      }, 250);
    } else {
      clickTimeoutRef.current = setTimeout(() => {
        onSelect(node.id, node.type);
        clickTimeoutRef.current = null;
      }, 250);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }

    if (isRenaming) return;
    if (!canRename) return;

    setIsRenaming(true);
    setRenameValue(node.name);
  };

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  const handleRenameSubmit = async () => {
    const trimmedName = renameValue.trim();
    if (!trimmedName || trimmedName === node.name) {
      setIsRenaming(false);
      setRenameValue(node.name);
      return;
    }

    try {
      await renameNode(node.id, trimmedName);
      toast.success('Renamed successfully');
      setIsRenaming(false);
    } catch (error) {
      console.error('Failed to rename:', error);
      toast.error('Failed to rename. Please try again.');
    }
  };

  const handleRenameCancel = () => {
    setIsRenaming(false);
    setRenameValue(node.name);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void handleRenameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleRenameCancel();
    }
  };

  const handleDelete = async () => {
    if (!canDelete) return;

    if (!confirm(`Are you sure you want to delete "${node.name}"?`)) {
      return;
    }

    try {
      await deleteNode(node.id);
      toast.success('Deleted successfully');
    } catch (error) {
      console.error('Failed to delete:', error);
      toast.error('Failed to delete. Please try again.');
    }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      if (isFolder) {
        await downloadFolder(node.id, node.name);
      } else {
        await downloadFile(node.id, node.name);
      }
      toast.success(`Downloaded "${node.name}"`);
    } catch (error) {
      console.error('Failed to download:', error);
      toast.error('Failed to download. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div>
      <div
        className={`
          flex items-center gap-1.5 px-2 py-1.5 cursor-pointer rounded
          hover:hover:bg-blue-50 transition-colors
          select-none
          ${isSelected ? 'bg-blue-50 text-blue-900' : 'text-gray-700'}
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        role='button'
        tabIndex={0}
        data-track-category='knowledge-base'
        data-track-name='select-node'
        onKeyDown={e => {
          if (isRenaming) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick(e as unknown as React.MouseEvent);
          }
        }}
      >
        {isExpandable ? (
          <div className='flex-shrink-0 w-4'>
            {isLoading ? (
              <Loader2 size={14} className='text-blue-500 animate-spin' />
            ) : isExpanded ? (
              <ChevronDown size={14} className='text-gray-500' />
            ) : (
              <ChevronRight size={14} className='text-gray-500' />
            )}
          </div>
        ) : (
          <div className='flex-shrink-0 w-4' />
        )}

        <FileIcon nodeType={node.type} isExpanded={isExpanded} variant='tree' />

        {isRenaming ? (
          <input
            ref={renameInputRef}
            type='text'
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={() => void handleRenameSubmit()}
            onKeyDown={handleRenameKeyDown}
            onClick={e => e.stopPropagation()}
            data-track-category='knowledge-base'
            data-track-name='rename-input'
            className='flex-1 min-w-0 px-1 py-0.5 text-sm border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white'
            style={{ minWidth: '100px', maxWidth: '200px' }}
          />
        ) : (
          <div className='flex items-center gap-1.5 flex-1 min-w-0'>
            <TreeNodeLabel name={node.name} />
            {node.status && <IngestionStatusBadge status={node.status} variant={variant} />}
          </div>
        )}

        {!isRenaming && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                onClick={e => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onDoubleClick={e => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                className='p-2 rounded-full hover:bg-blue-100 transition-colors flex-shrink-0'
                aria-label='Node options'
                data-track-category='knowledge-base'
                data-track-name='node-options'
              >
                <MoreVertical size={14} className='text-gray-500' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-40'>
              <DropdownMenuItem
                onClick={e => {
                  e.stopPropagation();
                  if (canDownload) {
                    void handleDownload();
                  }
                }}
                className='flex items-center gap-2 cursor-pointer'
                disabled={!canDownload}
              >
                <Download size={14} className='text-gray-500' />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={e => {
                  e.stopPropagation();
                  if (canRename) {
                    setIsRenaming(true);
                    setRenameValue(node.name);
                  }
                }}
                className='flex items-center gap-2 cursor-pointer'
                disabled={!canRename}
              >
                <Pencil size={14} className='text-gray-500' />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={e => {
                  e.stopPropagation();
                  if (canDelete) {
                    void handleDelete();
                  }
                }}
                className='flex items-center gap-2 cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50'
                disabled={!canDelete}
              >
                <Trash2 size={14} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {isExpandable && isExpanded && hasChildren && (
        <div>
          {node.children!.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              onToggle={onToggle}
              level={level + 1}
              variant={variant}
            />
          ))}
        </div>
      )}

      <DownloadOverlay
        isOpen={isDownloading}
        itemName={node.name}
        itemType={isFolder ? 'folder' : 'file'}
        onDismiss={() => setIsDownloading(false)}
      />
    </div>
  );
};
