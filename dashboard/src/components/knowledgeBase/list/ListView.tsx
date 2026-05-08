import React, { useState, useRef, useEffect } from 'react';
import { FileIcon } from '../shared/FileIcon';
import { UploadStatusBadge } from '../shared/UploadStatusBadge';
import { DownloadOverlay } from '../shared/DownloadOverlay';
import { EntityTagsEditor, ExtractedEntityTags } from '../shared/EntityTagsEditor';
import {
  CollectionChild,
  downloadFile,
  downloadFolder,
} from '../../../services/Knowledge/collectionService';
import { formatFileSize } from '../../FileViewer/utils';
import { MoreVertical, Download, Trash2, Pencil, RefreshCw, History } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import { useAuth } from '../../../hooks/useAuth';
import { useUser } from '../../../hooks/useUsers';
import { useCollectionTree } from '../context/CollectionTreeContext';
import { useProjectCollections } from '../context/ProjectCollectionsContext';
import { toast } from 'sonner';
import { ReplaceFileModal } from '../upload/ReplaceFileModal';
import { VersionHistoryModal } from '../upload/VersionHistoryModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

interface ListViewProps {
  files: CollectionChild[];
  onFileClick: (file: CollectionChild) => void;
}

/**
 * Owner Cell Component
 * Displays the owner's avatar and name, showing "me" if it's the current user
 */
const OwnerCell: React.FC<{ ownerId: string; currentUserId?: string | undefined }> = ({
  ownerId,
  currentUserId,
}) => {
  const owner = useUser(ownerId);
  const isCurrentUser = ownerId === currentUserId;
  const displayName = isCurrentUser ? 'me' : owner?.name || owner?.email || 'Unknown';

  return (
    <div className='flex items-center gap-2'>
      <Avatar userId={ownerId} size='sm' />
      <span className='text-sm text-gray-600'>{displayName}</span>
    </div>
  );
};

/**
 * List View Component
 * Displays files in a table format similar to Google Drive
 * Shows: Name (with icon), Date modified, File size
 */
