import { ReactElement, useState } from 'react';
import { X, User, SmilePlus, ChevronDown, Check } from 'lucide-react';
import { useZero } from '@rocicorp/zero/react';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import Avatar from '../ui/Avatar/Avatar';
import { StatusIndicator } from '../ui/StatusIndicator';
import { UpdateStatusModal } from '../AppSidebar/UpdateStatusModal';
import { Button } from '../ui/Button/Button';
import { useTheme } from '../../hooks/useTheme';
import { useDebugSettings } from '../../hooks/useDebugSettings';
import { cn } from '../ui/Drawer';
import { isStatusExpired, formatExpiryTime } from '../../utils/statusUtils';
import { Switch } from '../ui/Switch';
import { UserPresenceStatus } from '@xyne/shared';
import { useChannelByName } from '../../hooks/useChannels';
import { useSelf, useUser } from '../../hooks/useUsers';
import { mutators } from '../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { Popover } from '../ui/Popover/Popover';
import { websocketService } from '../../services/clients/socketClient';

const Settings = (): ReactElement => {
  const { logout } = useAuth();
  const user = useSelf();
  const { theme, changeTheme } = useTheme();
  const { settings: debugSettings, toggleSendIndicators } = useDebugSettings();
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const zero = useZero();
  const generalChannel = useChannelByName('general');
  const navigate = useNavigate();
  const { channelId } = useParams<{ channelId?: string }>();
  const userData = useUser(user?.id || '');
  const userPresence = userData?.presenceStatus;
  const handleLogout = (): void => {
    logout();
  };

  // Check if user has a valid (non-expired) status
  const hasValidStatus =
    user?.presenceStatus?.statusEmoji &&
    (!user?.presenceStatus?.statusExpiryAt || !isStatusExpired(user.presenceStatus.statusExpiryAt));

  const handleStatusClick = (): void => {
    setIsStatusModalOpen(true);
  };

  const handleStatusModalClose = (): void => {
    setIsStatusModalOpen(false);
  };

  const handleClearStatus = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (user?.id) {
      zero.mutate(
        mutators.userPresence.upsert({
          statusEmoji: null,
          statusContent: null,
          statusExpiryAt: null,
          timestamp: Date.now(),
          presenceId: uuidv4(),
        }),
      );
    }
  };

  const handleProfileClick = (): void => {
    // Use useParams to get channelId from React Router
    if (channelId) {
      // We're in a chat, use the current channel in dir
      void navigate(`/chat/dir/${channelId}/profile/${user?.id}`);
    } else {
      if (generalChannel) {
        void navigate(`/chat/dir/${generalChannel.id}/profile/${user?.id}`);
      }
    }
  };

  // TODO: Figure out a way to automatically
  // extract themes from the useTheme hook
  const themes: Array<{ id: 'classic' | 'midnight' | 'summer_breeze'; label: string; bg: string }> =
    [
      {
        id: 'classic',
        label: 'Classic',
        bg: `linear-gradient(180deg, #E2EEFB 0%, #EAEFDB 100%)`,
      },
      // { id: 'midnight', label: 'Midnight', bg: '#000000' },
      {
        id: 'summer_breeze',
        label: 'Summer Breeze',
        bg: `linear-gradient(
          180deg,
          #72a2c6 0%,
          #a1a1a9 50.96%,
          #c3bac9 69.71%,
          #7c80a5 78.85%,
          #6274a6 100%
        )`,
      },
    ];

  return (
    <div className='flex flex-col gap-4 min-w-[280px] max-w-[320px] w-full'>
      <div className='flex items-start gap-3'>
        <div className='flex-shrink-0'>
          <Avatar userId={user?.id || ''} size='lg' showActiveStatus={false} />
        </div>
        <div className='flex-1 min-w-0 space-y-1'>
          <p className='text-sm font-medium text-gray-900 truncate'>{user?.name || 'User'}</p>
          {userPresence?.status && (
            <Popover
              trigger={
                <button className='flex items-center gap-1.5 hover:bg-gray-100 px-1.5 py-0.5 -ml-1.5 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500'>
                  {userPresence.status === UserPresenceStatus.ONLINE ? (
                    <div className='w-2 h-2 rounded-full bg-green-500 ring-2 ring-white' />
                  ) : (
                    <div className='w-2 h-2 rounded-full bg-gray-300 ring-2 ring-white'>
                      <div className='w-full h-full rounded-full bg-white/50' />
                    </div>
                  )}
                  <p className='text-xs text-gray-600'>
                    {userPresence.status === UserPresenceStatus.ONLINE ? 'Active' : 'Away'}
                  </p>
                  <ChevronDown className='size-3 text-gray-400' />
                </button>
              }
              align='start'
              className='w-40 p-1'
            >
              <div className='space-y-0.5'>
                <button
                  onClick={() => {
                    websocketService.emit('update_status', { status: 'ONLINE' });
                  }}
                  className='w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-gray-100 transition-colors text-left'
                >
                  <div className='w-2 h-2 rounded-full bg-green-500' />
                  <span>Active</span>
                  {userPresence.status !== UserPresenceStatus.AWAY && (
                    <Check className='size-3 ml-auto text-gray-500' />
                  )}
                </button>
                <button
                  onClick={() => {
                    websocketService.emit('update_status', { status: 'AWAY' });
                  }}
                  className='w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-gray-100 transition-colors text-left'
                >
                  <div className='w-2 h-2 rounded-full border border-gray-400' />
                  <span>Away</span>
                  {userPresence.status === UserPresenceStatus.AWAY && (
                    <Check className='size-3 ml-auto text-gray-500' />
                  )}
                </button>
              </div>
            </Popover>
          )}
        </div>
      </div>

      {/* User Status Section */}
      <div className='mt-2 space-y-1'>
        <div
          className={cn(
            'px-2 py-1 rounded-lg border cursor-pointer hover:bg-gray-200 transition-colors w-full',
            hasValidStatus
              ? 'border-gray-200 bg-transparent hover:bg-gray-100'
              : 'border-gray-200 bg-gray-50',
          )}
          onClick={handleStatusClick}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleStatusClick();
            }
          }}
          role='button'
          tabIndex={0}
          title={hasValidStatus ? 'Click to edit status' : 'Click to set status'}
        >
          {hasValidStatus ? (
            <div className='flex items-center justify-between gap-1 w-full'>
              <div className='flex items-center gap-2 min-w-0 flex-1'>
                <div className='flex-shrink-0'>
                  <StatusIndicator
                    statusEmoji={user?.presenceStatus?.statusEmoji}
                    statusContent={user?.presenceStatus?.statusContent}
                    statusExpiryAt={user?.presenceStatus?.statusExpiryAt}
                    size='lg'
                    showOnHover={false}
                  />
                </div>
                <div className='text-sm font-medium text-gray-900 truncate'>
                  {user?.presenceStatus?.statusContent}
                </div>
              </div>
              <Button
                variant='ghost'
                size='lg'
                onClick={handleClearStatus}
                className='flex-shrink-0 p-1 h-auto hover:bg-gray-300 min-w-[20px]'
                title='Clear status'
              >
                <X className='size-3 text-gray-600' />
              </Button>
            </div>
          ) : (
            <div className='flex items-center p-1 gap-2 text-gray-600'>
              <SmilePlus className='size-4 flex-shrink-0' />
              <span className='text-xs truncate'>Set a status</span>
            </div>
          )}
        </div>
        {hasValidStatus && user?.presenceStatus?.statusExpiryAt && (
          <div className='text-xs text-gray-500'>
            {formatExpiryTime(user.presenceStatus.statusExpiryAt, true)}
          </div>
        )}
      </div>

      <Button
        type='button'
        variant='ghost'
        className='w-full text-left hover:bg-gray-100 rounded-md justify-start gap-2'
        onClick={handleProfileClick}
      >
        <User className='size-4' />
        Profile
      </Button>

      <hr className='border-border w-full' />

      {/* Theme Selection Section */}
      <div className='space-y-2'>
        <p className='text-sm font-medium text-foreground'>Appearance</p>
        <div className='flex gap-2 w-full flex-wrap'>
          {themes.map(themeOption => (
            <button
              key={themeOption.id}
              onClick={() => changeTheme(themeOption.id)}
              className='flex-1 w-25 space-y-1'
            >
              <div
                className='w-25 h-[70px] rounded-md relative overflow-clip'
                style={{
                  background: themeOption.bg,
                  border:
                    theme === themeOption.id
                      ? '1px solid var(--sidebar-badge-accent)'
                      : '1px solid transparent',
                }}
              >
                <div className='absolute left-1/3 top-1/3 w-full h-full bg-muted rounded-md border border-border shadow-3xl'>
                  <div className='w-fit px-1 py-0.5'>Aa</div>
                </div>
              </div>
              <div
                className={cn(
                  'text-xs text-center',
                  theme === themeOption.id ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {themeOption.label}
              </div>
            </button>
          ))}
        </div>
      </div>

      <hr className='border-border w-full' />
      <div className='space-y-2'>
        <p className='text-sm font-medium text-foreground'>Developer Settings</p>
        <div className='space-y-2'>
          <Switch
            id='show-send-indicators'
            checked={debugSettings.showSendIndicators}
            onCheckedChange={toggleSendIndicators}
            label='Show send indicators'
          />
        </div>
      </div>

      <hr className='border-border w-full' />
      <div className='space-y-2'>
        <Button
          type='button'
          variant='ghost'
          className='text-destructive w-full text-left hover:bg-transparent hover:text-destructive rounded-md'
          onClick={handleLogout}
        >
          Sign out of Xyne Space
        </Button>
      </div>

      {/* Status Update Modal */}
      <UpdateStatusModal
        isOpen={isStatusModalOpen}
        onClose={handleStatusModalClose}
        currentStatus={
          hasValidStatus
            ? {
                emoji: user?.presenceStatus?.statusEmoji || '',
                content: user?.presenceStatus?.statusContent || '',
                expiryAt: user?.presenceStatus?.statusExpiryAt || null,
              }
            : null
        }
      />
    </div>
  );
};

export default Settings;
