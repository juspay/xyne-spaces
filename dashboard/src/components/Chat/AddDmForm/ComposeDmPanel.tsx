import { useZero } from '../../../hooks/useZero';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { User } from '@xyne/shared';
import { CircleAlert } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import { usePlatform } from '../../../hooks/usePlatform';
import { useUserSearch } from '../../../hooks/useUsers';
import {
  EVENT_PROPERTIES,
  EVENTS,
  mixpanelService,
} from '../../../services/Analytics/mixpanelService';
import { channelService, CreateDmRequest } from '../../../services/Chat/channelService';
import { cn } from '../../../utils/classNames';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { InputBox } from '../../ui/InputBox';
import { SearchUserV2 } from '../../ui/SearchUser/SearchUserV2';
import ChatListV2 from '../ChatList/ChatListV2';
import { useExistingDmChannel } from './useExistingDmChannel';

export interface CreateDmFormData {
  participants: User[];
  message: string;
}

export const ComposeDmPanel: React.FC = () => {
  const [searchValue, setSearchValue] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isSearchUserOpen, setIsSearchUserOpen] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const searchUserRef = useRef<HTMLInputElement>(null);
  const inputBoxRef = useRef<InputBoxHandle>(null);
  const context = useAuthContextValues();
  const { isMobile } = usePlatform();
  const navigate = useNavigate();
  const zero = useZero();

  // Focus search user input
  useEffect(() => {
    if (searchUserRef.current) {
      searchUserRef.current.focus();
      setIsSearchUserOpen(true);
    }
  }, [searchUserRef]);

  const createDmMutation = useMutation({
    mutationFn: (data: CreateDmRequest) => channelService.createDm(data),
    onSuccess: (response, variables) => {
      // Track group creation if more than 1 participant (excluding current user)
      const isGroupDm = variables.participantIds.length > 1;

      mixpanelService.track(EVENTS.INITIATE_ACTION, {
        type: isGroupDm
          ? EVENT_PROPERTIES.ACTION_TYPES.NEW_GROUP_DM
          : EVENT_PROPERTIES.ACTION_TYPES.NEW_DM,
        hasInitialMessage: !!variables.message,
      });

      // If existing DM was returned (might have been closed), reopen it
      if (response.isExisting) {
        zero.mutate(mutators.channel.reopenDm({ channelId: response.id }));
      }
      // Navigate to the DM channel
      void navigate(`/chat/dir/${response.id}`);
    },
  });

  const handleAddDmSubmit = (data: CreateDmFormData): void => {
    const dmRequest: CreateDmRequest = {
      participantIds: data.participants.map(user => user.id),
      ...(data.message && data.message.trim() && { message: data.message }),
    };
    createDmMutation.mutate(dmRequest);
  };

  const form = useForm({
    defaultValues: {
      message: '',
    },
    onSubmit: ({ value }) => {
      handleAddDmSubmit({
        participants: selectedUsers,
        message: value.message,
      });
    },
  });

  const handleUsersChange = (users: User[]): void => {
    setSelectedUsers(users);
  };

  const existingDmChannel = useExistingDmChannel(selectedUsers);

  const [latestMessage] = useCachedQuery(
    queries.channelLatestConversation({ channelId: existingDmChannel?.id ?? '' }),
    { enabled: !!existingDmChannel },
  );

  // Get users matching search query
  const searchResults = useUserSearch(searchValue, 10);

  // Filter and map users to items
  const filteredUsers = useMemo(() => {
    if (!searchResults) return [];

    return searchResults.filter(user => user.id !== context.userID);
  }, [searchResults, context.userID]);

  // Build chat list props
  const chatListProps = useMemo(() => {
    if (!existingDmChannel || !latestMessage) return null;
    return {
      channelId: existingDmChannel.id,
      initialItem: {
        conversationId: latestMessage.conversationId,
        createdAt: latestMessage.createdAt,
      },
      latestConversation: {
        conversationId: latestMessage.conversationId,
        createdAt: latestMessage.createdAt,
      },
      channelScopeType: existingDmChannel.scopeType,
    };
  }, [
    existingDmChannel?.id,
    existingDmChannel?.scopeType,
    latestMessage?.conversationId,
    latestMessage?.createdAt,
  ]);

  // dynamic conversation title
  const getConversationTitle = (): string => {
    if (selectedUsers.length === 0) return 'Select people to message';
    if (selectedUsers.length === 1) return `Message ${selectedUsers[0]?.name || 'Unknown'}`;
    if (selectedUsers.length <= 3) {
      return selectedUsers.map(u => u.name).join(', ');
    }
    const firstTwo = selectedUsers
      .slice(0, 2)
      .map(u => u.name)
      .join(', ');
    const remaining = selectedUsers.length - 2;
    return `${firstTwo} + ${remaining} others`;
  };

  // calculate message length ( 0/1000 chars)
  const getTextLength = (html: string): number => {
    const text = new DOMParser().parseFromString(html, 'text/html').body.textContent;
    return text?.length || 0;
  };

  return (
    <div className='pt-4 pb-2 relative h-full'>
      <form
        className='h-full'
        onSubmit={e => {
          e.preventDefault();
          e.stopPropagation();
          setHasAttemptedSubmit(true);
          void form.handleSubmit();
        }}
      >
        <div className='mx-auto bg-white h-full flex flex-col'>
          {/* Conversation Preview */}
          <div className='px-4'>
            <div className='text-base font-semibold text-foreground'>New Message</div>
            {selectedUsers.length > 0 ? (
              <div className='flex items-center gap-2 justify-between text-xs text-muted-foreground'>
                <div className='flex justify-between items-center gap-2 w-full'>
                  <span className='py-1'>{getConversationTitle()}</span>
                  {!isMobile && selectedUsers.length > 9 && (
                    <div className=' px-3 py-0.5 flex items-center gap-1.5 w-fix bg-red-50 border border-red-100 rounded-lg text-red-600'>
                      <CircleAlert className='size-3' strokeWidth={2.6} />
                      <span className='text-[10px]'>
                        Maximum 9 recipients allowed. Create a channel to add more.
                      </span>
                    </div>
                  )}
                </div>
                {/* Selected users as badges */}
                <span className='text-muted-foreground/70'>{selectedUsers.length}/9</span>
              </div>
            ) : (
              <div className='flex items-center justify-between text-xs text-muted-foreground'>
                <span className='py-1'>Select people to message</span>
                <span className='text-muted-foreground/70'>0/9</span>
              </div>
            )}
          </div>

          {/* User Search */}
          <div className='flex flex-col gap-1.5 flex-1'>
            <div className='space-y-1 px-2'>
              <SearchUserV2
                options={filteredUsers}
                selectedUsers={selectedUsers}
                onSelect={handleUsersChange}
                inputRef={searchUserRef}
                isOpen={isSearchUserOpen}
                setIsOpen={setIsSearchUserOpen}
                searchQuery={searchValue}
                onSearchChange={setSearchValue}
                // className='p-0'
              />
              {/* Validation errors */}
              {hasAttemptedSubmit && selectedUsers.length === 0 && (
                <div className='text-sm text-red-600'>
                  Please select at least one person to message
                </div>
              )}
              {isMobile && selectedUsers.length > 9 && (
                <div className=' px-4 py-1.5 flex items-center gap-1.5 w-full bg-red-50 border border-red-100 rounded-lg text-red-600'>
                  <CircleAlert className='size-3' strokeWidth={2.6} />
                  <span className='text-[10px]'>
                    Maximum 9 recipients allowed. Create a channel to add more.
                  </span>
                </div>
              )}
            </div>

            <div className='w-full border-b' />

            {chatListProps ? (
              <ChatListV2
                channelId={chatListProps.channelId}
                initialItem={chatListProps.initialItem}
                latestConversation={chatListProps.latestConversation}
                lastViewedAt={null}
                channelScopeType={chatListProps.channelScopeType}
              />
            ) : (
              <div className='flex-1' />
            )}

            {/* Message Input */}
            <form.Field
              name='message'
              validators={{
                onChange: ({ value }) => {
                  if (value.length > 1000) return 'Message must be 1000 characters or less';
                  return undefined;
                },
              }}
            >
              {field => (
                <div className='space-y-1.5 px-4'>
                  <InputBox
                    ref={inputBoxRef}
                    id='dm-message'
                    value={field.state.value}
                    placeholder='Say something to start the conversation...'
                    showTypingIndicator={false}
                    disabled={selectedUsers.length === 0 || selectedUsers.length > 9}
                    onContentChange={(html: string) => {
                      field.handleChange(html);
                    }}
                    onSendMessage={async () => {
                      if (form.state.isSubmitting) return;
                      await form.handleSubmit();
                    }}
                    features={{
                      richText: true,
                      mentions: true,
                      fileAttachments: true,
                      emojiPicker: true,
                    }}
                    className={cn(
                      field.state.meta.errors.length > 0 &&
                        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                    )}
                  />
                  <div className='flex items-center justify-between'>
                    {field.state.meta.errors.length > 0 && field.state.meta.errors[0] && (
                      <p className='text-xs text-red-600 text-nowrap'>
                        {field.state.meta.errors[0]}
                      </p>
                    )}
                    <span className='text-xs text-gray-500 w-full text-end'>
                      {`${getTextLength(field.state.value)}/1000 characters`}
                    </span>
                  </div>
                </div>
              )}
            </form.Field>
          </div>
        </div>
      </form>
    </div>
  );
};

export default ComposeDmPanel;