export const ListView: React.FC<ListViewProps> = ({ files, onFileClick }) => {
  const { user } = useAuth();
  const { renameNode, deleteNode, collectionRole } = useCollectionTree();
  const { activeCollection } = useProjectCollections();

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

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      // Use setTimeout to ensure the input is rendered before focusing
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
    }
  }, [renamingId]);

  // Format date similar to Google Drive
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    // Compare calendar days (strip time) to avoid showing "Today" for yesterday's files
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((nowOnly.getTime() - dateOnly.getTime()) / (1000 * 60 * 60 * 24));

    // Format like Google Drive: "May 22, 2025" or "Today", "Yesterday"
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';

    // For dates within the same year, show "MMM DD" (e.g., "May 22")
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // For dates in different years, show "MMM DD, YYYY" (e.g., "May 22, 2024")
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className='h-full flex flex-col bg-white'>
      {/* Table Header */}
      <div className='border-b border-gray-200 bg-gray-50'>
        <div className='grid grid-cols-[minmax(200px,1fr)_180px_200px_120px_160px_40px] gap-4 px-4 py-2 text-xs font-medium text-gray-600 uppercase tracking-wider'>
          <div className='flex items-center'>
            <span>Name</span>
          </div>
          <div className='flex items-center'>
            <span>Owner</span>
          </div>
          <div className='flex items-center'>
            <span>Date modified</span>
          </div>
          <div className='flex items-center'>
            <span>File size</span>
          </div>
          <div className='flex items-center'>
            <span>Tags</span>
          </div>
          <div></div>
        </div>
      </div>

      {/* Table Body */}
      <div className='flex-1 overflow-auto'>
        <div className='divide-y divide-gray-100'>
          {files.map(file => {
            const isRenaming = renamingId === file.id;

            return (
              <div
                key={file.id}
                className='grid grid-cols-[minmax(200px,1fr)_180px_200px_120px_160px_40px] gap-4 px-4 py-2 hover:bg-blue-50 cursor-pointer group items-center select-none'
                onDoubleClick={() => onFileClick(file)}
              >
                {/* Name Column */}
                <div className='flex items-center gap-3 min-w-0'>
                  <div className='flex-shrink-0'>
                    <FileIcon
                      nodeType={file.type}
                      mimeType={file.mimeType}
                      variant='tree'
                      size={20}
                    />
                  </div>
                  <div className='flex items-center gap-2 min-w-0 flex-1'>
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        type='text'
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => void handleRenameSubmit(file.id)}
                        onKeyDown={e => handleRenameKeyDown(e, file.id)}
                        onClick={e => e.stopPropagation()}
                        data-track-category='knowledge-base'
                        data-track-name='rename-input'
                        className='flex-1 min-w-0 px-1 py-0.5 text-sm border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white'
                        style={{ minWidth: '100px', maxWidth: '200px' }}
                      />
                    ) : (
                      <>
                        <span className='text-sm text-gray-900 truncate'>{file.name}</span>
                        <UploadStatusBadge status={file.uploadStatus} variant='compact' />
                      </>
                    )}
                  </div>
                </div>

                {/* Owner Column */}
                {activeCollection?.ownerId ? (
                  <OwnerCell
                    ownerId={activeCollection.ownerId}
                    currentUserId={user?.id || undefined}
                  />
                ) : (
                  <div className='flex items-center gap-2'>
                    <span className='text-sm text-gray-400'>-</span>
                  </div>
                )}

                {/* Date Modified Column */}
                <div className='text-sm text-gray-600'>{formatDate(file.updatedAt)}</div>

                {/* File Size Column */}
                <div className='text-sm text-gray-600'>
                  {file.type === 'FOLDER' ? '-' : formatFileSize(file.size)}
                </div>

                {/* Tags Column */}
                <div
                  className='flex flex-wrap gap-1'
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => e.stopPropagation()}
                  role='presentation'
                  data-track-category='knowledge-base'
                  data-track-name='tags-container'
                >
                  <EntityTagsEditor
                    itemId={file.id}
                    entityTags={file.metadata?.['entityTags'] as ExtractedEntityTags | undefined}
                    readOnly={file.type !== 'FILE'}
                  />
                </div>

                {/* Actions Column */}
                <div className='flex items-center justify-end'>
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
                        className='p-2 rounded-full hover:bg-blue-100 transition-colors'
                        aria-label='File options'
                        data-track-category='knowledge-base'
                        data-track-name='file-options'
                      >
                        <MoreVertical size={16} className='text-gray-500' />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end' className='w-40'>
                      <DropdownMenuItem
                        onClick={e => {
                          e.stopPropagation();
                          if (canDownload) {
                            void handleDownload(file);
                          }
                        }}
                        className='flex items-center gap-2 cursor-pointer'
                        disabled={!canDownload}
                      >
                        <Download size={14} className='text-gray-500' />
                        Download
                      </DropdownMenuItem>
                      {file.type === 'FILE' && (
                        <>
                          <DropdownMenuItem
                            onClick={e => {
                              e.stopPropagation();
                              if (canEdit) setReplacingItem(file);
                            }}
                            className='flex items-center gap-2 cursor-pointer'
                            disabled={!canEdit}
                          >
                            <RefreshCw size={14} className='text-gray-500' />
                            Replace
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={e => {
                              e.stopPropagation();
                              setVersionHistoryItem(file);
                            }}
                            className='flex items-center gap-2 cursor-pointer'
                          >
                            <History size={14} className='text-gray-500' />
                            Version History
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuItem
                        onClick={e => {
                          e.stopPropagation();
                          handleStartRename(file);
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
                            void handleDelete(file);
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
                </div>
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
          collectionId={activeCollection?.id ?? ''}
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
