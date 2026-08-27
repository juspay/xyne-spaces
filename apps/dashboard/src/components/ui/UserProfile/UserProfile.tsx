import React, { useState, useEffect, useRef } from 'react';
import {
  Mail,
  Phone,
  SmilePlus,
  X,
  Calendar,
  Cake,
  MessageSquare,
  Headphones,
  Edit2,
  Check,
  Camera,
  User as UserIcon,
  Copy,
  Hash,
  MapPin,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Avatar from '../Avatar/Avatar';
import { StatusIndicator } from '../StatusIndicator';
import { Button } from '../Button/Button';
import { UpdateStatusModal } from '../../AppSidebar/UpdateStatusModal';
import { isStatusExpired, formatExpiryTime } from '../../../utils/statusUtils';
import { cn } from '../../../utils/classNames';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import { queries } from '../../../zero/queries';
import { useUsers, useUser } from '../../../hooks/useUsers';
import { formatRelativeTimeProfile, formatAge } from '../../../utils/dateUtils';
import { isUserDeactivated } from '../../../utils/userDisplayName';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';
import { channelService } from '../../../services/Chat/channelService';
import { useCallActions } from '../../../hooks/useCallActions';
import { useAuth } from '../../../hooks/useAuth';
import { toast } from 'sonner';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { useZero } from '../../../hooks/useZero';
import SearchUser from '../SearchUser/SearchUser';
import type { User } from '@xyne/shared';
import { CommonChannelsSection } from '../../UserProfile/CommonChannelsSection';
import { useUserPresence } from '../../../hooks/usePresence';
import { uploadProfilePicture } from '../../../services/userProfile/userProfileService';
import { queryClient } from '../../../services/clients/queryClient';
import { usePlatform } from '../../../hooks/usePlatform';
import { useMettleEmployeeDetails } from '../../../hooks/useMettleEmployeeDetails';

interface UserProfileProps {
  userId: string;
  className?: string;
  isOwnProfile: boolean;
  /**
   * Header layout. 'stacked' (default) centers the avatar above the name /
   * team / status block — used by the routed profile sidebar. 'inline' places
   * the avatar beside that block — used by the profile modal on non-chat pages.
   */
  headerLayout?: 'stacked' | 'inline';
}

export const UserProfile: React.FC<UserProfileProps> = ({
  userId,
  className,
  isOwnProfile,
  headerLayout = 'stacked',
}) => {
  const isInlineHeader = headerLayout === 'inline';
  const headerAvatarSize: 'xl' | 'big' = isInlineHeader ? 'xl' : 'big';
  const zero = useZero();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { isMobile } = usePlatform();

  const [userProfile] = useCachedQuery(queries.getUserProfile({ userId }));
  const user = useUser(userId);
  const { data: employeeLocationDetailsViaMettle } = useMettleEmployeeDetails(user?.email);
  // Get live presence status from Socket.IO (not stale Zero data)
  const { status: livePresenceStatus } = useUserPresence(userId);
  const users = useUsers();
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [dmChannelId, setDmChannelId] = useState<string | null>(null);
  const shouldTriggerCallRef = useRef(false);
  const managerUser = users?.find(u => u.id === userProfile?.manager);

  // Edit mode states
  const [editingField, setEditingField] = useState<
    'team' | 'phoneNumber' | 'dob' | 'manager' | 'displayName' | null
  >(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Manager edit state
  const [selectedManagerUsers, setSelectedManagerUsers] = useState<User[]>([]);

  // Picture upload state
  const [isUploadingPicture, setIsUploadingPicture] = useState(false);
  const pictureInputRef = useRef<HTMLInputElement>(null);

  // Copy user ID state
  const [copiedUserId, setCopiedUserId] = useState(false);

  const handleCopyUserId = (): void => {
    copyTextToClipboard(userId)
      .then(() => {
        toast.success('User ID copied to clipboard');
        setCopiedUserId(true);
        setTimeout(() => setCopiedUserId(false), 1500);
      })
      .catch(() => {
        toast.error('Failed to copy user ID');
      });
  };

  // Use useCallActions hook - channelId will be empty string initially, then update
  const { handleCallClick } = useCallActions({
    channelId: dmChannelId || '',
    targetUserIds: dmChannelId ? [userId] : undefined,
    callDisplayName: dmChannelId ? userProfile?.displayName || user?.name || 'User' : undefined,
  });

  // Trigger call after channelId is set (if user clicked button before channel was created)
  useEffect(() => {
    if (dmChannelId && shouldTriggerCallRef.current) {
      shouldTriggerCallRef.current = false;
      handleCallClick();
    }
  }, [dmChannelId, handleCallClick]);

  // Handle message button click - matches UserMentionPopover pattern
  const handleMessageClick = (): void => {
    if (!user || !currentUser?.id) {
      return;
    }
    if (user.id === currentUser.id) {
      return;
    }
    void channelService
      .createDm({ participantIds: [currentUser.id, user.id] })
      .then(response => {
        void navigate(`/chat/dir/${response.id}`);
      })
      .catch(() => {
        toast.error('Failed to create direct message channel.');
      });
  };

  // Handle huddle/call button click - uses useCallActions hook
  const handleHuddleClick = (): void => {
    if (isOwnProfile || !currentUser?.id || !user || user.id === currentUser.id) {
      return;
    }

    // If we don't have a channelId yet, create/get it first, then trigger call
    if (!dmChannelId) {
      shouldTriggerCallRef.current = true;
      void channelService
        .createDm({ participantIds: [currentUser.id, user.id] })
        .then(dmResponse => {
          setDmChannelId(dmResponse.id);
        })
        .catch(() => {
          shouldTriggerCallRef.current = false;
          toast.error('Failed to start call.');
        });
      return;
    }

    // Use the hook's handleCallClick
    handleCallClick();
  };

  const handleClearStatus = (e: React.MouseEvent): void => {
    e.stopPropagation();
    zero.mutate(
      mutators.userPresence.upsert({
        statusEmoji: null,
        statusContent: null,
        statusExpiryAt: null,
        timestamp: Date.now(),
        presenceId: uuidv4(),
      }),
    );
  };

  // Handle edit field
  const handleStartEdit = (
    field: 'team' | 'phoneNumber' | 'dob' | 'displayName',
    currentValue?: string | number | null,
  ): void => {
    setEditingField(field);
    setEditError(null);
    if (field === 'displayName') {
      // For displayName, use userProfile.displayName as the source
      setEditValue(userProfile?.displayName || '');
    } else if (currentValue !== undefined && currentValue !== null) {
      if (field === 'dob' && typeof currentValue === 'number') {
        const date = new Date(currentValue);
        setEditValue(date.toISOString().split('T')[0] || '');
      } else {
        setEditValue(String(currentValue));
      }
    } else {
      setEditValue('');
    }
  };

  const handleCancelEdit = (): void => {
    setEditingField(null);
    setEditValue('');
    setEditError(null);
  };

  const validateField = (
    field: 'team' | 'phoneNumber' | 'dob' | 'displayName',
    value: string,
  ): boolean => {
    setEditError(null);

    if (!value.trim()) {
      return true;
    }

    if (field === 'phoneNumber') {
      const phoneRegex = /^\+?[1-9]\d{9,14}$/;
      if (!phoneRegex.test(value)) {
        setEditError('Please enter a valid phone number');
        return false;
      }
    }

    if (field === 'dob') {
      const selectedDate = new Date(value);
      const today = new Date();
      const age = today.getFullYear() - selectedDate.getFullYear();

      if (selectedDate > today) {
        setEditError('Date of birth cannot be in the future');
        return false;
      }

      if (age < 1 || age > 100) {
        setEditError('Please enter a valid date of birth (age 1-100)');
        return false;
      }
    }

    if (field === 'team' && value.length > 20) {
      setEditError('Team name must be less than 20 characters');
      return false;
    }

    if (field === 'displayName' && value.length > 50) {
      setEditError('Display name must be less than 50 characters');
      return false;
    }

    return true;
  };

  const handleSaveEdit = (): void => {
    if (!editingField || editingField === 'manager') return;

    if (!validateField(editingField, editValue)) {
      return;
    }

    const updateParams: {
      displayName?: string | null;
      team?: string | null;
      phoneNumber?: string | null;
      dob?: number | null;
    } = {};

    if (editingField === 'displayName') {
      updateParams.displayName = editValue.trim() || null;
    } else if (editingField === 'team') {
      updateParams.team = editValue.trim() || null;
    } else if (editingField === 'phoneNumber') {
      updateParams.phoneNumber = editValue.trim() || null;
    } else if (editingField === 'dob') {
      updateParams.dob = editValue ? new Date(editValue).getTime() : null;
    }

    zero.mutate(
      mutators.userProfile.upsert({
        ...updateParams,
        timestamp: Date.now(),
        profileId: uuidv4(),
      }),
    );

    setEditingField(null);
    setEditValue('');
    setEditError(null);
  };

  const handlePictureClick = (): void => {
    if (pictureInputRef.current) {
      pictureInputRef.current.click();
    }
  };

  const handlePictureChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file || !isOwnProfile) return;

    setIsUploadingPicture(true);
    try {
      await uploadProfilePicture(file);
      // Invalidate user cache to refresh picture path (which includes timestamp)
      // New picture path = new React Query key = fresh fetch
      void queryClient.invalidateQueries({
        queryKey: ['user', currentUser?.id],
        exact: false,
      });
    } catch {
      // Error is already handled by toast in the service
    } finally {
      setIsUploadingPicture(false);
      // Reset input
      if (pictureInputRef.current) {
        pictureInputRef.current.value = '';
      }
    }
  };

  const statusEmoji = user?.statusEmoji;
  const statusContent = user?.statusContent;
  const statusExpiryAt = user?.statusExpiryAt;
  const hasStatus = statusEmoji && (!statusExpiryAt || !isStatusExpired(statusExpiryAt));

  if (!user) {
    return (
      <div className={cn('p-6', className)}>
        <div className='text-center text-muted-foreground'>User not found</div>
      </div>
    );
  }

  return (
    <div className={cn('bg-background rounded-lg shadow-sm border border-border', className)}>
      {/* Header Section */}
      <div
        className={cn(
          'pt-2 px-6 pb-6',
          isInlineHeader ? 'flex flex-row items-center gap-5' : 'flex flex-col items-center',
        )}
      >
        {/* Picture Upload Section */}
        <div className={cn('relative', isInlineHeader ? 'mb-0 shrink-0' : 'mb-8')}>
          {isOwnProfile ? (
            <div
              className='relative group cursor-pointer'
              onClick={handlePictureClick}
              data-track-category='USER_PROFILE'
              data-track-name='CHANGE_PROFILE_PICTURE'
              onKeyDown={e => {
                if (e.key === 'Enter') handlePictureClick();
              }}
              role='button'
              tabIndex={0}
            >
              <Avatar
                userId={user.id}
                size={headerAvatarSize}
                className='rounded-xl'
                showActiveStatus={true}
              />
              <div className='absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 rounded-xl flex items-center justify-center transition-opacity'>
                <Camera className='size-8 text-white' />
              </div>
              <input
                ref={pictureInputRef}
                type='file'
                accept='image/jpeg,image/png,image/webp'
                onChange={e => {
                  void handlePictureChange(e);
                }}
                className='hidden'
                disabled={isUploadingPicture}
              />
            </div>
          ) : (
            <Avatar
              userId={user.id}
              size={headerAvatarSize}
              className='rounded-xl'
              showActiveStatus={true}
            />
          )}
        </div>

        <div className={cn(isInlineHeader ? 'flex-1 min-w-0' : 'w-full')}>
          <div className='flex items-center gap-2 mb-1'>
            <h2
              className={`text-2xl font-semibold ${isUserDeactivated(user) ? 'text-muted-foreground' : 'text-foreground'}`}
            >
              {user?.name || 'Unknown User'}
            </h2>
            {isUserDeactivated(user) && (
              <span className='inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground shrink-0'>
                Deactivated
              </span>
            )}
          </div>

          {/* Team */}
          {editingField === 'team' && isOwnProfile ? (
            <div className='mt-2 space-y-1'>
              <div className='flex items-center gap-2'>
                <input
                  type='text'
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveEdit();
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                  placeholder='Enter team name'
                  maxLength={20}
                  className='flex-1 px-2 py-1 text-lg border border-input rounded focus:outline-none focus:border-ring bg-background text-foreground'
                  autoFocus={!isMobile}
                />
                <button
                  onClick={handleSaveEdit}
                  data-track-category='USER_PROFILE'
                  data-track-name='SAVE_TEAM'
                  className='p-1 text-green-600 hover:bg-green-50 rounded'
                  title='Save'
                >
                  <Check className='size-4' />
                </button>
                <button
                  onClick={handleCancelEdit}
                  data-track-category='USER_PROFILE'
                  data-track-name='CANCEL_EDIT_TEAM'
                  className='p-1 text-muted-foreground hover:bg-accent rounded'
                  title='Cancel'
                >
                  <X className='size-4' />
                </button>
              </div>
              {editError && <p className='text-xs text-red-600'>{editError}</p>}
            </div>
          ) : userProfile?.team ? (
            <div className='flex items-center gap-2 mt-1'>
              <div className='text-lg text-muted-foreground'>{userProfile.team}</div>
              {isOwnProfile && (
                <button
                  onClick={() => handleStartEdit('team', userProfile.team)}
                  className='text-muted-foreground hover:text-muted-foreground'
                  title='Edit team name'
                >
                  <Edit2 className='size-3' />
                </button>
              )}
            </div>
          ) : isOwnProfile ? (
            <button
              onClick={() => handleStartEdit('team')}
              data-track-category='USER_PROFILE'
              data-track-name='START_EDIT_TEAM'
              className='mt-1 text-sm text-action-primary hover:opacity-80 flex items-center gap-1 transition-opacity'
            >
              <span>+ Add Team Name</span>
            </button>
          ) : null}

          {/* Online/Away Status - Use live Socket.IO presence status */}
          {livePresenceStatus && (
            <div className='flex items-center gap-2 mt-2 text-sm text-muted-foreground'>
              {livePresenceStatus === 'ONLINE' ? (
                <div className='w-2 h-2 rounded-full bg-green-500' />
              ) : (
                <div className='w-2 h-2 rounded-full border border-muted-foreground' />
              )}
              <span className='capitalize'>
                {livePresenceStatus === 'ONLINE' ? 'Active' : livePresenceStatus.toLowerCase()}
              </span>
            </div>
          )}

          {/* Custom Status - Show for everyone if set */}
          {hasStatus && !isOwnProfile && (
            <div className='mt-2'>
              <div className='flex items-center gap-2 text-sm text-foreground'>
                <span className='text-base'>{renderEmoji(statusEmoji || '')}</span>
                <span>{statusContent}</span>
              </div>
              {statusExpiryAt && (
                <div className='text-xs text-muted-foreground mt-1'>
                  {formatExpiryTime(statusExpiryAt, true)}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons - Message and Huddle */}
          {!isOwnProfile && (
            <div className='flex items-center gap-2 mt-4'>
              <Button
                onClick={handleMessageClick}
                data-track-category='USER_PROFILE'
                data-track-name='SEND_MESSAGE_TO_USER'
                className='flex items-center gap-2 px-4 py-2 border border-input bg-background hover:bg-accent text-foreground rounded-lg'
                variant='outline'
              >
                <MessageSquare className='size-4' />
                <span>Message</span>
              </Button>
              <Button
                onClick={handleHuddleClick}
                data-track-category='USER_PROFILE'
                data-track-name='START_HUDDLE_WITH_USER'
                className='flex items-center gap-2 px-4 py-2 border border-input bg-background hover:bg-accent text-foreground rounded-lg'
                variant='outline'
              >
                <Headphones className='size-4' />
                <span>Huddle</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* User Status Section - Editable pill for own profile */}
      {isOwnProfile && (
        <div className='px-6 pb-6'>
          <div className='space-y-1'>
            <div
              className={cn(
                'px-2 py-2 rounded-lg border cursor-pointer hover:bg-accent transition-colors w-full',
                hasStatus
                  ? 'border-border bg-transparent hover:bg-accent'
                  : 'border-border bg-muted',
              )}
              onClick={() => setIsStatusModalOpen(true)}
              data-track-category='USER_PROFILE'
              data-track-name='OPEN_STATUS_MODAL'
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsStatusModalOpen(true);
                }
              }}
              role='button'
              tabIndex={0}
              title={hasStatus ? 'Click to edit status' : 'Click to set status'}
            >
              {hasStatus ? (
                <div className='flex items-center justify-between gap-1 w-full'>
                  <div className='flex items-center gap-2 min-w-0 flex-1'>
                    <div className='flex-shrink-0'>
                      <StatusIndicator
                        statusEmoji={user?.statusEmoji}
                        statusContent={user?.statusContent}
                        statusExpiryAt={user?.statusExpiryAt}
                        size='sm'
                        showOnHover={false}
                      />
                    </div>
                    <div className='text-xs font-medium text-foreground truncate'>
                      {user?.statusContent}
                    </div>
                  </div>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={handleClearStatus}
                    data-track-category='USER_PROFILE'
                    data-track-name='CLEAR_STATUS'
                    className='flex-shrink-0 p-1 h-auto hover:bg-accent min-w-[20px]'
                    title='Clear status'
                  >
                    <X className='size-3 text-muted-foreground' />
                  </Button>
                </div>
              ) : (
                <div className='flex items-center gap-2 text-muted-foreground'>
                  <SmilePlus className='size-4 flex-shrink-0' />
                  <span className='text-sm truncate'>Update your status</span>
                </div>
              )}
            </div>
            {hasStatus && user?.statusExpiryAt && (
              <div className='text-xs text-muted-foreground'>
                {formatExpiryTime(user.statusExpiryAt, true)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Divider */}
      <div className='mx-6 border-b border-border' />

      {/* Manager Section */}
      {(managerUser || isOwnProfile) && (
        <div className='px-6 py-4'>
          <div className='flex items-center gap-2 mb-3'>
            <h3 className='text-sm font-semibold text-foreground'>Manager</h3>
          </div>
          {editingField === 'manager' && isOwnProfile ? (
            <div className='space-y-2'>
              <div className='[&_.bg-blue-600]:bg-gray-700 [&_.bg-blue-600]:text-white [&_.hover\\:bg-blue-600\\/90]:hover:bg-gray-600'>
                <SearchUser
                  excludeUserIds={[userId]}
                  selectedUsers={selectedManagerUsers}
                  onUsersChange={users => {
                    // Only keep the last selected user (single manager)
                    if (users.length > 1) {
                      setSelectedManagerUsers([users[users.length - 1]!]);
                    } else {
                      setSelectedManagerUsers(users);
                    }
                  }}
                  placeholder='Search for a manager...'
                  hintText=''
                  label=''
                  autoFocus={!isMobile}
                />
              </div>
              <div className='flex justify-end gap-2'>
                <button
                  onClick={() => {
                    setEditingField(null);
                    setSelectedManagerUsers([]);
                  }}
                  data-track-category='USER_PROFILE'
                  data-track-name='CANCEL_EDIT_MANAGER'
                  className='px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const managerId: string | null =
                      selectedManagerUsers.length > 0 && selectedManagerUsers[0]
                        ? selectedManagerUsers[0].id
                        : null;
                    zero.mutate(
                      mutators.userProfile.upsert({
                        manager: managerId,
                        timestamp: Date.now(),
                        profileId: uuidv4(),
                      }),
                    );
                    setEditingField(null);
                    setSelectedManagerUsers([]);
                  }}
                  data-track-category='USER_PROFILE'
                  data-track-name='SAVE_MANAGER'
                  className='px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800'
                >
                  Save
                </button>
              </div>
            </div>
          ) : managerUser ? (
            <div className='flex items-center gap-3'>
              <Avatar userId={managerUser.id} size='md' />
              <div className='flex-1'>
                <div className='text-sm font-medium text-foreground'>{managerUser.name}</div>
              </div>
            </div>
          ) : isOwnProfile ? (
            <button
              onClick={() => {
                setEditingField('manager');
                setSelectedManagerUsers([]);
              }}
              data-track-category='USER_PROFILE'
              data-track-name='START_EDIT_MANAGER'
              className='text-sm text-action-primary hover:opacity-80 flex items-center gap-1 transition-opacity'
            >
              <span>+ Add Manager</span>
            </button>
          ) : null}
        </div>
      )}

      {/* Contact Information Section */}
      <div className='px-6 pb-4 pt-4'>
        <h3 className='text-sm font-semibold text-foreground mb-4'>Contact Information</h3>
        <div className='space-y-4'>
          {/* User ID */}
          <div className='flex items-start gap-3'>
            <div className='p-2 bg-muted rounded-lg flex-shrink-0'>
              <Hash className='size-4 text-muted-foreground' />
            </div>
            <div className='flex-1'>
              <div className='text-sm font-semibold text-foreground leading-tight'>User ID</div>
              <div className='flex items-center gap-1.5 mt-1'>
                <code className='text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[200px] inline-block'>
                  {userId}
                </code>
                <Button
                  variant='ghost'
                  size='iconSm'
                  className='h-5 w-5 p-0 text-muted-foreground hover:text-foreground'
                  onClick={handleCopyUserId}
                  data-track-category='USER_PROFILE'
                  data-track-name='COPY_USER_ID'
                  title='Copy user ID'
                >
                  {copiedUserId ? <Check className='size-3' /> : <Copy className='size-3' />}
                </Button>
              </div>
            </div>
          </div>

          {/* Email Address */}
          <div className='flex items-start gap-3'>
            <div className='p-2 bg-muted rounded-lg flex-shrink-0'>
              <Mail className='size-4 text-muted-foreground' />
            </div>
            <div className='flex-1'>
              <div className='text-sm font-semibold text-foreground leading-tight'>
                Email Address
              </div>
              <div className='text-sm text-foreground mt-1'>{user.email}</div>
            </div>
          </div>

          {/* Display Name */}
          {userProfile?.displayName || isOwnProfile ? (
            <div className='flex items-start gap-3'>
              <div className='p-2 bg-muted rounded-lg flex-shrink-0'>
                <UserIcon className='size-4 text-muted-foreground' />
              </div>
              <div className='flex-1'>
                <div className='text-sm font-semibold text-foreground leading-tight flex items-center gap-2'>
                  Display Name
                  {isOwnProfile && userProfile?.displayName && editingField !== 'displayName' && (
                    <button
                      onClick={() => handleStartEdit('displayName', userProfile.displayName)}
                      data-track-category='USER_PROFILE'
                      data-track-name='START_EDIT_DISPLAY_NAME'
                      className='text-muted-foreground hover:text-muted-foreground'
                      title='Edit display name'
                    >
                      <Edit2 className='size-3' />
                    </button>
                  )}
                </div>
                {editingField === 'displayName' && isOwnProfile ? (
                  <div className='mt-1 space-y-1'>
                    <div className='flex items-center gap-2'>
                      <input
                        type='text'
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        placeholder='Enter display name'
                        maxLength={50}
                        className='flex-1 px-2 py-1 text-sm text-foreground bg-background border border-input rounded focus:outline-none focus:border-ring'
                        autoFocus={!isMobile}
                      />
                      <button
                        onClick={handleSaveEdit}
                        data-track-category='USER_PROFILE'
                        data-track-name='SAVE_DISPLAY_NAME'
                        className='p-1 text-green-600 hover:bg-green-50 rounded'
                        title='Save'
                      >
                        <Check className='size-4' />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        data-track-category='USER_PROFILE'
                        data-track-name='CANCEL_EDIT_DISPLAY_NAME'
                        className='p-1 text-muted-foreground hover:bg-accent rounded'
                        title='Cancel'
                      >
                        <X className='size-4' />
                      </button>
                    </div>
                    {editError && <p className='text-xs text-red-600'>{editError}</p>}
                  </div>
                ) : userProfile?.displayName ? (
                  <div className='text-sm text-foreground mt-1'>{userProfile.displayName}</div>
                ) : isOwnProfile ? (
                  <button
                    onClick={() => handleStartEdit('displayName', userProfile?.displayName)}
                    data-track-category='USER_PROFILE'
                    data-track-name='START_EDIT_DISPLAY_NAME'
                    className='mt-1 text-sm text-action-primary hover:opacity-80 transition-opacity'
                  >
                    + Add Display Name
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Phone Number */}
          {userProfile?.phoneNumber || isOwnProfile ? (
            <div className='flex items-start gap-3'>
              <div className='p-2 bg-muted rounded-lg flex-shrink-0'>
                <Phone className='size-4 text-muted-foreground' />
              </div>
              <div className='flex-1'>
                <div className='text-sm font-semibold text-foreground leading-tight flex items-center gap-2'>
                  Phone Number
                  {isOwnProfile && userProfile?.phoneNumber && editingField !== 'phoneNumber' && (
                    <button
                      onClick={() => handleStartEdit('phoneNumber', userProfile.phoneNumber)}
                      data-track-category='USER_PROFILE'
                      data-track-name='START_EDIT_PHONE_NUMBER'
                      className='text-muted-foreground hover:text-muted-foreground'
                      title='Edit phone number'
                    >
                      <Edit2 className='size-3' />
                    </button>
                  )}
                </div>
                {editingField === 'phoneNumber' && isOwnProfile ? (
                  <div className='mt-1 space-y-1'>
                    <div className='flex items-center gap-2'>
                      <input
                        type='tel'
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        placeholder='Enter phone number'
                        maxLength={15}
                        className='flex-1 px-2 py-1 text-sm text-foreground bg-background border border-input rounded focus:outline-none focus:border-ring'
                        autoFocus={!isMobile}
                      />
                      <button
                        onClick={handleSaveEdit}
                        data-track-category='USER_PROFILE'
                        data-track-name='SAVE_PHONE_NUMBER'
                        className='p-1 text-green-600 hover:bg-green-50 rounded'
                        title='Save'
                      >
                        <Check className='size-4' />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        data-track-category='USER_PROFILE'
                        data-track-name='CANCEL_EDIT_PHONE_NUMBER'
                        className='p-1 text-muted-foreground hover:bg-accent rounded'
                        title='Cancel'
                      >
                        <X className='size-4' />
                      </button>
                    </div>
                    {editError && <p className='text-xs text-red-600'>{editError}</p>}
                  </div>
                ) : userProfile?.phoneNumber ? (
                  <div className='text-sm text-foreground mt-1'>{userProfile.phoneNumber}</div>
                ) : (
                  <button
                    onClick={() => handleStartEdit('phoneNumber')}
                    data-track-category='USER_PROFILE'
                    data-track-name='START_EDIT_PHONE_NUMBER'
                    className='mt-1 text-sm text-action-primary hover:opacity-80 transition-opacity'
                  >
                    + Add Phone Number
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {/* Start Date */}
          {userProfile?.joinedOn && (
            <div className='flex items-start gap-3'>
              <div className='p-2 bg-muted rounded-lg flex-shrink-0'>
                <Calendar className='size-4 text-muted-foreground' />
              </div>
              <div className='flex-1'>
                <div className='text-sm font-semibold text-foreground leading-tight'>
                  Start Date
                </div>
                <div className='text-sm text-foreground mt-1'>
                  {new Date(userProfile.joinedOn)
                    .toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                    .replace(',', '')}{' '}
                  {formatRelativeTimeProfile(userProfile.joinedOn)}
                </div>
              </div>
            </div>
          )}

          {/* Birth Date */}
          {userProfile?.dob || isOwnProfile ? (
            <div className='flex items-start gap-3'>
              <div className='p-2 bg-muted rounded-lg flex-shrink-0'>
                <Cake className='size-4 text-muted-foreground' />
              </div>
              <div className='flex-1'>
                <div className='text-sm font-semibold text-foreground leading-tight flex items-center gap-2'>
                  Birth Date
                  {isOwnProfile && userProfile?.dob && editingField !== 'dob' && (
                    <button
                      onClick={() => handleStartEdit('dob', userProfile.dob)}
                      data-track-category='USER_PROFILE'
                      data-track-name='START_EDIT_BIRTH_DATE'
                      className='text-muted-foreground hover:text-muted-foreground'
                      title='Edit birth date'
                    >
                      <Edit2 className='size-3' />
                    </button>
                  )}
                </div>
                {editingField === 'dob' && isOwnProfile ? (
                  <div className='mt-1 space-y-1'>
                    <div className='flex items-center gap-2'>
                      <input
                        type='date'
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        max={new Date().toISOString().split('T')[0]}
                        className='flex-1 px-2 py-1 text-sm text-foreground bg-background border border-input rounded focus:outline-none focus:border-ring'
                        autoFocus={!isMobile}
                      />
                      <button
                        onClick={handleSaveEdit}
                        data-track-category='USER_PROFILE'
                        data-track-name='SAVE_BIRTH_DATE'
                        className='p-1 text-green-600 hover:bg-green-50 rounded'
                        title='Save'
                      >
                        <Check className='size-4' />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        data-track-category='USER_PROFILE'
                        data-track-name='CANCEL_EDIT_BIRTH_DATE'
                        className='p-1 text-muted-foreground hover:bg-accent rounded'
                        title='Cancel'
                      >
                        <X className='size-4' />
                      </button>
                    </div>
                    {editError && <p className='text-xs text-red-600'>{editError}</p>}
                  </div>
                ) : userProfile?.dob ? (
                  <div className='text-sm text-foreground mt-1'>
                    {new Date(userProfile.dob)
                      .toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })
                      .replace(',', '')}{' '}
                    {formatAge(userProfile.dob)}
                  </div>
                ) : (
                  <button
                    onClick={() => handleStartEdit('dob')}
                    data-track-category='USER_PROFILE'
                    data-track-name='START_EDIT_BIRTH_DATE'
                    className='mt-1 text-sm text-action-primary hover:opacity-80 transition-opacity'
                  >
                    + Add Birth Date
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {/* Current Location */}
          {(employeeLocationDetailsViaMettle?.current_location ||
            employeeLocationDetailsViaMettle?.current_landmark) && (
            <div className='flex items-start gap-3'>
              <div className='p-2 bg-muted rounded-lg flex-shrink-0'>
                <MapPin className='size-4 text-muted-foreground' />
              </div>
              <div className='flex-1'>
                <div className='text-sm font-semibold text-foreground leading-tight'>
                  Current Location
                </div>
                {employeeLocationDetailsViaMettle?.current_location && (
                  <div className='text-sm text-foreground mt-1'>
                    {employeeLocationDetailsViaMettle.current_location}
                  </div>
                )}
                {employeeLocationDetailsViaMettle?.current_landmark && (
                  <div className='text-xs text-muted-foreground mt-1'>
                    Landmark: {employeeLocationDetailsViaMettle.current_landmark}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {!isOwnProfile && currentUser?.id && (
        <CommonChannelsSection
          profileUserId={userId}
          currentUserId={currentUser.id}
          className='px-6 pb-4'
        />
      )}

      {/* Status Update Modal - only render for own profile */}
      {isOwnProfile && (
        <UpdateStatusModal
          isOpen={isStatusModalOpen}
          onClose={() => setIsStatusModalOpen(false)}
          currentStatus={
            hasStatus
              ? {
                  emoji: statusEmoji || '',
                  content: statusContent || '',
                  expiryAt: statusExpiryAt || null,
                }
              : null
          }
        />
      )}
    </div>
  );
};

export default UserProfile;
