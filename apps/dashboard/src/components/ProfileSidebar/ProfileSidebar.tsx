import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useUser } from '../../hooks/useUsers';
import { useAuthContextValues } from '../../hooks/useAuth';
import UserProfile from '../ui/UserProfile/UserProfile';
import { X } from 'lucide-react';
import Button from '../ui/Button';
import { queries } from '../../zero/queries';
import { useRouteContext } from '../../hooks/useRouteContext';
import { useCachedQuery } from '../../hooks/useCachedQuery';

interface ProfileSidebarProps {
  className?: string;
}

export const ProfileSidebar: React.FC<ProfileSidebarProps> = ({ className }) => {
  const navigate = useNavigate();
  const { channelId, conversationId, userId } = useParams<{
    channelId?: string;
    conversationId?: string;
    userId: string;
  }>();
  const location = useLocation();
  const context = useAuthContextValues();
  const { baseRoute } = useRouteContext();

  const user = useUser(userId || '');
  const [userProfile] = useCachedQuery(queries.getUserProfile({ userId: userId || '' }), {
    enabled: !!userId,
  });

  const handleClose = (): void => {
    if (channelId) {
      const threadSegment = conversationId ? `/${conversationId}` : '';
      const isFocusThread = new URLSearchParams(location.search).get('focusThread') === '1';
      const focusThreadSearch = isFocusThread ? '?focusThread=1' : '';
      void navigate(`${baseRoute}/${channelId}${threadSegment}${focusThreadSearch}`);
    } else {
      void navigate(baseRoute);
    }
  };

  if (!user) {
    return (
      <div className={`h-full flex items-center justify-center bg-background ${className}`}>
        <div className='text-center text-muted-foreground'>
          <div className='mb-4'>User not found</div>
          <Button
            onClick={handleClose}
            variant='outline'
            data-track-category='PROFILE'
            data-track-name='CloseProfile'
            data-track-metadata={JSON.stringify({ channelId, userId })}
          >
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  // Check if the profile being viewed belongs to the current user
  const isOwnProfile = user.id === context.userID;

  return (
    <div className={`h-full bg-background overflow-auto ${className}`}>
      {/* Header with back button */}
      <div className='sticky top-0 z-10 bg-background pb-1 p-4'>
        <div className='flex items-center justify-between gap-3'>
          <div className='flex-1'>
            <h1 className='text-lg font-semibold text-foreground truncate'>
              {isOwnProfile
                ? 'Profile'
                : `${user?.name || userProfile?.displayName || 'Unknown User'}`}
            </h1>
          </div>
          <Button
            variant='ghost'
            size='sm'
            onClick={handleClose}
            className='!p-2 border border-border rounded-md hover:bg-accent'
            title='Close'
            data-track-category='PROFILE'
            data-track-name='CloseProfileSidebar'
            data-track-metadata={JSON.stringify({ channelId, userId })}
          >
            <X className='size-4' />
          </Button>
        </div>
      </div>

      {/* User Profile Content */}
      <UserProfile
        userId={userId || ''}
        isOwnProfile={isOwnProfile}
        className='border-0 shadow-none rounded-none'
      />
    </div>
  );
};

export default ProfileSidebar;
