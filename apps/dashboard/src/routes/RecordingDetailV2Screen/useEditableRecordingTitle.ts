import { useEffect, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { recordingService } from '../../services/Recording/recordingService';
import { logRecordingError, resolveRecordingTitle } from '../../utils/recordingUtils';

export interface UseEditableRecordingTitleOptions {
  recordingId: string | null;
  title: string | null | undefined;
  onTitleUpdated?: ((title: string) => void) | undefined;
  disabled?: boolean;
  /** Log-context prefix, e.g. 'RecordingDetailV2Header'. */
  context: string;
}

export interface UseEditableRecordingTitleResult {
  currentTitle: string;
  isEditingTitle: boolean;
  editedTitle: string;
  isSavingTitle: boolean;
  handleStartEdit: () => void;
  handleCancelEdit: () => void;
  handleSaveTitle: () => Promise<void>;
  handleTitleChange: (value: string) => void;
  handleTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export const useEditableRecordingTitle = ({
  recordingId,
  title,
  onTitleUpdated,
  disabled = false,
  context,
}: UseEditableRecordingTitleOptions): UseEditableRecordingTitleResult => {
  const currentTitle = resolveRecordingTitle(title);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(currentTitle);
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  useEffect(() => {
    if (isEditingTitle) return;
    setEditedTitle(currentTitle);
  }, [currentTitle, isEditingTitle]);

  const handleStartEdit = (): void => {
    if (isEditingTitle || isSavingTitle || disabled) return;
    setEditedTitle(currentTitle);
    setIsEditingTitle(true);
  };

  const handleCancelEdit = (): void => {
    if (isSavingTitle) return;
    setEditedTitle(currentTitle);
    setIsEditingTitle(false);
  };

  const handleSaveTitle = async (): Promise<void> => {
    if (isSavingTitle) return;

    if (!recordingId) {
      setEditedTitle(currentTitle);
      setIsEditingTitle(false);
      toast.error('Failed to update title');
      logRecordingError(`${context}.updateTitle`, new Error('Missing recordingId'));
      return;
    }

    const trimmed = editedTitle.trim();
    if (!trimmed) {
      setEditedTitle(currentTitle);
      setIsEditingTitle(false);
      toast.error('Title cannot be empty');
      return;
    }

    if (trimmed === currentTitle) {
      setIsEditingTitle(false);
      return;
    }

    setIsSavingTitle(true);
    try {
      await recordingService.updateRecordingTitle(recordingId, trimmed);
      onTitleUpdated?.(trimmed);
      toast.success('Title updated');
    } catch (err) {
      logRecordingError(`${context}.updateTitle`, err);
      toast.error('Failed to update title');
      setEditedTitle(currentTitle);
    } finally {
      setIsSavingTitle(false);
      setIsEditingTitle(false);
    }
  };

  const handleTitleChange = (value: string): void => setEditedTitle(value);

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelEdit();
    }
  };

  return {
    currentTitle,
    isEditingTitle,
    editedTitle,
    isSavingTitle,
    handleStartEdit,
    handleCancelEdit,
    handleSaveTitle,
    handleTitleChange,
    handleTitleKeyDown,
  };
};
