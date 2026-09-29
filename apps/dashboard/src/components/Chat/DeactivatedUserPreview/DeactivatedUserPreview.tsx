import { ReactElement, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Archive } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import { Button } from '../../ui/Button/Button';
import { useUser } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import ProfileModal from '../../ProfileSidebar/ProfileModal';

/**
 * Full-page "empty DM with a deactivated user" view — Slack pattern.
 *
 * Reached from Cmd+K when clicking a deactivated user with no prior DM.
 * A regular DM can't be created (backend refuses to create with a deactivated
 * target), so this synthetic route stands in: it shows the header/name, an
 * informational card with a View Profile CTA, and the same archive banner the
 * real deactivated DM view uses. No backend channel is created.
 *
 * "View Profile" opens the profile in a modal rather than routing to
 * `/chat/dir/{anchor}/profile/{userId}` — no channel is opened, the user stays
 * on this preview page and the modal overlays it.
 */
export const DeactivatedUserPreview = (): ReactElement => {
  const { userId } = useParams<{ userId: string }>();
  const user = useUser(userId ?? '');
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  if (!userId) {
    return (
      <div className='flex flex-1 items-center justify-center text-sm text-muted-foreground'>
        Missing user id.
      </div>
    );
  }

  const displayName = user ? getUserDisplayName(user) : 'Unknown user';

  return (
    <div className='flex h-full min-h-0 flex-col bg-background overflow-hidden'>
      {/* Header */}
      <div className='flex items-center gap-2 border-b border-border px-4 py-3'>
        <Avatar userId={userId} size='sm' showActiveStatus={false} />
        <h2 className='text-base font-semibold text-foreground'>{displayName}</h2>
      </div>

      {/* Empty middle */}
      <div className='flex-1 flex flex-col justify-end px-6 py-6 gap-4'>
        <div className='flex items-center gap-3'>
          <Avatar userId={userId} size='lg' showActiveStatus={false} />
          <div className='flex flex-col'>
            <span className='text-lg font-semibold text-foreground'>
              {displayName}{' '}
              <span className='text-muted-foreground'>(deactivated)</span>
            </span>
          </div>
        </div>
        <p className='text-sm text-muted-foreground max-w-xl'>
          This conversation is just between{' '}
          <span className='text-action-primary'>@{displayName}</span> and you.
          Check out their profile to learn more about them.
        </p>
        <div>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setIsProfileOpen(true)}
          >
            View Profile
          </Button>
        </div>
      </div>

      {/* Archive banner — mirrors ConversationPanelV2's DeactivatedDmArchiveBanner. */}
      <div className='px-4 pt-4 pb-4 bg-background'>
        <div className='flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground'>
          <Archive className='size-4 shrink-0' />
          <span>You are viewing the archives of a deactivated account</span>
        </div>
      </div>

      <ProfileModal
        userId={isProfileOpen ? userId : null}
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />
    </div>
  );
};

export default DeactivatedUserPreview;
