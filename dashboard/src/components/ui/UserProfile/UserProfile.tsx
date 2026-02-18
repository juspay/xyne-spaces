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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Avatar from '../Avatar/Avatar';
import { StatusIndicator } from '../StatusIndicator';
import { Button } from '../Button/Button';
import { UpdateStatusModal } from '../../AppSidebar/UpdateStatusModal';
import { isStatusExpired, formatExpiryTime } from '../../../utils/statusUtils';
import { cn } from '../../../utils/classNames';
import { queries } from '../../../zero/queries';
import { useUsers, useUser } from '../../../hooks/useUsers';
import { formatRelativeTimeProfile, formatAge } from '../../../utils/dateUtils';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';
import { channelService } from '../../../services/Chat/channelService';
import { useCallActions } from '../../../hooks/useCallActions';
import { useAuth } from '../../../hooks/useAuth';
import { toast } from 'sonner';
import { useZero } from '../../../hooks/useZero';
import SearchUser from '../SearchUser/SearchUser';
import type { User } from '@xyne/shared';
import { CommonChannelsSection } from '../../UserProfile/CommonChannelsSection';
import { useUserPresence } from '../../../hooks/usePresence';

interface UserProfileProps {
  userId: string;
  className?: string;
  isOwnProfile: boolean;
}

