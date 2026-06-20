import { ReactElement, useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Upload, ChevronDown } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button/Button';
import { CollectionForm } from './CollectionForm';
import { useAuth } from '../../../hooks/useAuth';
import {
  uploadFilesInBatches,
  CollectionSummary,
} from '../../../services/Knowledge/collectionService';
import { CollectionRole } from '@xyne/shared';
import { useUploadHandler } from './useUploadHandler';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

interface ChannelOption {
  id: string;
  name: string;
}

interface CreateCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  scopeType: string;
  scopeId?: string;
  channels: ChannelOption[];
  onSuccess: (collection: CollectionSummary) => void;
  /** If true, only allow folder selection. If false, allow both files and folders. */
  folderOnly?: boolean;
}

const extractFolderName = (files: File[]): string => {
  const file = files[0];
  if (!file) return '';
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
  if (relativePath) {
    const parts = relativePath.split('/');
    if (parts.length > 1) {
      return parts[0] ?? '';
    }
  }
  // Fallback: use the first file's name without extension
  const name = file.name;
  const dotIdx = name.lastIndexOf('.');
  return dotIdx > 0 ? name.slice(0, dotIdx) : name;
};

const CreateCollectionModal = ({
  isOpen,
  onClose,
  scopeType,
  scopeId: initialScopeId,
  channels,
  onSuccess,
  folderOnly = false,
}: CreateCollectionModalProps): ReactElement => {
  const { user } = useAuth();
  const zero = useZero();
  const { initUpload, createProgressCallback, completeUpload, handleError } = useUploadHandler();

  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(initialScopeId ?? null);

  const effectiveScopeId = selectedChannelId;

  const resetForm = useCallback(() => {
    setTitle('');
    setFiles([]);
    setIsPrivate(false);
    setIsCreating(false);
    setSelectedChannelId(initialScopeId ?? null);
  }, [initialScopeId]);

  const handleClose = useCallback(() => {
    if (isCreating) return;
    resetForm();
    onClose();
  }, [isCreating, onClose, resetForm]);

  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen, resetForm]);

  useEffect(() => {
    if (files.length > 0) {
      const derivedName = extractFolderName(files);
      if (derivedName) {
        setTitle(derivedName);
      }
    }
  }, [files]);

  const handleCreateCollection = useCallback(async () => {
    const finalTitle = title.trim() || extractFolderName(files);
    if (!finalTitle || files.length === 0) return;
    if (!effectiveScopeId) {
      toast.error('Please select a channel');
      return;
    }
    if (!user) {
      toast.error('You must be logged in to create a collection');
      return;
    }

    setIsCreating(true);

    try {
      const id = crypto.randomUUID();
      const timestamp = Date.now();
      const serverRes = await zero.mutate(
        mutators.collection.createCollection({
          id,
          scopeType,
          scopeId: effectiveScopeId,
          name: finalTitle,
          description: null,
          isPrivate,
          permissionId: crypto.randomUUID(),
          timestamp,
        }),
      ).server;

      if (serverRes.type === 'error') {
        setIsCreating(false);
        const msg = serverRes.error.message || '';
        if (msg.includes('already exists')) {
          toast.error(msg);
        } else {
          toast.error(msg || 'Failed to create collection. Please try again.');
        }
        return;
      }

      const collection: CollectionSummary = {
        id,
        name: finalTitle,
        description: null,
        ownerId: user.id,
        canShare: true,
        role: CollectionRole.OWNER,
      };

      const filesToUpload = files;
      const collectionName = finalTitle;

      resetForm();
      onSuccess(collection);
      onClose();

      if (filesToUpload.length > 0) {
        const { uploadId, sessionId, batches } = initUpload(
          collection.id,
          collectionName,
          filesToUpload,
        );
        const progressCallback = createProgressCallback(uploadId, filesToUpload, batches);

        uploadFilesInBatches(
          collection.id,
          filesToUpload,
          null,
          'rename',
          progressCallback,
          sessionId,
          true,
        )
          .then(result => {
            completeUpload(uploadId, {
              totalUploaded: result.totalUploaded,
              totalSkipped: result.totalSkipped,
              totalFailed: result.totalFailed,
            });
          })
          .catch((err: unknown) => handleError(uploadId, err));
      }
    } catch (error) {
      setIsCreating(false);
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('already exists')) {
        toast.error(msg);
      } else {
        toast.error(msg || 'Failed to create collection. Please try again.');
      }
    }
  }, [
    zero,
    title,
    files,
    scopeType,
    effectiveScopeId,
    isPrivate,
    user,
    onSuccess,
    onClose,
    resetForm,
    initUpload,
    createProgressCallback,
    completeUpload,
    handleError,
  ]);

  const canSubmit = files.length > 0 && !!effectiveScopeId && !isCreating;
  const selectedChannelName =
    channels.find(c => c.id === selectedChannelId)?.name ?? 'Select channel';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
      title='Upload Collection'
      description={
        folderOnly
          ? 'Select a folder to create a new collection'
          : 'Upload files or a folder to create a new collection'
      }
      className='max-w-md bg-secondary border border-border'
    >
      <div className='p-4'>
        {/* Channel selector (only if no initialScopeId provided) */}
        {!initialScopeId && (
          <div className='mb-3'>
            <label
              htmlFor='create-collection-channel-trigger'
              className='block text-sm font-medium text-foreground mb-1'
            >
              Channel
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  id='create-collection-channel-trigger'
                  type='button'
                  className='inline-flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-3 text-sm text-foreground transition hover:bg-muted'
                >
                  <span className='truncate'>{selectedChannelName}</span>
                  <ChevronDown className='h-4 w-4 ml-2 shrink-0' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='start'
                className='w-[--radix-dropdown-menu-trigger-width]'
              >
                {channels.length === 0 ? (
                  <DropdownMenuItem disabled>No channels available</DropdownMenuItem>
                ) : (
                  channels.map(ch => (
                    <DropdownMenuItem key={ch.id} onClick={() => setSelectedChannelId(ch.id)}>
                      <span className='truncate'>{ch.name}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Collection Form */}
        <CollectionForm
          files={files}
          isPrivate={isPrivate}
          onFilesChange={setFiles}
          onIsPrivateChange={setIsPrivate}
          disabled={isCreating}
          folderOnly={folderOnly}
        />

        {/* Title preview */}
        {title && (
          <div className='mt-2 text-xs text-muted-foreground'>
            Collection name: <span className='font-medium text-foreground'>{title}</span>
          </div>
        )}

        {/* Submit Button */}
        <div className='flex justify-end gap-2 mt-3'>
          <Button
            disabled={!canSubmit}
            loading={isCreating}
            onClick={() => {
              void handleCreateCollection();
            }}
            className='px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            <Upload size={16} />
            Create Collection
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default CreateCollectionModal;
