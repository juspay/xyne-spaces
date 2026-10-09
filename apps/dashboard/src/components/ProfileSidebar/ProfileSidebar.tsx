import React, { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Archive, X } from 'lucide-react';
import { useUser } from '../../hooks/useUsers';
import { useAuthContextValues } from '../../hooks/useAuth';
import UserProfile from '../ui/UserProfile/UserProfile';
import Button from '../ui/Button';
import Avatar from '../ui/Avatar/Avatar';
import { queries } from '../../zero/queries';
import { useRouteContext } from '../../hooks/useRouteContext';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { getUserDisplayName, isUserDeactivated } from '../../utils/userDisplayName';
import ProfileModal from './ProfileModal';

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
  // Slack-style empty-DM view (reached from Cmd+K's deactivated-user fallback).
  // `View Profile` opens the shared ProfileModal in-place — no route change.
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

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
  const displayName = getUserDisplayName(user);

  // Deactivated target → Slack-style empty-DM view. Reached only from Cmd+K's
  // profile-fallback (no prior DM with a deactivated user). ChatView renders
  // this component full-viewport for that case (see isDeactivatedProfileActive
  // in ChatView.tsx), so the layout owns the screen instead of showing as a
  // sidebar. No new route needed.
  if (!isOwnProfile && isUserDeactivated(user)) {
    return (
      <div className={`flex h-full min-h-0 flex-col bg-background ${className}`}>
        {/* Header */}
        <div className='flex items-center justify-between gap-3 border-b border-border px-4 py-3'>
          <div className='flex items-center gap-2 min-w-0'>
            <Avatar userId={userId || ''} size='sm' showActiveStatus={false} />
            <h2 className='text-base font-semibold text-foreground truncate'>{displayName}</h2>
          </div>
          <Button
            variant='ghost'
            size='sm'
            onClick={handleClose}
            className='!p-2 border border-border rounded-md hover:bg-accent'
            title='Close'
            aria-label='Close'
            data-track-category='PROFILE'
            data-track-name='CloseDeactivatedPreview'
            data-track-metadata={JSON.stringify({ userId })}
          >
            <X className='size-4' />
          </Button>
        </div>

        {/* Empty area with bottom-anchored info card (Slack pattern) */}
        <div className='flex-1 flex flex-col justify-end gap-4 px-6 py-6'>
          <div className='flex items-center gap-3'>
            <Avatar userId={userId || ''} size='lg' showActiveStatus={false} />
            <span className='text-lg font-semibold text-foreground'>
              {displayName} <span className='text-muted-foreground'>(deactivated)</span>
            </span>
          </div>
          <p className='text-sm text-muted-foreground max-w-xl'>
            This conversation is just between{' '}
            <span className='text-action-primary'>@{displayName}</span> and you. Check out their
            profile to learn more about them.
          </p>
          <div>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setIsProfileModalOpen(true)}
              data-track-category='PROFILE'
              data-track-name='ViewDeactivatedProfile'
              data-track-metadata={JSON.stringify({ userId })}
            >
              View Profile
            </Button>
          </div>
        </div>

        {/* Archive banner — same style as ConversationPanelV2's DeactivatedDmArchiveBanner. */}
        <div className='px-4 pt-4 pb-4 bg-background'>
          <div className='flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground'>
            <Archive className='size-4 shrink-0' />
            <span>You are viewing the archives of a deactivated account</span>
          </div>
        </div>

        <ProfileModal
          userId={isProfileModalOpen ? userId || null : null}
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
        />
      </div>
    );
  }

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
            aria-label='Close'
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
