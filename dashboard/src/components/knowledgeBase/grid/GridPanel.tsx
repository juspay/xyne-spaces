import React, { useState, useRef } from 'react';
import { GridCard } from './GridCard';
import { DownloadOverlay } from '../shared/DownloadOverlay';
import {
  CollectionChild,
  downloadFile,
  downloadFolder,
} from '../../../services/Knowledge/collectionService';
import { useCollectionTree } from '../context/CollectionTreeContext';
import { toast } from 'sonner';
import { ReplaceFileModal } from '../upload/ReplaceFileModal';
import { VersionHistoryModal } from '../upload/VersionHistoryModal';

interface GridPanelProps {
  files: CollectionChild[];
  onFileClick: (file: CollectionChild) => void;
}

/**
 * Grid Panel Component
 * Displays files in a grid layout (list view)
 * Handles file renaming functionality
 */
export const GridPanel: React.FC<GridPanelProps> = ({ files, onFileClick }) => {
  const { renameNode, deleteNode, collectionRole, collectionId } = useCollectionTree();

  // Check if user can rename/delete (owner or editor access)
  const canRename = !collectionRole || collectionRole === 'EDITOR' || collectionRole === 'OWNER';
  const canDownload =
    !collectionRole ||
    collectionRole === 'EDITOR' ||
    collectionRole === 'OWNER' ||
    collectionRole === 'VIEWER';
  const canDelete = !collectionRole || collectionRole === 'EDITOR' || collectionRole === 'OWNER';
  const canEdit = !collectionRole || collectionRole === 'EDITOR' || collectionRole === 'OWNER';

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingItem, setDownloadingItem] = useState<CollectionChild | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Version state
  const [replacingItem, setReplacingItem] = useState<CollectionChild | null>(null);
  const [versionHistoryItem, setVersionHistoryItem] = useState<CollectionChild | null>(null);

  // ── Rename handlers ──

  const handleStartRename = (file: CollectionChild): void => {
    if (!canRename) return;
    setRenamingId(file.id);
    setRenameValue(file.name);
    // Focus input after state update
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  };

  const handleRenameSubmit = async (fileId: string): Promise<void> => {
    const trimmedName = renameValue.trim();
    if (!trimmedName || trimmedName === files.find(f => f.id === fileId)?.name) {
      setRenamingId(null);
      setRenameValue('');
      return;
    }

    try {
      await renameNode(fileId, trimmedName);
      toast.success('Renamed successfully');
      setRenamingId(null);
      setRenameValue('');
    } catch {
      toast.error('Failed to rename. Please try again.');
      // Keep rename mode open on error so user can retry
    }
  };

  const handleRenameCancel = (): void => {
    setRenamingId(null);
    setRenameValue('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, fileId: string): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleRenameSubmit(fileId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleRenameCancel();
    }
  };

  // ── Delete handler ──

  const handleDelete = async (file: CollectionChild): Promise<void> => {
    if (!canDelete) return;

    if (!confirm(`Are you sure you want to delete "${file.name}"?`)) {
      return;
    }

    try {
      await deleteNode(file.id);
      toast.success('Deleted successfully');
    } catch {
      toast.error('Failed to delete. Please try again.');
    }
  };

  // ── Download handler ──

  const handleDownload = async (file: CollectionChild): Promise<void> => {
    if (!canDownload) return;

    setIsDownloading(true);
    setDownloadingItem(file);
    try {
      if (file.type === 'FOLDER') {
        await downloadFolder(file.id, file.name);
      } else {
        await downloadFile(file.id, file.name);
      }
      toast.success(`Downloaded "${file.name}"`);
    } catch (error) {
      console.error('Failed to download:', error);
      toast.error('Failed to download. Please try again.');
    } finally {
      setIsDownloading(false);
      setDownloadingItem(null);
    }
  };

  return (
    <div className='h-full flex flex-col'>
      {/* File Grid */}
      <div className='flex-1 overflow-auto p-4'>
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'>
          {files.map(file => {
            const isRenaming = renamingId === file.id;

            return (
              <div key={file.id} className='relative'>
                {isRenaming ? (
                  <div className='absolute inset-0 z-10 bg-white border-2 border-blue-500 rounded-lg p-2 shadow-lg'>
                    <input
                      ref={renameInputRef}
                      type='text'
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => void handleRenameSubmit(file.id)}
                      onKeyDown={e => handleRenameKeyDown(e, file.id)}
                      className='w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500'
                      onClick={e => e.stopPropagation()}
                      data-track-category='knowledge-base'
                      data-track-name='rename-input'
                    />
                    <p className='text-xs text-gray-500 mt-1'>Press Enter to save, Esc to cancel</p>
                  </div>
                ) : null}
                <GridCard
                  file={{
                    id: file.id,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    updatedAt: file.updatedAt,
                    status: file.uploadStatus,
                    mimeType: file.mimeType,
                    metadata: file.metadata,
                  }}
                  onClick={() => onFileClick(file)}
                  {...(canRename && { onRename: () => handleStartRename(file) })}
                  {...(canDelete && { onDelete: () => void handleDelete(file) })}
                  {...(canDownload && { onDownload: () => void handleDownload(file) })}
                  {...(canEdit &&
                    file.type === 'FILE' && { onReplace: () => setReplacingItem(file) })}
                  {...(file.type === 'FILE' && {
                    onVersionHistory: () => setVersionHistoryItem(file),
                  })}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Download Overlay */}
      <DownloadOverlay
        isOpen={isDownloading}
        itemName={downloadingItem?.name || ''}
        itemType={downloadingItem?.type === 'FOLDER' ? 'folder' : 'file'}
        onDismiss={() => {
          setIsDownloading(false);
          setDownloadingItem(null);
        }}
      />

      {/* Replace File Modal */}
      {replacingItem && (
        <ReplaceFileModal
          isOpen={!!replacingItem}
          onClose={() => setReplacingItem(null)}
          item={replacingItem}
          collectionId={collectionId ?? ''}
          onSuccess={() => setReplacingItem(null)}
        />
      )}

      {/* Version History Modal */}
      {versionHistoryItem && (
        <VersionHistoryModal
          isOpen={!!versionHistoryItem}
          onClose={() => setVersionHistoryItem(null)}
          item={versionHistoryItem}
          collectionRole={collectionRole}
          onSuccess={() => setVersionHistoryItem(null)}
        />
      )}
    </div>
  );
};
