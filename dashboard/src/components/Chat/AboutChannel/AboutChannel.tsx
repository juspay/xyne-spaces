import { ReactElement, useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useZero } from '../../../hooks/useZero';
import { Channel } from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
import Button from '../../ui/Button';
import { LucideSquarePen } from 'lucide-react';
import { formatDate } from '../../../utils/dateUtils';
import { useUser } from '../../../hooks/useUsers';
import { v4 as uuidv4 } from 'uuid';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';

export interface AboutChannelProps {
  channel: Channel;
  previousChannelId?: string | null;
  isParticipant: boolean;
  onClose?: () => void;
  isDM?: boolean;
  dmUserId?: string | undefined;
}

const AboutChannel = ({
  channel,
  isParticipant,
  onClose,
  isDM = false,
  dmUserId,
}: AboutChannelProps): ReactElement => {
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editDescription, setEditDescription] = useState(channel.description || '');
  const zero = useZero();
  const navigate = useNavigate();
  const location = useLocation();
  const { baseRoute } = useRouteContext();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createdByUser = useUser(channel.createdBy);
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

  return (
    <div className='flex flex-col h-[392px] bg-muted'>
      <div className='p-4 overflow-y-auto'>
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
