import React, { useState, useRef, useEffect } from 'react';
import { FileIcon } from '../shared/FileIcon';
import { IngestionStatusBadge } from '../shared/UploadStatusBadge';
import { DownloadOverlay } from '../shared/DownloadOverlay';
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
import { formatFileBrowserDate } from '../../../utils/dateUtils';
import { useCollectionMutations } from '../hooks/useCollectionMutations';
import { useProjectCollections } from '../hooks/useProjectCollections';
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

export const ListView: React.FC<ListViewProps> = ({ files, onFileClick }) => {
  const { user } = useAuth();
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
  const canEdit = !collectionRole || collectionRole === 'EDITOR' || collectionRole === 'OWNER';

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingItem, setDownloadingItem] = useState<CollectionChild | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [replacingItem, setReplacingItem] = useState<CollectionChild | null>(null);
  const [versionHistoryItem, setVersionHistoryItem] = useState<CollectionChild | null>(null);

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

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
    }
  }, [renamingId]);

  return (
    <div className='h-full flex flex-col bg-white'>
      <div className='border-b border-gray-200 bg-gray-50'>
        <div className='grid grid-cols-[minmax(200px,1fr)_180px_200px_120px_40px] gap-4 px-4 py-2 text-xs font-medium text-gray-600 uppercase tracking-wider'>
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
          <div></div>
        </div>
      </div>

      <div className='flex-1 overflow-auto'>
        <div className='divide-y divide-gray-100'>
          {files.map(file => {
            const isRenaming = renamingId === file.id;

            return (
              <div
                key={file.id}
                className='grid grid-cols-[minmax(200px,1fr)_180px_200px_120px_40px] gap-4 px-4 py-2 hover:bg-blue-50 cursor-pointer group items-center select-none'
                onDoubleClick={() => onFileClick(file)}
              >
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
                        <IngestionStatusBadge status={file.ingestionStatus} variant='compact' />
                      </>
                    )}
                  </div>
                </div>

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

                <div className='text-sm text-gray-600'>
                  {formatFileBrowserDate(new Date(file.updatedAt))}
                </div>

                <div className='text-sm text-gray-600'>
                  {file.type === 'FOLDER' ? '-' : formatFileSize(file.size)}
                </div>

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

      <DownloadOverlay
        isOpen={isDownloading}
        itemName={downloadingItem?.name || ''}
        itemType={downloadingItem?.type === 'FOLDER' ? 'folder' : 'file'}
        onDismiss={() => {
          setIsDownloading(false);
          setDownloadingItem(null);
        }}
      />

      {replacingItem && (
        <ReplaceFileModal
          isOpen={!!replacingItem}
          onClose={() => setReplacingItem(null)}
          item={replacingItem}
          collectionId={activeCollection?.id ?? ''}
          onSuccess={() => setReplacingItem(null)}
        />
      )}

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
