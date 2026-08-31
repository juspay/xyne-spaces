import { Copy, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { DropdownMenuItem } from '../../ui/dropdown-menu';
import { type Call } from '../../../routes/CallHistoryScreen/callHistoryItem.utils';

interface UpcomingCallActionsMenuItemsProps {
  call: Call;
  isOwner: boolean;
  onEdit?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
}

/**
 * Shared dropdown items for an upcoming-call action menu: Copy Link, Edit Call, Delete Call.
 * Caller wraps in <DropdownMenu>/<DropdownMenuTrigger>/<DropdownMenuContent> to control
 * trigger styling and content alignment.
 */
export function UpcomingCallActionsMenuItems({
  call,
  isOwner,
  onEdit,
  onCancel,
}: UpcomingCallActionsMenuItemsProps): React.JSX.Element {
  const handleCopyLink = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!call.roomLink) {
      toast.error('No link available');
      return;
    }
    copyTextToClipboard(call.roomLink)
      .then(() => toast.success('Link copied to clipboard'))
      .catch(() => toast.error('Failed to copy link'));
  };

  return (
    <>
      <DropdownMenuItem
        onClick={handleCopyLink}
        data-track-category='calls'
        data-track-name='COPY_UPCOMING_CALL_LINK'
        className='flex items-center gap-2 text-sm font-medium rounded-lg'
      >
        <Copy className='size-4' />
        Copy Link
      </DropdownMenuItem>
      {isOwner && onEdit && (
        <DropdownMenuItem
          onClick={e => {
            e.stopPropagation();
            onEdit();
          }}
          data-track-category='calls'
          data-track-name='EDIT_UPCOMING_CALL'
          className='flex items-center gap-2 text-sm font-medium rounded-lg'
        >
          <Pencil className='size-4' strokeWidth={2.2} />
          Edit Call
        </DropdownMenuItem>
      )}
      {isOwner && onCancel && (
        <DropdownMenuItem
          onClick={e => {
            e.stopPropagation();
            onCancel();
          }}
          data-track-category='calls'
          data-track-name='CANCEL_UPCOMING_CALL'
          className='flex items-center gap-2 text-sm font-medium text-destructive focus:text-destructive rounded-lg'
        >
          <Trash2 className='size-4' strokeWidth={2.2} />
          Delete Call
        </DropdownMenuItem>
      )}
    </>
  );
}
