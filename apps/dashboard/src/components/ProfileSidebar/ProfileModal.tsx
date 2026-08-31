import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Dialog } from '../ui/Dialog/Dialog';
import { Button } from '../ui/Button/Button';
import UserProfile from '../ui/UserProfile/UserProfile';
import { useUser } from '../../hooks/useUsers';
import { useAuthContextValues } from '../../hooks/useAuth';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { usePath } from '../../hooks/usePath';

interface ProfileModalProps {
  /** The user whose profile to show. When null the modal stays closed. */
  userId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * ProfileModal renders the same {@link UserProfile} content as the routed
 * ProfileSidebar, but inside a modal dialog instead of a nested `/chat/dir`
 * route. It is used on non-chat surfaces (e.g. /support, /automations, /calls)
 * where the routed profile sidebar is not mounted, so the account-menu
 * "Profile" action has somewhere to open without bouncing the user into chat.
 */
export const ProfileModal: React.FC<ProfileModalProps> = ({ userId, isOpen, onClose }) => {
  const context = useAuthContextValues();
  const user = useUser(userId || '');
  const [userProfile] = useCachedQuery(queries.getUserProfile({ userId: userId || '' }), {
    enabled: !!userId,
  });

  // Close the modal when the route changes. Profile actions such as "Message"
  // or "Call" navigate away (into chat); once that happens the modal should not
  // linger on top of the new page.
  const path = usePath();
  const initialPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      initialPathRef.current = null;
      return;
    }
    if (initialPathRef.current === null) {
      initialPathRef.current = path;
      return;
    }
    if (initialPathRef.current !== path) {
      onClose();
    }
  }, [isOpen, path, onClose]);

  if (!userId) return null;

  const isOwnProfile = user?.id === context.userID;
  const title = isOwnProfile ? 'Profile' : user?.name || userProfile?.displayName || 'Unknown User';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      className='w-full max-w-lg p-0 overflow-hidden'
      testId='profile-modal'
    >
      <div className='flex flex-col max-h-[85vh]'>
        <div className='sticky top-0 z-10 bg-background flex items-center justify-between gap-3 p-4 border-b border-border'>
          <h1 className='text-lg font-semibold text-foreground truncate flex-1'>{title}</h1>
          <Button
            variant='ghost'
            size='sm'
            onClick={onClose}
            className='!p-2 border border-border rounded-md hover:bg-accent'
            title='Close'
            data-track-category='PROFILE'
            data-track-name='CloseProfileModal'
            data-track-metadata={JSON.stringify({ userId })}
          >
            <X className='size-4' />
          </Button>
        </div>

        <div className='overflow-auto'>
          {user ? (
            <UserProfile
              userId={userId}
              isOwnProfile={isOwnProfile}
              headerLayout='inline'
              className='border-0 shadow-none rounded-none'
            />
          ) : (
            <div className='p-8 text-center text-muted-foreground'>User not found</div>
          )}
        </div>
      </div>
    </Dialog>
  );
};

export default ProfileModal;
