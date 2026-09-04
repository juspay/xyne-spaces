import { logger, Event as LogEvent } from '../../../utils/logger';
import { ReactElement, useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useZero } from '../../../hooks/useZero';
import {
  Channel,
  ChannelRole,
  ChannelScopeType,
  normalizeChannelName,
  validateChannelName,
} from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
import Button from '../../ui/Button';
import { LucideSquarePen } from 'lucide-react';
import { formatDate } from '../../../utils/dateUtils';
import { useUser } from '../../../hooks/useUsers';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { v4 as uuidv4 } from 'uuid';
import { channelService } from '../../../services/Chat/channelService';
import { toast } from 'sonner';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';

export interface AboutChannelProps {
  channel: Channel;
  previousChannelId?: string | null;
  isParticipant: boolean;
  onClose?: () => void;
  userRole?: ChannelRole | null;
  initialEditingName?: boolean;
  isDM?: boolean;
  dmUserId?: string | undefined;
}

const AboutChannel = ({
  channel,
  isParticipant,
  userRole,
  initialEditingName = false,
  onClose,
  isDM = false,
  dmUserId,
}: AboutChannelProps): ReactElement => {
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editDescription, setEditDescription] = useState(channel.description || '');
  const [isEditingName, setIsEditingName] = useState(initialEditingName);
  const [editName, setEditName] = useState(channel.name);
  const [nameError, setNameError] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const zero = useZero();
  const navigate = useNavigate();
  const location = useLocation();
  const { baseRoute } = useRouteContext();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const createdByUser = useUser(channel.createdBy);
  const { userID } = useAuthContextValues();
  const currentUser = useUser(userID || '');

  const isDefaultChannel = channel.scopeType === ChannelScopeType.DEFAULT;
  const isAdmin = userRole === ChannelRole.ADMIN;
  const canRename = isParticipant && isAdmin && isDefaultChannel;
  const dmUser = useUser(dmUserId || '');

  const profilePath = `${baseRoute}/${channel.id}/profile/${dmUserId}`;
  const isProfileAlreadyOpen = location.pathname === profilePath;

  const handleViewProfile = (): void => {
    // flushSync ensures the dialog close state is synchronously committed to the
    // DOM before navigation fires, preventing the flicker caused by the race
    // between the React state update and the route change.
    flushSync(() => {
      onClose?.();
    });
    if (!isProfileAlreadyOpen) {
      void navigate(profilePath);
    }
  };

  const handleEditDescription = (): void => {
    setIsEditingDescription(true);
    setEditDescription(channel.description || '');
  };

  const handleSaveDescription = async (): Promise<void> => {
    if (!channel) return;

    if (editDescription === channel.description) {
      setIsEditingDescription(false);
      return;
    }

    try {
      setIsSavingDescription(true);
      const result = await zero.mutate(
        mutators.channel.updateDescription({
          channelId: channel.id,
          description: editDescription.trim(),
          messageId: uuidv4(),
          conversationId: uuidv4(),
          timestamp: Date.now(),
          conversationParticipantId: uuidv4(),
        }),
      ).server;
      if (result.type === 'error') {
        throw new Error(result.error.message || 'Failed to update description');
      }
      setIsEditingDescription(false);
      toast.success(`Channel description updated`);
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Failed to update channel description:'),
        error: error,
      });
      toast.error('Failed to update channel description. Please try again.');
    } finally {
      setIsSavingDescription(false);
    }
  };

  const handleCancelEdit = (): void => {
    setIsEditingDescription(false);
    setEditDescription(channel.description || '');
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSaveDescription();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  // Auto-focus textarea when editing starts
  useEffect(() => {
    if (isEditingDescription && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length,
      );
    }
  }, [isEditingDescription]);

  // ----- Name editing -----

  const validateName = (value: string): string => validateChannelName(value) ?? '';

  const handleEditName = (): void => {
    setIsEditingName(true);
    setEditName(channel.name);
    setNameError('');
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const formatted = normalizeChannelName(e.target.value);
    setEditName(formatted);
    setNameError(validateName(formatted));
  };

  const handleSaveName = async (): Promise<void> => {
    const trimmed = editName.trim();
    const error = validateName(trimmed);
    if (error) {
      setNameError(error);
      return;
    }

    if (trimmed === channel.name) {
      setIsEditingName(false);
      return;
    }

    setIsSavingName(true);
    try {
      // Check for duplicate name before committing the optimistic mutation
      const { isDuplicate } = await channelService.checkDuplicateChannel(trimmed);
      if (isDuplicate) {
        setNameError(`A channel named "#${trimmed}" already exists`);
        setIsSavingName(false);
        return;
      }

      const result = await zero.mutate(
        mutators.channel.renameChannel({
          channelId: channel.id,
          name: trimmed,
          messageId: uuidv4(),
          conversationId: uuidv4(),
          timestamp: Date.now(),
          conversationParticipantId: uuidv4(),
        }),
      ).server;
      if (result.type === 'error') {
        throw new Error(result.error.message || 'Failed to rename channel');
      }
      setIsEditingName(false);
      toast.success(`Channel renamed to #${trimmed}`);
    } catch (err) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Failed to rename channel:'),
        error: err,
      });
      toast.error('Failed to rename channel. Please try again.');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleCancelNameEdit = (): void => {
    setIsEditingName(false);
    setEditName(channel.name);
    setNameError('');
  };

  const handleNameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSaveName();
    } else if (e.key === 'Escape') {
      handleCancelNameEdit();
    }
  };

  // Auto-focus name input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  return (
    <div className='flex flex-col h-full'>
      <div className='p-4 overflow-y-auto'>
        {/* Channel Name */}
        {canRename && (
          <div className='relative bg-card p-[12px] rounded-[12px] border border-border mb-3'>
            <div className='flex flex-col gap-y-2'>
              <div className='flex items-start justify-between'>
                <p className='text-sm font-medium text-foreground'>Channel Name</p>
              </div>
              {isEditingName ? (
                <div>
                  <input
                    ref={nameInputRef}
                    type='text'
                    value={editName}
                    onChange={handleNameChange}
                    onKeyDown={handleNameKeyDown}
                    className='w-full mt-1 p-2 text-sm border border-border rounded-[8px] bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent'
                    placeholder='channel-name'
                    maxLength={80}
                    data-track-event='blur'
                    data-track-category='ABOUT_CHANNEL_FORM'
                    data-track-name='Edit_Name_Input'
                    data-track-metadata={JSON.stringify({ channelId: channel?.id })}
                  />
                  {nameError && <p className='text-xs text-destructive mt-1'>{nameError}</p>}
                  <div className='flex gap-1 mt-2 justify-end'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={handleCancelNameEdit}
                      data-track-category='ABOUT_CHANNEL_FORM'
                      data-track-name='Cancel_Edit_Name'
                      data-track-metadata={JSON.stringify({ channelId: channel?.id })}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => void handleSaveName()}
                      disabled={!!nameError || isSavingName}
                      data-track-category='ABOUT_CHANNEL_FORM'
                      data-track-name='Save_Name'
                      data-track-metadata={JSON.stringify({ channelId: channel?.id })}
                    >
                      {isSavingName ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className='text-sm text-muted-foreground break-words'>#{channel.name}</p>
              )}
            </div>

            {canRename && !isEditingName && (
              <Button
                className='absolute right-0 top-0'
                variant='ghost'
                size='sm'
                onClick={handleEditName}
                data-track-category='ABOUT_CHANNEL_FORM'
                data-track-name='Edit_Name'
                data-track-metadata={JSON.stringify({ channelId: channel?.id })}
              >
                <LucideSquarePen size={12} className='text-muted-foreground' />
              </Button>
            )}
          </div>
        )}

        {/* Description */}
        {/* Description */}
        <div className='relative bg-card p-[12px] rounded-[12px] border border-border mb-3 break-words'>
          <div className='flex flex-col gap-y-2'>
            <div className='flex items-start justify-between'>
              <p className='text-sm font-medium text-foreground'>Description</p>
            </div>
            {isEditingDescription ? (
              <div>
                <textarea
                  ref={textareaRef}
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className='w-full mt-2 p-2 text-sm border border-border rounded-[8px] bg-background text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent'
                  rows={3}
                  placeholder='Add a description...'
                  data-track-event='blur'
                  data-track-category='ABOUT_CHANNEL_FORM'
                  data-track-name='Edit_Description_Input'
                  data-track-metadata={JSON.stringify({ channelId: channel?.id })}
                />
                <div className='flex gap-1 mt-2 justify-end'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={handleCancelEdit}
                    data-track-category='ABOUT_CHANNEL_FORM'
                    data-track-name='Cancel_Edit_Description'
                    data-track-metadata={JSON.stringify({ channelId: channel?.id })}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => void handleSaveDescription()}
                    data-track-category='ABOUT_CHANNEL_FORM'
                    data-track-name='Save_Description'
                    data-track-metadata={JSON.stringify({ channelId: channel?.id })}
                  >
                    {isSavingDescription ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {isDM && dmUser
                  ? `Direct message between ${getUserDisplayName(currentUser)} and ${getUserDisplayName(dmUser)}`
                  : channel.description || 'No description set'}
              </p>
            )}
          </div>

          {isParticipant && !isEditingDescription && (
            <Button
              className='absolute right-0 top-0'
              variant='ghost'
              size='sm'
              onClick={handleEditDescription}
              data-track-category='ABOUT_CHANNEL_FORM'
              data-track-name='Edit_Description'
              data-track-metadata={JSON.stringify({ channelId: channel?.id })}
            >
              <LucideSquarePen size={12} className='text-muted-foreground' />
            </Button>
          )}
        </div>

        {/* Email + View full profile — only for 1:1 DMs */}
        {isDM && dmUserId && (
          <div className='bg-card rounded-[12px] border border-border overflow-hidden'>
            <div className='p-[12px]'>
              <p className='text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5'>
                Email
              </p>
              <p className='text-sm text-foreground'>{dmUser?.email || '—'}</p>
            </div>
            <button
              onClick={handleViewProfile}
              className='px-[12px] pb-[10px] text-xs font-sans font-semibold text-muted-foreground underline text-left hover:text-foreground transition-colors'
              data-track-category='ABOUT_CHANNEL_FORM'
              data-track-name='View_Full_Profile'
              data-track-metadata={JSON.stringify({ channelId: channel?.id, userId: dmUserId })}
            >
              View full profile
            </button>
          </div>
        )}

        {/* Created-by line — hidden for 1:1 DMs; shown for group DMs and channels */}
        {!isDM && (
          <div className='text-[14px] text-muted-foreground py-4 text-center'>
            Created By <span className='text-primary'>{getUserDisplayName(createdByUser)}</span> on{' '}
            <span className='visual-regression-hide'>{formatDate(channel.createdAt)}</span>
          </div>
        )}
      </div>
      <div className='mt-auto p-[12px] text-[12px] flex items-center justify-center text-muted-foreground font-light border-t border-border visual-regression-hide'>
        Channel ID: {channel.id}
      </div>
    </div>
  );
};

export default AboutChannel;
