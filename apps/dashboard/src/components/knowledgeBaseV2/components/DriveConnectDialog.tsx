import { type ReactElement } from 'react';
import { HardDriveDownload } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button/Button';
import { useDriveConnectStore, startDriveConnect } from '../utils/driveImport';

/**
 * Centered permission dialog shown when a Drive import needs access. Framed as a
 * consent request (not an error): clicking Connect sends the user to Google's
 * read-only Drive consent, then returns here and resumes the import automatically.
 * Mount once (in the KB screen); it's driven imperatively via useDriveConnectStore.
 */
export const DriveConnectDialog = (): ReactElement => {
  const isOpen = useDriveConnectStore(s => s.isOpen);
  const pending = useDriveConnectStore(s => s.pending);
  const close = useDriveConnectStore(s => s.close);

  const handleConnect = (): void => {
    if (pending) void startDriveConnect(pending); // navigates the tab to Google
    close();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) close();
      }}
      title='Grant access to Drive'
      description='To import this file, allow Xyne read-only access to your Google Drive. You’ll approve it on Google’s screen — no password and no re-login.'
      className='max-w-md bg-secondary border border-border'
    >
      <div className='p-4'>
        <div className='mb-4 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3'>
          <HardDriveDownload className='mt-0.5 shrink-0 text-muted-foreground' size={18} />
          <p className='text-sm text-muted-foreground'>
            Xyne will read the file(s) from your Drive as you, then import them into this
            collection. Access is read-only and you can revoke it anytime in your Google Account.
          </p>
        </div>
        <div className='flex items-center justify-end gap-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={close}
            data-track-category='knowledge-base'
            data-track-name='drive-connect-cancel'
          >
            Cancel
          </Button>
          <Button
            type='button'
            onClick={handleConnect}
            disabled={!pending}
            data-track-category='knowledge-base'
            data-track-name='drive-connect'
          >
            <HardDriveDownload size={16} />
            Grant access to Drive
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
