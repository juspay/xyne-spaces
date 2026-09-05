import { ReactElement } from 'react';
import { toast } from 'sonner';
import { Globe, Link2, X } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button/Button';

interface ShareLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Entry name, shown in the dialog title ("Share <name>"). */
  title: string;
  /** Pre-built deep link to the entry. */
  link: string;
}

/**
 * Lightweight share dialog for individual files/folders — copy-link only, no
 * per-user access management. Folders/files have no ACL of their own; access
 * is entirely inherited from the owning collection (see buildEntryLink in
 * KnowledgeBaseV2Screen.tsx), so unlike ShareCollectionModal there's nothing
 * to grant here — just the link.
 */
export const ShareLinkModal = ({
  isOpen,
  onClose,
  title,
  link,
}: ShareLinkModalProps): ReactElement => {
  const handleCopyLink = (): void => {
    void navigator.clipboard.writeText(link).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy link'),
    );
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={`Share ${title}`}
      description={`Share a link to "${title}"`}
      className='max-w-md bg-popover border border-border'
    >
      <div className='p-6'>
        <div className='flex items-center justify-between mb-6'>
          <h2 className='text-lg font-semibold text-foreground truncate pr-4'>Share {title}</h2>
          <button
            onClick={onClose}
            className='p-1 hover:bg-muted rounded transition-colors flex-shrink-0'
            data-track-category='knowledge-base'
            data-track-name='close-share-link-modal'
          >
            <X size={20} className='text-muted-foreground' />
          </button>
        </div>

        <div className='mb-6'>
          <div className='block text-sm font-medium text-foreground mb-2'>General access</div>
          <div className='flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3'>
            <div className='flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border text-muted-foreground'>
              <Globe size={16} />
            </div>
            <div className='flex-1 min-w-0'>
              <div className='text-sm font-medium text-foreground'>Anyone with the link</div>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                Anyone with access to the collection this belongs to can open it via the link.
              </p>
            </div>
          </div>
        </div>

        <div className='flex items-center justify-between gap-3 border-t border-border pt-4'>
          <button
            type='button'
            onClick={handleCopyLink}
            data-track-category='knowledge-base'
            data-track-name='share-link-modal-copy'
            className='inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 -ml-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-primary'
          >
            <Link2 size={16} />
            Copy link
          </button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  );
};

export default ShareLinkModal;