export const UserProfile: React.FC<UserProfileProps> = ({ userId, className, isOwnProfile }) => {
  const zero = useZero();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  const [userProfile] = useCachedQuery(queries.getUserProfile({ userId }));
  const user = useUser(userId);
  // Get live presence status from Socket.IO (not stale Zero data)
  const { status: livePresenceStatus } = useUserPresence(userId);
  const users = useUsers();
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [dmChannelId, setDmChannelId] = useState<string | null>(null);
  const shouldTriggerCallRef = useRef(false);
  const managerUser = users?.find(u => u.id === userProfile?.manager);

  // Edit mode states
  const [editingField, setEditingField] = useState<
    'team' | 'phoneNumber' | 'dob' | 'manager' | null
  >(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Manager edit state
  const [selectedManagerUsers, setSelectedManagerUsers] = useState<User[]>([]);

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
    field: 'team' | 'phoneNumber' | 'dob',
    currentValue?: string | number | null,
  ): void => {
    setEditingField(field);
    setEditError(null);
    if (currentValue !== undefined && currentValue !== null) {
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

  const validateField = (field: 'team' | 'phoneNumber' | 'dob', value: string): boolean => {
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

    return true;
  };

  const handleSaveEdit = (): void => {
    if (!editingField || editingField === 'manager') return;

    if (!validateField(editingField, editValue)) {
      return;
    }

    const updateParams: {
      team?: string | null;
      phoneNumber?: string | null;
      dob?: number | null;
    } = {};

    if (editingField === 'team') {
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

  const statusEmoji = user?.presenceStatus?.statusEmoji;
  const statusContent = user?.presenceStatus?.statusContent;
  const statusExpiryAt = user?.presenceStatus?.statusExpiryAt;
  const hasStatus = statusEmoji && (!statusExpiryAt || !isStatusExpired(statusExpiryAt));

  if (!user) {
    return (
      <div className={cn('p-6', className)}>
        <div className='text-center text-gray-500'>User not found</div>
      </div>
    );
  }

  return (
    <div className={cn('bg-white rounded-lg shadow-sm border border-gray-200', className)}>
      {/* Header Section */}
      <div className='pt-2 px-6 pb-6 flex flex-col items-center'>
        <div className='relative mb-8'>
          <Avatar userId={user.id} size='big' className='rounded-xl' showActiveStatus={true} />
        </div>

        <div className='w-full'>
          <h2 className='text-2xl font-semibold text-gray-900 mb-1'>
            {userProfile?.displayName || user?.name || 'Unknown User'}
          </h2>

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
                  className='flex-1 px-2 py-1 text-lg border border-gray-300 rounded focus:outline-none focus:border-gray-400'
                />
                <button
                  onClick={handleSaveEdit}
                  className='p-1 text-green-600 hover:bg-green-50 rounded'
                  title='Save'
                >
                  <Check className='size-4' />
                </button>
                <button
                  onClick={handleCancelEdit}
                  className='p-1 text-gray-600 hover:bg-gray-100 rounded'
                  title='Cancel'
                >
                  <X className='size-4' />
                </button>
              </div>
              {editError && <p className='text-xs text-red-600'>{editError}</p>}
            </div>
          ) : userProfile?.team ? (
            <div className='flex items-center gap-2 mt-1'>
              <div className='text-lg text-gray-600'>{userProfile.team}</div>
              {isOwnProfile && (
                <button
                  onClick={() => handleStartEdit('team', userProfile.team)}
                  className='text-gray-400 hover:text-gray-600'
                  title='Edit team'
                >
                  <Edit2 className='size-3' />
                </button>
              )}
            </div>
          ) : isOwnProfile ? (
            <button
              onClick={() => handleStartEdit('team')}
              className='mt-1 text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1'
            >
              <span>+ Add Team Name</span>
            </button>
          ) : null}

          {/* Online/Away Status - Use live Socket.IO presence status */}
          {livePresenceStatus && (
            <div className='flex items-center gap-2 mt-2 text-sm text-gray-600'>
              {livePresenceStatus === 'ONLINE' ? (
                <div className='w-2 h-2 rounded-full bg-green-500' />
              ) : (
                <div className='w-2 h-2 rounded-full border border-gray-400' />
              )}
              <span className='capitalize'>
                {livePresenceStatus === 'ONLINE' ? 'Active' : livePresenceStatus.toLowerCase()}
              </span>
            </div>
          )}

          {/* Custom Status - Show for everyone if set */}
          {hasStatus && !isOwnProfile && (
            <div className='mt-2'>
              <div className='flex items-center gap-2 text-sm text-gray-700'>
                <span className='text-base'>{statusEmoji}</span>
                <span>{statusContent}</span>
              </div>
              {statusExpiryAt && (
                <div className='text-xs text-gray-500 mt-1'>
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
                className='flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-900 rounded-lg'
                variant='outline'
              >
                <MessageSquare className='size-4' />
                <span>Message</span>
              </Button>
              <Button
                onClick={handleHuddleClick}
                className='flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-900 rounded-lg'
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
                'px-2 py-2 rounded-lg border cursor-pointer hover:bg-gray-200 transition-colors w-full',
                hasStatus
                  ? 'border-gray-200 bg-transparent hover:bg-gray-100'
                  : 'border-gray-200 bg-gray-50',
              )}
              onClick={() => setIsStatusModalOpen(true)}
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
                        statusEmoji={user?.presenceStatus?.statusEmoji}
                        statusContent={user?.presenceStatus?.statusContent}
                        statusExpiryAt={user?.presenceStatus?.statusExpiryAt}
                        size='sm'
                        showOnHover={false}
                      />
                    </div>
                    <div className='text-xs font-medium text-gray-900 truncate'>
                      {user?.presenceStatus?.statusContent}
                    </div>
                  </div>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={handleClearStatus}
                    className='flex-shrink-0 p-1 h-auto hover:bg-gray-300 min-w-[20px]'
                    title='Clear status'
                  >
                    <X className='size-3 text-gray-600' />
                  </Button>
                </div>
              ) : (
                <div className='flex items-center gap-2 text-gray-600'>
                  <SmilePlus className='size-4 flex-shrink-0' />
                  <span className='text-sm truncate'>Update your status</span>
                </div>
              )}
            </div>
            {hasStatus && user?.presenceStatus?.statusExpiryAt && (
              <div className='text-xs text-gray-500'>
                {formatExpiryTime(user.presenceStatus.statusExpiryAt, true)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Divider */}
      <div className='mx-6 border-b border-gray-200' />

      {/* Manager Section */}
      {(managerUser || isOwnProfile) && (
        <div className='px-6 py-4'>
          <div className='flex items-center gap-2 mb-3'>
            <h3 className='text-sm font-semibold text-gray-900'>Manager</h3>
            {isOwnProfile && managerUser && editingField !== 'manager' && (
              <button
                onClick={() => {
                  setEditingField('manager');
                  setSelectedManagerUsers([managerUser]);
                }}
                className='text-gray-400 hover:text-gray-600'
                title='Edit manager'
              >
                <Edit2 className='size-3' />
              </button>
            )}
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
                />
              </div>
              <div className='flex justify-end gap-2'>
                <button
                  onClick={() => {
                    setEditingField(null);
                    setSelectedManagerUsers([]);
                  }}
                  className='px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800'
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const managerId =
                      selectedManagerUsers.length > 0
                        ? (selectedManagerUsers[0]?.id ?? null)
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
                <div className='text-sm font-medium text-gray-900'>{managerUser.name}</div>
              </div>
            </div>
          ) : isOwnProfile ? (
            <button
              onClick={() => {
                setEditingField('manager');
                setSelectedManagerUsers([]);
              }}
              className='text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1'
            >
              <span>+ Add Manager</span>
            </button>
          ) : null}
        </div>
      )}

      {/* Contact Information Section */}
      <div className='px-6 pb-4 pt-4'>
        <h3 className='text-sm font-semibold text-gray-900 mb-4'>Contact Information</h3>
        <div className='space-y-4'>
          {/* Email Address */}
          <div className='flex items-start gap-3'>
            <div className='p-2 bg-gray-100 rounded-lg flex-shrink-0'>
              <Mail className='size-4 text-gray-400' />
            </div>
            <div className='flex-1'>
              <div className='text-sm font-semibold text-gray-900 leading-tight'>Email Address</div>
              <div className='text-sm text-gray-800 mt-1'>{user.email}</div>
            </div>
          </div>

          {/* Phone Number */}
          {userProfile?.phoneNumber || isOwnProfile ? (
            <div className='flex items-start gap-3'>
              <div className='p-2 bg-gray-100 rounded-lg flex-shrink-0'>
                <Phone className='size-4 text-gray-400' />
              </div>
              <div className='flex-1'>
                <div className='text-sm font-semibold text-gray-900 leading-tight flex items-center gap-2'>
                  Phone Number
                  {isOwnProfile && userProfile?.phoneNumber && editingField !== 'phoneNumber' && (
                    <button
                      onClick={() => handleStartEdit('phoneNumber', userProfile.phoneNumber)}
                      className='text-gray-400 hover:text-gray-600'
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
                        className='flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-gray-400'
                      />
                      <button
                        onClick={handleSaveEdit}
                        className='p-1 text-green-600 hover:bg-green-50 rounded'
                        title='Save'
                      >
                        <Check className='size-4' />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className='p-1 text-gray-600 hover:bg-gray-100 rounded'
                        title='Cancel'
                      >
                        <X className='size-4' />
                      </button>
                    </div>
                    {editError && <p className='text-xs text-red-600'>{editError}</p>}
                  </div>
                ) : userProfile?.phoneNumber ? (
                  <div className='text-sm text-gray-800 mt-1'>{userProfile.phoneNumber}</div>
                ) : (
                  <button
                    onClick={() => handleStartEdit('phoneNumber')}
                    className='mt-1 text-sm text-blue-600 hover:text-blue-700'
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
              <div className='p-2 bg-gray-100 rounded-lg flex-shrink-0'>
                <Calendar className='size-4 text-gray-400' />
              </div>
              <div className='flex-1'>
                <div className='text-sm font-semibold text-gray-900 leading-tight'>Start Date</div>
                <div className='text-sm text-gray-800 mt-1'>
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
              <div className='p-2 bg-gray-100 rounded-lg flex-shrink-0'>
                <Cake className='size-4 text-gray-400' />
              </div>
              <div className='flex-1'>
                <div className='text-sm font-semibold text-gray-900 leading-tight flex items-center gap-2'>
                  Birth Date
                  {isOwnProfile && userProfile?.dob && editingField !== 'dob' && (
                    <button
                      onClick={() => handleStartEdit('dob', userProfile.dob)}
                      className='text-gray-400 hover:text-gray-600'
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
                        className='flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-gray-400'
                      />
                      <button
                        onClick={handleSaveEdit}
                        className='p-1 text-green-600 hover:bg-green-50 rounded'
                        title='Save'
                      >
                        <Check className='size-4' />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className='p-1 text-gray-600 hover:bg-gray-100 rounded'
                        title='Cancel'
                      >
                        <X className='size-4' />
                      </button>
                    </div>
                    {editError && <p className='text-xs text-red-600'>{editError}</p>}
                  </div>
                ) : userProfile?.dob ? (
                  <div className='text-sm text-gray-800 mt-1'>
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
                    className='mt-1 text-sm text-blue-600 hover:text-blue-700'
                  >
                    + Add Birth Date
                  </button>
                )}
              </div>
            </div>
          ) : null}
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
