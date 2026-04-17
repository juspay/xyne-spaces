import { ReactElement, useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useZero } from '../../../hooks/useZero';
import { Channel, ChannelRole, ChannelScopeType } from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
import Button from '../../ui/Button';
import { LucideSquarePen } from 'lucide-react';
import { formatDate } from '../../../utils/dateUtils';
import { useUser } from '../../../hooks/useUsers';
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
  onClose,
  userRole,
  initialEditingName = false,
  isDM = false,
  dmUserId,
}: AboutChannelProps): ReactElement => {
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editDescription, setEditDescription] = useState(channel.description || '');
  const [isEditingName, setIsEditingName] = useState(initialEditingName);
  const [editName, setEditName] = useState(channel.name);
  const [nameError, setNameError] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const zero = useZero();
  const navigate = useNavigate();
  const location = useLocation();
  const { baseRoute } = useRouteContext();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const createdByUser = useUser(channel.createdBy);
  const dmUser = useUser(dmUserId || '');

  const isDefaultChannel = channel.scopeType === ChannelScopeType.DEFAULT;
  const isAdmin = userRole === ChannelRole.ADMIN;
  const canRename = isParticipant && isAdmin && isDefaultChannel;

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

  const handleSaveDescription = (): void => {
    if (!channel) return;

    if (editDescription === channel.description) {
      setIsEditingDescription(false);
      return;
    }

    try {
      void zero.mutate(
        mutators.channel.updateDescription({
          channelId: channel.id,
          description: editDescription.trim(),
          messageId: uuidv4(),
          conversationId: uuidv4(),
          timestamp: Date.now(),
          conversationParticipantId: uuidv4(),
        }),
      );
      setIsEditingDescription(false);
    } catch (error) {
      console.error('Failed to update channel description:', error);
    }
  };

  const handleCancelEdit = (): void => {
    setIsEditingDescription(false);
    setEditDescription(channel.description || '');
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveDescription();
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

  const validateName = (value: string): string => {
    if (value.length < 2) return 'Channel name must be at least 2 characters';
    if (value.length > 80) return 'Channel name must be 80 characters or less';
    if (!/^[a-z0-9-]+$/.test(value))
      return 'Only lowercase letters, numbers, and hyphens are allowed';
    return '';
  };

  const handleEditName = (): void => {
    setIsEditingName(true);
    setEditName(channel.name);
    setNameError('');
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    // Convert spaces to hyphens and force lowercase, matching AddChannelForm behaviour
    const formatted = e.target.value.toLowerCase().replace(/\s+/g, '-');
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
      const { isDuplicate } = await channelService.checkDuplicateChannel(
        trimmed,
        channel.projectId,
      );
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
      console.error('Failed to rename channel:', err);
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
    <div className='flex flex-col h-[392px] bg-muted'>
      <div className='p-4 overflow-y-auto'>
        {/* Channel Name — only for default channels */}
        {isDefaultChannel && (
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
                    className='w-full mt-1 p-2 text-sm border border-border rounded-[8px] focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent'
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
                <p className='text-sm text-muted-foreground'>#{channel.name}</p>
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
        <div className='relative bg-card p-[12px] rounded-[12px] border border-border mb-3'>
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
                  className='w-full mt-2 p-2 text-sm border border-border rounded-[8px] resize-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent'
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
                    onClick={handleSaveDescription}
                    data-track-category='ABOUT_CHANNEL_FORM'
                    data-track-name='Save_Description'
                    data-track-metadata={JSON.stringify({ channelId: channel?.id })}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {channel.description || 'No description set'}
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

        <div className='text-[14px] text-muted-foreground py-4'>
          Created By <span className='text-primary'>{createdByUser?.name || 'Unknown'}</span> on{' '}
          <span className='visual-regression-hide'>{formatDate(channel.createdAt)}</span>
        </div>
      </div>
      <div className='mt-auto p-[12px] text-[12px] flex items-center justify-center text-muted-foreground font-light border-t border-border visual-regression-hide'>
        Channel ID: {channel.id}
      </div>
    </div>
  );
};

export default AboutChannel;
