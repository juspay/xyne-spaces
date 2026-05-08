import React, { useState, useEffect } from 'react';
import { History, Download, RotateCcw, Loader2 } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import {
  CollectionChild,
  CollectionItemVersion,
  CollectionRole,
  getItemVersions,
  restoreItemVersion,
  downloadItemVersion,
} from '../../../services/Knowledge/collectionService';
import { formatFileSize } from '../../FileViewer/utils';
import { toast } from 'sonner';

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: CollectionChild;
  collectionRole: CollectionRole | undefined;
  onSuccess: () => void;
}

/**
 * Version History Modal
 * Displays all historical versions of a file and allows download or restore.
 */
export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  onClose,
  item,
  collectionRole,
  onSuccess,
}) => {
  const [versions, setVersions] = useState<CollectionItemVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null);

  const canRestore = collectionRole === 'EDITOR' || collectionRole === 'OWNER' || !collectionRole;

  useEffect(() => {
    if (!isOpen) return;

    setIsLoading(true);
    getItemVersions(item.id)
      .then(data => setVersions(data))
      .catch(() => toast.error('Failed to load version history'))
      .finally(() => setIsLoading(false));
  }, [isOpen, item.id]);

  const handleDownload = async (version: CollectionItemVersion): Promise<void> => {
    if (!version.id) return;
    setDownloadingVersionId(version.id);
    try {
      await downloadItemVersion(item.id, version.id, item.name);
    } catch {
      toast.error('Failed to download version');
    } finally {
      setDownloadingVersionId(null);
    }
  };

  const handleRestore = async (version: CollectionItemVersion): Promise<void> => {
    if (!version.id) return;
    if (
      !confirm(
        `Restore to version ${version.versionNumber}? The current version will be saved to history.`,
      )
    )
      return;

    setRestoringVersionId(version.id);
    try {
      await restoreItemVersion(item.id, version.id);
      toast.success(`Restored to version ${version.versionNumber}`);
      onSuccess();
    } catch {
      toast.error('Failed to restore version');
      setRestoringVersionId(null);
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={`Version History — ${item.name}`}
      className='max-w-lg'
    >
      <div className='flex flex-col'>
        {/* Header */}
        <div className='flex items-center gap-2 px-4 py-3 border-b border-gray-100'>
          <History size={16} className='text-gray-500 flex-shrink-0' />
          <span className='text-sm font-semibold text-gray-900 truncate'>
            Version History — {item.name}
          </span>
        </div>

        {isLoading ? (
          <div className='flex items-center justify-center py-12'>
            <Loader2 size={24} className='animate-spin text-gray-400' />
          </div>
        ) : versions.length === 0 ? (
          <div className='py-12 text-center text-sm text-gray-500'>
            No version history yet. Replace this file to start tracking versions.
          </div>
        ) : (
          <div className='divide-y divide-gray-100'>
            {versions.map(version => (
              <div
                key={version.isCurrent ? 'current' : version.id}
                className='flex items-center justify-between px-4 py-3 gap-4'
              >
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2'>
                    <span className='text-sm font-medium text-gray-900'>
                      v{version.versionNumber}
                    </span>
                    {version.isCurrent && (
                      <span className='text-xs font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded'>
                        current
                      </span>
                    )}
                    {version.restoredFromVersionId && (
                      <span className='text-xs text-gray-400'>(restored)</span>
                    )}
                  </div>
                  <div className='text-xs text-gray-500 mt-0.5'>
                    {formatDate(version.createdAt)}
                    {version.uploadedByEmail && (
                      <span className='ml-2'>· {version.uploadedByEmail}</span>
                    )}
                    {version.fileSize && (
                      <span className='ml-2'>· {formatFileSize(Number(version.fileSize))}</span>
                    )}
                  </div>
                </div>

                {!version.isCurrent && (
                  <div className='flex items-center gap-1 flex-shrink-0'>
                    <button
                      onClick={() => void handleDownload(version)}
                      disabled={downloadingVersionId === version.id}
                      title='Download this version'
                      className='p-1.5 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-50'
                      data-track-category='knowledge-base'
                      data-track-name='version-history-download'
                    >
                      {downloadingVersionId === version.id ? (
                        <Loader2 size={14} className='animate-spin' />
                      ) : (
                        <Download size={14} />
                      )}
                    </button>
                    {canRestore && (
                      <button
                        onClick={() => void handleRestore(version)}
                        disabled={restoringVersionId === version.id}
                        title='Restore to this version'
                        className='p-1.5 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-50'
                        data-track-category='knowledge-base'
                        data-track-name='version-history-restore'
                      >
                        {restoringVersionId === version.id ? (
                          <Loader2 size={14} className='animate-spin' />
                        ) : (
                          <RotateCcw size={14} />
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className='flex justify-end px-4 py-3 border-t border-gray-100'>
          <button
            onClick={onClose}
            className='px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50'
            data-track-category='knowledge-base'
            data-track-name='version-history-close'
          >
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
};
