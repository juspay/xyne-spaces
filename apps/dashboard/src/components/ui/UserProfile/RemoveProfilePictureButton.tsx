import { ReactElement, useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Popover } from '../Popover/Popover';
import { Button } from '../Button/Button';
import { cn } from '../../../utils/classNames';
import { useSelf } from '../../../hooks/useUsers';
import { removeProfilePicture } from '../../../services/userProfile/userProfileService';

/**
 * Small ✕ badge on the current user's avatar that asks for confirmation before
 * removing their profile picture. Renders nothing when there is no picture.
 * Place it inside a `relative group` container around the avatar.
 */
export const RemoveProfilePictureButton = ({
  disabled,
  className,
}: {
  disabled?: boolean;
  className?: string;
}): ReactElement | null => {
  const user = useSelf();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  if (!user?.picture) return null;

  const isDisabled = disabled || isRemoving;

  // Popover content renders in a portal, but React events still bubble to the
  // avatar's click handler (which opens the file picker), so stop them here.
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation();

  const handleRemove = async (): Promise<void> => {
    setOpen(false);
    setIsRemoving(true);
    try {
      await removeProfilePicture();
      void queryClient.invalidateQueries({
        queryKey: ['user', user.id],
        exact: false,
      });
    } catch {
      // Error is already handled by toast in the service
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side='bottom'
      align='end'
      alignOffset={-8}
      sideOffset={8}
      showArrow
      className='w-64 p-3'
      trigger={
        <button
          type='button'
          aria-label='Remove profile picture'
          onClick={stop}
          onKeyDown={stop}
          disabled={isDisabled}
          className={cn(
            'absolute top-1 right-1 z-10 flex size-6 items-center justify-center rounded-full',
            'border border-border/60 bg-background/90 backdrop-blur-sm text-muted-foreground shadow-sm',
            'hover:bg-destructive hover:text-white hover:border-destructive transition-all',
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
            open && 'opacity-100',
            className,
          )}
          data-track-category='USER_PROFILE'
          data-track-name='REMOVE_PROFILE_PICTURE_OPEN'
        >
          <X className='size-3.5' />
        </button>
      }
    >
      <div onClick={stop} onKeyDown={stop} role='presentation'>
        <p className='text-sm font-medium text-foreground'>Remove profile picture?</p>
        <p className='mt-1 text-xs text-muted-foreground'>
          Your initials will be shown instead. You can upload a new picture anytime.
        </p>
        <div className='mt-3 flex justify-end gap-2'>
          <Button variant='ghost' size='sm' onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            size='sm'
            disabled={isDisabled}
            onClick={() => {
              void handleRemove();
            }}
            data-track-category='USER_PROFILE'
            data-track-name='REMOVE_PROFILE_PICTURE_CONFIRM'
          >
            Remove
          </Button>
        </div>
      </div>
    </Popover>
  );
};
