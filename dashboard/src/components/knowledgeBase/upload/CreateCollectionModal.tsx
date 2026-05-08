import { ReactElement, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Upload, X } from 'lucide-react';
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

interface CreateCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onSuccess: (collection: CollectionSummary) => void;
}

const CreateCollectionModal = ({
  isOpen,
  onClose,
  projectId,
  onSuccess,
}: CreateCollectionModalProps): ReactElement => {
  const { user } = useAuth();
  const zero = useZero();
  const { initUpload, createProgressCallback, completeUpload, handleError } = useUploadHandler();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isBdTeam, setIsBdTeam] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // BD Team validation: at least 1 CSV + at least 1 PDF
  const csvCount = files.filter(f => f.name.toLowerCase().endsWith('.csv')).length;
  const pdfCount = files.filter(f => f.name.toLowerCase().endsWith('.pdf')).length;
  const bdTeamValid = !isBdTeam || (csvCount >= 1 && pdfCount >= 1);

  const resetForm = useCallback(() => {
    setTitle('');
    setDescription('');
    setFiles([]);
    setIsCreating(false);
    setIsBdTeam(false);
    setNameError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (isCreating) return; // don't close while the create API is in-flight
    resetForm();
    onClose();
  }, [isCreating, onClose, resetForm]);

  const handleCreateCollection = useCallback(async () => {
    if (!title.trim() || files.length === 0) return;

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
          projectId,
          name: title.trim(),
          description: description || null,
          vespaDocId: crypto.randomUUID(),
          permissionId: crypto.randomUUID(),
          timestamp,
        }),
      ).server;

      if (serverRes.type === 'error') {
        setIsCreating(false);
        const msg = serverRes.error.message || '';
        if (msg.includes('already exists')) {
          setNameError(msg);
        } else {
          toast.error(msg || 'Failed to create collection. Please try again.');
        }
        return;
      }

      const collection: CollectionSummary = {
        id,
        name: title.trim(),
        description: description || null,
        ownerId: user.id,
        canShare: true,
        role: CollectionRole.OWNER,
      };

      // ── Step 2: Capture file list, notify parent, close modal ─
      // `files` is captured in this closure; resetForm() only
      // schedules a state update and won't affect the current ref.
      const filesToUpload = files;
      const collectionName = title.trim();

      resetForm();
      onSuccess(collection);
      onClose();

      // ── Step 3: Upload files in the background ───────────────
      // The modal may already be unmounted at this point.
      // The global overlay tracks progress via the zustand store.
      if (filesToUpload.length > 0) {
        const { uploadId, sessionId, batches } = initUpload(
          collection.id,
          collectionName,
          filesToUpload,
        );
        const progressCallback = createProgressCallback(uploadId, filesToUpload, batches);

        // Fire-and-forget — completeUpload / handleError update the store
        uploadFilesInBatches(
          collection.id,
          filesToUpload,
          null, // root
          'rename',
          progressCallback,
          sessionId,
          isBdTeam,
        )
          .then(result => {
            // Use custom message for BD team uploads
            const customMessage = isBdTeam ? 'Pitch Deck Uploaded' : undefined;
            completeUpload(
              uploadId,
              {
                totalUploaded: result.totalUploaded,
                totalSkipped: result.totalSkipped,
                totalFailed: result.totalFailed,
              },
              customMessage,
            );
          })
          .catch((err: unknown) => handleError(uploadId, err));
      }
    } catch (error) {
      // Collection creation itself failed — stay in the modal
      setIsCreating(false);
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('already exists')) {
        setNameError(msg);
      } else {
        toast.error(msg || 'Failed to create collection. Please try again.');
      }
    }
  }, [
    zero,
    title,
    files,
    projectId,
    description,
    user,
    onSuccess,
    onClose,
    resetForm,
    initUpload,
    createProgressCallback,
    completeUpload,
    handleError,
    isBdTeam,
  ]);

  const canSubmit = title.trim().length > 0 && files.length > 0 && !isCreating && bdTeamValid;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
      title='Create New Collection'
      description='Upload files to create a new knowledge collection'
      className='max-w-2xl'
    >
      <div className='p-6'>
        {/* Header */}
        <div className='flex items-center justify-between mb-6'>
          <h2 className='text-sm font-semibold text-gray-500 uppercase tracking-wider'>
            Create New Collection
          </h2>
          <button
            onClick={handleClose}
            data-track-category='knowledge-base'
            data-track-name='close-modal'
            className='p-1 hover:bg-gray-100 rounded transition-colors'
          >
            <X size={20} className='text-gray-500' />
          </button>
        </div>

        {/* Collection Form */}
        <CollectionForm
          title={title}
          description={description}
          files={files}
          onTitleChange={v => {
            setTitle(v);
            setNameError(null);
          }}
          onDescriptionChange={setDescription}
          onFilesChange={setFiles}
          disabled={isCreating}
          nameError={nameError ?? undefined}
        />

        {/* Upload Pitch Deck Toggle */}
        <div className='flex items-center justify-between mt-4'>
          <button
            onClick={() => !isCreating && setIsBdTeam(!isBdTeam)}
            disabled={isCreating}
            data-track-category='knowledge-base'
            data-track-name='toggle-pitch-deck'
            className={`px-4 py-2.5 rounded-lg font-medium text-sm transition-all ${
              isBdTeam
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            } ${isCreating ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Upload Pitch Deck (Slide DeepLinking)
          </button>
          {isBdTeam && !bdTeamValid && files.length > 0 && (
            <p className='text-xs text-red-500'>Requires at least 1 CSV and at least 1 PDF</p>
          )}
        </div>

        {/* Submit Button */}
        <div className='flex justify-end gap-2 mt-4'>
          <Button
            disabled={!canSubmit}
            loading={isCreating}
            onClick={() => {
              void handleCreateCollection();
            }}
            className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
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
