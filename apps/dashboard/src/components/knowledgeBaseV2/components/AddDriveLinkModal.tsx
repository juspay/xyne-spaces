import { useState, type ReactElement } from 'react';
import { Link2 } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import { runDriveImport } from '../utils/driveImport';

interface AddDriveLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  collectionId: string | null;
  /** Collection name for the progress card label. */
  collectionName?: string;
  /** Current folder to import into; null = collection root. */
  parentId: string | null;
}

function isDriveUrl(value: string): boolean {
  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    return host === 'drive.google.com' || host === 'docs.google.com';
  } catch {
    return false;
  }
}

export const AddDriveLinkModal = ({
  isOpen,
  onClose,
  collectionId,
  collectionName,
  parentId,
}: AddDriveLinkModalProps): ReactElement => {
  const [url, setUrl] = useState('');
  const valid = isDriveUrl(url);

  const handleClose = (): void => {
    setUrl('');
    onClose();
  };

  const handleSubmit = (): void => {
    if (!collectionId || !valid) return;
    // Behaves like an upload: close immediately, progress lives in the card. A
    // private link surfaces a "Connect Google Drive" prompt from runDriveImport.
    const link = url.trim();
    handleClose();
    runDriveImport({
      collectionId,
      collectionName: collectionName ?? 'Collection',
      parentId,
      link,
    });
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
      title='Add from Google Drive link'
      description="Paste a Google Drive file or folder link. You'll connect your Google Drive the first time so files can be imported as you — public, private, and Google Docs, Sheets and Slides are all supported."
      className='max-w-md bg-secondary border border-border'
    >
      <form
        className='p-4'
        onSubmit={event => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <div className='space-y-3'>
          <div>
            <label
              className='mb-1 block text-sm font-medium text-foreground'
              htmlFor='kb-drive-link'
            >
              Drive link
            </label>
            <Input
              id='kb-drive-link'
              type='text'
              value={url}
              onChange={event => setUrl(event.target.value)}
              placeholder='https://drive.google.com/file/d/…'
              data-track-category='knowledge-base'
              data-track-name='drive-link-input'
            />
            {url && !valid ? (
              <p className='mt-1 text-xs text-red-500'>
                Enter a valid drive.google.com or docs.google.com link.
              </p>
            ) : null}
          </div>
        </div>

        <div className='mt-4 flex items-center justify-end gap-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={handleClose}
            data-track-category='knowledge-base'
            data-track-name='drive-link-cancel'
          >
            Cancel
          </Button>
          <Button
            type='submit'
            disabled={!valid || !collectionId}
            data-track-category='knowledge-base'
            data-track-name='drive-link-import'
          >
            <Link2 size={16} />
            Import
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
