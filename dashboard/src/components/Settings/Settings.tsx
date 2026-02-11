import { ReactElement, useState } from 'react';
import { X, User, SmilePlus, Copy, PauseCircle } from 'lucide-react';
import { useZero } from '../../hooks/useZero';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import Avatar from '../ui/Avatar/Avatar';
import { StatusIndicator } from '../ui/StatusIndicator';
import { UpdateStatusModal } from '../AppSidebar/UpdateStatusModal';
import { UpdateAssignmentStatusModal } from '../AppSidebar/UpdateAssignmentStatusModal';
import { Button } from '../ui/Button/Button';
import { useCurrentUserAssignmentState } from '../../hooks/useAssignmentState';
import { useTheme } from '../../hooks/useTheme';
import { useDebugSettings } from '../../hooks/useDebugSettings';
import { cn } from '../ui/Drawer';
import { isStatusExpired, formatExpiryTime } from '../../utils/statusUtils';
import { Switch } from '../ui/Switch';
import { useChannelByName } from '../../hooks/useChannels';
import { useSelf } from '../../hooks/useUsers';
import { mutators } from '../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { apiInstance } from '../../services/clients/apiClient';
import { logger } from '../../utils/logger';
import { toast } from 'sonner';

const Settings = (): ReactElement => {
  const { logout } = useAuth();
  const user = useSelf();
  const { theme, changeTheme } = useTheme();
  const { settings: debugSettings, toggleSendIndicators } = useDebugSettings();
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const zero = useZero();

  // Get assignment availability for current user
  const { isCurrentlyUnavailable, unavailableUntil, isActiveInAtLeastOneGroup } =
    useCurrentUserAssignmentState();
  const generalChannel = useChannelByName('general');
  const navigate = useNavigate();
  const { channelId } = useParams<{ channelId?: string }>();
  // const userData = useUser(user?.id || '');
  // const userPresence = userData?.presenceStatus;
  const handleLogout = (): void => {
    logout();
  };

  const handleResumeAssignment = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    if (!user?.id) return;

    void apiInstance.post('/user-assignment-state/toggle', { isUnavailable: false }).then(() => {
      // Update Zero immediately so UI is in sync
      zero.mutate(
        mutators.userPresence.upsert({
          assignmentUnavailableUntil: null,
          timestamp: Date.now(),
          presenceId: uuidv4(),
        }),
      );
    });
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
          <div className='flex items-center gap-1.5'>
            <div className='w-2 h-2 rounded-full bg-green-500' />
            <p className='text-xs text-gray-600'>Active</p>
          </div>
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

      {/* Assignment Status Section */}
      {(isActiveInAtLeastOneGroup || isCurrentlyUnavailable) && (
        <div className='mt-2 space-y-1'>
          <div
            className={cn(
              'px-2 py-1 rounded-lg border transition-colors w-full flex items-center justify-between gap-2',
              isCurrentlyUnavailable
                ? 'border-gray-200 bg-transparent hover:bg-gray-100'
                : 'border-gray-200 bg-gray-50 hover:bg-gray-200 cursor-pointer',
            )}
            onClick={() => {
              if (!isCurrentlyUnavailable) {
                setIsAssignmentModalOpen(true);
              }
            }}
            onKeyDown={e => {
              if (!isCurrentlyUnavailable && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                setIsAssignmentModalOpen(true);
              }
            }}
            role='button'
            tabIndex={0}
            title={
              isCurrentlyUnavailable ? 'Paused from assignment' : 'Click to pause from assignment'
            }
          >
            {isCurrentlyUnavailable ? (
              <div className='flex items-center gap-2 min-w-0 flex-1'>
                <PauseCircle className='size-4 flex-shrink-0 text-gray-600' />
                <div className='text-sm font-medium text-gray-900 truncate'>
                  Paused from ticket assignment
                </div>
              </div>
            ) : (
              <div className='flex items-center p-1 gap-2 text-gray-600'>
                <PauseCircle className='size-4 flex-shrink-0' />
                <span className='text-xs truncate'>Pause from ticket assignment</span>
              </div>
            )}

            {isCurrentlyUnavailable && (
              <Button
                variant='ghost'
                size='lg'
                className='flex-shrink-0 p-1 h-auto hover:bg-gray-300 min-w-[20px]'
                title='Resume ticket assignment'
                onClick={handleResumeAssignment}
              >
                <X className='size-3 text-gray-600' />
              </Button>
            )}
          </div>
          {isCurrentlyUnavailable && unavailableUntil && (
            <div className='text-xs text-gray-500'>
              Until {new Date(unavailableUntil).toLocaleString()}
            </div>
          )}
        </div>
      )}

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

      <div className='text-xs flex flex-col gap-1 text-gray-400'>
        <div>Version: {__APP_VERSION__}</div>
        {logger.zeroClientID && (
          <button
            onClick={() => {
              navigator.clipboard
                .writeText(logger.zeroClientID!)
                .then(() => {
                  toast.success('Client ID copied to clipboard');
                })
                .catch(() => {
                  toast.error('Failed to copy Client ID');
                });
            }}
            className='flex items-center gap-1 hover:text-gray-600 transition-colors cursor-pointer text-left'
          >
            <span>Client ID: {logger.zeroClientID}</span>
            <Copy className='size-3' />
          </button>
        )}
        {logger.zeroClientGroupID && (
          <button
            onClick={() => {
              navigator.clipboard
                .writeText(logger.zeroClientGroupID!)
                .then(() => {
                  toast.success('Client Group ID copied to clipboard');
                })
                .catch(() => {
                  toast.error('Failed to copy Client Group ID');
                });
            }}
            className='flex items-center gap-1 hover:text-gray-600 transition-colors cursor-pointer text-left'
          >
            <span>Client Group ID: {logger.zeroClientGroupID}</span>
            <Copy className='size-3' />
          </button>
        )}
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

      {/* Assignment Status Modal */}
      {(isActiveInAtLeastOneGroup || isCurrentlyUnavailable) && (
        <UpdateAssignmentStatusModal
          isOpen={isAssignmentModalOpen}
          onClose={() => setIsAssignmentModalOpen(false)}
        />
      )}
    </div>
  );
};

export default Settings;
