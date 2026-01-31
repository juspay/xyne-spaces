import { ReactElement, useState, useRef, useEffect } from 'react';
import { useZero } from '@rocicorp/zero/react';
import { Channel } from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
import Button from '../../ui/Button';
import { LucideSquarePen } from 'lucide-react';
import { formatDate } from '../../../utils/dateUtils';
import { useUser } from '../../../hooks/useUsers';
import { v4 as uuidv4 } from 'uuid';

export interface AboutChannelProps {
  channel: Channel;
  previousChannelId?: string | null;
  isParticipant: boolean;
  onClose?: () => void;
}

const AboutChannel = ({ channel, isParticipant }: AboutChannelProps): ReactElement => {
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editDescription, setEditDescription] = useState(channel.description || '');
  const zero = useZero();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createdByUser = useUser(channel.createdBy);

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
    <div className='flex flex-col h-[392px] bg-[#FAFAFA]'>
      <div className='p-4 overflow-y-auto'>
        <div className='relative bg-white p-[12px] rounded-[12px] border border-[#F2F2F3]'>
          <div className='flex flex-col gap-y-2'>
            <div className='flex items-start justify-between'>
              <p className='text-sm font-medium text-[#181B1D]'>Description</p>
            </div>
            {isEditingDescription ? (
              <div>
                <textarea
                  ref={textareaRef}
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className='w-full mt-2 p-2 text-sm border border-[#E4E6E7] rounded-[8px] resize-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent'
                  rows={3}
                  placeholder='Add a description...'
                />
                <div className='flex gap-1 mt-2 justify-end'>
                  <Button variant='ghost' size='sm' onClick={handleCancelEdit}>
                    Cancel
                  </Button>
                  <Button variant='ghost' size='sm' onClick={handleSaveDescription}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <p className='text-sm text-[#505B62]'>
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
            >
              <LucideSquarePen size={12} color='#505B62' />
            </Button>
          )}
        </div>
        <div className='text-[14px] text-[#505B62] py-4'>
          Created By <span className='text-[#0269B3]'>{createdByUser?.name || 'Unknown'}</span> on{' '}
          {formatDate(channel.createdAt)}
        </div>
      </div>
      <div className='mt-auto p-[12px] text-[12px] flex items-center justify-center text-[#788187] font-light border-t border-[#F2F2F3]'>
        Channel ID: {channel.id}
      </div>
    </div>
  );
};

export default AboutChannel;
