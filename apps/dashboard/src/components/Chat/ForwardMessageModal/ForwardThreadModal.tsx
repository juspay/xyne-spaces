import React, { useMemo, useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Hash, Lock, Users, X } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button/Button';
import { Combobox } from '../../ui/Combobox/Combobox';
import { DropdownListItemType } from '../../ui/Combobox/Combobox.types';
import { InputBox } from '../../ui/InputBox';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import { useAllChannels, useChannelSearch } from '../../../hooks/useChannels';
import { useUsers } from '../../../hooks/useUsers';
import { useSelf } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { channelService } from '../../../services/Chat/channelService';
import { useNavigate } from 'react-router-dom';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { parseDMParticipantIds } from '../ChatDirectory/ChatDirectory.utils';
import { ForwardTarget, SelectionMode } from './ForwardMessageModal.types';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { formatRelativeTimestamp } from '../../../utils/dateUtils';

type ThreadMessage = {
  messageId: string;
  senderId: string;
  content: string;
  createdAt: number;
  attachments?: readonly unknown[];
};

interface ForwardThreadFormProps {
  conversationId: string;
  channelId: string;
  messages: readonly ThreadMessage[];
  onCancel: () => void;
  onSuccess?: () => void;
}

export const ForwardThreadForm: React.FC<ForwardThreadFormProps> = ({
  conversationId,
  messages,
  onCancel,
  onSuccess,
}) => {
  const zero = useZero();
  const navigate = useNavigate();
  const currentUser = useSelf();
  const allUsers = useUsers();
  const allChannels = useAllChannels();
  const inputBoxRef = useRef<InputBoxHandle>(null);
  const [selectedTargets, setSelectedTargets] = useState<ForwardTarget[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [comboboxOpen, setComboboxOpen] = useState(true);
  const channelsSuggestions = useChannelSearch(inputValue.trim(), 8);

  const form = useForm({
    defaultValues: { optionalMessageHtml: '', optionalMessageText: '' },
    onSubmit: async ({ value }) => {
      const firstTarget = selectedTargets[0];
      if (!firstTarget) return;

      let targetChannelId = firstTarget.id;
      if (firstTarget.type !== 'channel') {
        const userIds =
          firstTarget.type === 'group_dm'
            ? [
                ...(firstTarget.memberIds ?? []),
                ...selectedTargets.filter(t => t.type === 'user').map(t => t.id),
              ]
            : selectedTargets.map(t => t.id);
        const dm = await channelService.createDm({ participantIds: userIds });
        targetChannelId = dm.id;
      }

      const destinationConversationId = uuidv4();
      const destinationMessageId = uuidv4();
      zero.mutate(
        mutators.conversations.forwardThread({
          sourceConversationId: conversationId,
          targetChannelId,
          optionalMessage: value.optionalMessageText.trim()
            ? value.optionalMessageHtml
            : undefined,
          conversationId: destinationConversationId,
          messageId: destinationMessageId,
          timestamp: Date.now(),
        }),
      );

      toast.success('Thread forwarded');
      onSuccess?.();
      void navigate(`/chat/dir/${targetChannelId}`);
    },
  });

  const selectedUserIds = useMemo(
    () => new Set(selectedTargets.filter(t => t.type === 'user').map(t => t.id)),
    [selectedTargets],
  );
  const selectionMode: SelectionMode = useMemo(() => {
    if (selectedTargets.length === 0) return 'none';
    const first = selectedTargets[0];
    if (first?.type === 'channel') return 'channel';
    if (first?.type === 'group_dm') return 'group_dm';
    return 'users';
  }, [selectedTargets]);

  const dropdownListItems: DropdownListItemType[] = useMemo(() => {
    const query = inputValue.trim().toLowerCase();
    const users = allUsers
      .filter(user => {
        if (selectedUserIds.has(user.id)) return false;
        if (user.id === currentUser?.id && selectionMode !== 'none') return false;
        const label = `${user.name ?? ''} ${user.displayName ?? ''} ${user.email ?? ''}`.toLowerCase();
        return !query || label.includes(query);
      })
      .slice(0, 8)
      .map(user => ({
        leftSlot: <Avatar userId={user.id} size='sm' />,
        label: user.id === currentUser?.id ? `${getUserDisplayName(user)} (You)` : getUserDisplayName(user),
        description: user.email,
        value: user.id,
      }));

    const channels = channelsSuggestions
      .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
      .slice(0, 8)
      .map(channel => ({
        leftSlot:
          channel.visibility === ChannelVisibility.PUBLIC ? (
            <Hash className='w-3.5 h-3.5 text-muted-foreground' />
          ) : (
            <Lock className='w-3.5 h-3.5 text-muted-foreground' />
          ),
        label: channel.name,
        value: channel.id,
      }));

    const groupDms = allChannels
      .filter(channel => channel.scopeType === ChannelScopeType.GROUP_DM)
      .filter(channel => !query || channel.name.toLowerCase().includes(query))
      .slice(0, 5)
      .map(channel => ({
        leftSlot: <Users className='w-3.5 h-3.5 text-muted-foreground' />,
        label: 'Group DM',
        value: channel.id,
      }));

    if (selectionMode === 'channel') return channels;
    if (selectionMode === 'users' || selectionMode === 'group_dm') return users;
    return [...users, ...groupDms, ...channels];
  }, [allChannels, allUsers, channelsSuggestions, currentUser?.id, inputValue, selectedUserIds, selectionMode]);

  const handleValueChange = (selectedValue: string | null) => {
    if (!selectedValue) return;
    const selectedUser = allUsers.find(user => user.id === selectedValue);
    if (selectedUser) {
      setSelectedTargets(prev => [
        ...prev,
        { type: 'user', id: selectedUser.id, name: getUserDisplayName(selectedUser) },
      ]);
      setInputValue('');
      return;
    }

    const selectedChannel = allChannels.find(channel => channel.id === selectedValue);
    if (!selectedChannel) return;
    if (selectedChannel.scopeType === ChannelScopeType.GROUP_DM) {
      setSelectedTargets([
        {
          type: 'group_dm',
          id: selectedChannel.id,
          name: 'Group DM',
          memberIds: parseDMParticipantIds(selectedChannel).filter(id => id !== currentUser?.id),
        },
      ]);
    } else {
      setSelectedTargets([{ type: 'channel', id: selectedChannel.id, name: selectedChannel.name }]);
    }
    setInputValue('');
  };

  const rootMessage = messages[0];
  const previewMessages = messages.slice(0, 4);
  const attachmentCount = messages.reduce((sum, msg) => sum + (msg.attachments?.length ?? 0), 0);

  return (
    <form
      data-testid='forward-thread-form'
      onSubmit={event => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className='flex items-center justify-between px-6 pt-6 pb-4 border-b border-border'>
        <h2 className='text-lg font-semibold text-foreground'>Forward thread</h2>
        <button type='button' onClick={onCancel} className='rounded-sm opacity-70 hover:opacity-100'>
          <X className='h-4 w-4' />
        </button>
      </div>

      <div className='px-6 py-4 space-y-4'>
        {selectedTargets.length > 0 && (
          <div className='flex flex-wrap gap-2'>
            {selectedTargets.map(target => (
              <Badge key={target.id} variant='primary' className='flex items-center gap-1.5 pr-1'>
                <span className='text-xs'>{target.name}</span>
                <button
                  type='button'
                  onClick={() => setSelectedTargets(prev => prev.filter(t => t.id !== target.id))}
                  aria-label={`Remove ${target.name}`}
                >
                  <X className='h-3 w-3' />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <Combobox
          label='Forward to'
          onInputValueChange={setInputValue}
          onValueChange={handleValueChange}
          queryString={inputValue}
          placeholder={selectionMode === 'none' ? 'Search channels or users...' : 'Add more users...'}
          items={dropdownListItems}
          value={null}
          hintText='Select a channel or one or more users to forward this thread'
          open={comboboxOpen}
          onOpenChange={setComboboxOpen}
          autoHighlight
        />

        <div>
          <label className='block text-sm font-medium text-foreground mb-1.5'>Add a message (optional)</label>
          <InputBox
            ref={inputBoxRef}
            id='forward-thread-optional'
            placeholder='Add a note to the forwarded thread...'
            onSendMessage={() => {}}
            onContentChange={(html: string, text: string) => {
              form.setFieldValue('optionalMessageHtml', html);
              form.setFieldValue('optionalMessageText', text);
            }}
            features={{ richText: true, mentions: false, commands: false, fileAttachments: false, emojiPicker: true }}
            showTypingIndicator={false}
            hideSendButton
          />
        </div>

        <div>
          <span className='block text-sm font-medium text-foreground mb-1.5'>Thread preview</span>
          <div className='bg-muted rounded-md p-3 border border-border max-h-[220px] overflow-y-auto space-y-2'>
            <p className='text-xs text-muted-foreground'>
              {messages.length} {messages.length === 1 ? 'message' : 'messages'}
              {attachmentCount > 0 ? ` · ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}` : ''}
            </p>
            {previewMessages.map(msg => (
              <div key={msg.messageId} className='border-l-2 border-border pl-2'>
                <div className='flex items-center gap-2 mb-0.5'>
                  <Avatar userId={msg.senderId} size='sm' />
                  <span className='text-xs text-muted-foreground'>{formatRelativeTimestamp(msg.createdAt)}</span>
                </div>
                {msg.content && <RenderMessageWithHTML message={msg.content} />}
              </div>
            ))}
            {rootMessage && messages.length > previewMessages.length && (
              <p className='text-xs text-muted-foreground'>
                +{messages.length - previewMessages.length} more replies will be linked from the original thread
              </p>
            )}
          </div>
        </div>

        <div className='flex justify-end gap-3 pt-2'>
          <Button variant='secondary' type='button' onClick={onCancel}>
            Cancel
          </Button>
          <Button type='submit' disabled={selectedTargets.length === 0 || form.state.isSubmitting}>
            {form.state.isSubmitting ? 'Forwarding...' : 'Forward'}
          </Button>
        </div>
      </div>
    </form>
  );
};

export default ForwardThreadForm;
