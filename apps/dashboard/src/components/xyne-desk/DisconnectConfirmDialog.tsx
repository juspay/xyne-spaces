import { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import Button from '../ui/Button';

interface DisconnectConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Question shown above the consequence list, e.g. "Disconnect Acme from this desk?". */
  prompt: string;
  /** What disconnecting costs, one clause per bullet. */
  bullets: string[];
  /** Drives the button label and disables both actions while the request is in flight. */
  isPending: boolean;
  onConfirm: () => void;
  trackCategory: string;
}

/**
 * Shared confirm step for disconnecting a desk integration.
 *
 * Used by DeskConnectionCard (one connection per desk: Slack, social) and by
 * ConnectedAppsSection (N apps per desk). Those two differ in layout and in how
 * they track pending state, so they do not share a card — but the consequences of
 * disconnecting read the same either way, and this keeps that wording in one place.
 */
export const DisconnectConfirmDialog = ({
  open,
  onOpenChange,
  title,
  prompt,
  bullets,
  isPending,
  onConfirm,
  trackCategory,
}: DisconnectConfirmDialogProps): ReactElement => (
  <Dialog open={open} onOpenChange={onOpenChange} title={title}>
    <div className='p-5 flex flex-col gap-3'>
      <div className='flex gap-3'>
        <AlertTriangle size={18} className='flex-shrink-0 text-amber-500 mt-0.5' />
        <div className='flex flex-col gap-2 text-sm'>
          <p className='text-foreground'>{prompt}</p>
          <ul className='text-muted-foreground list-disc pl-4 space-y-1 text-xs'>
            {bullets.map(bullet => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className='flex justify-end gap-2 pt-2'>
        <Button
          variant='secondary'
          size='sm'
          onClick={() => onOpenChange(false)}
          disabled={isPending}
          data-track-category='desk-integration'
          data-track-name='CANCEL_DISCONNECT'
        >
          Cancel
        </Button>
        <Button
          variant='destructive'
          size='sm'
          trackId='desk_disconnect_integration'
          trackAction={onConfirm}
          disabled={isPending}
          data-track-category={trackCategory}
          data-track-name='confirm-disconnect'
        >
          {isPending ? 'Disconnecting…' : 'Disconnect'}
        </Button>
      </div>
    </div>
  </Dialog>
);
