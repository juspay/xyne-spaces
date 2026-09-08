import { Hashtag as Hash } from '@xyne/icons';
import * as Popover from '@radix-ui/react-popover';
import { useRef, type Dispatch, type ReactElement, type SetStateAction } from 'react';
import Avatar from '../../components/ui/Avatar/Avatar';
import { Button } from '../../components/ui/Button/Button';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { cn } from '../../utils/classNames';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { MentionType } from '../../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import {
  LexicalSearchInput,
  type InitialQueryData,
} from '../../components/Chat/ChatDirectory/LexicalSearchInput';

interface CallHistorySearchPanelProps {
  callMentionSearchType: MentionType | null;
  callMentionSearchQuery: string;
  callSearchSelectedMentions: Array<{
    id: string;
    type: MentionType;
    prefix?: string;
    name?: string;
  }>;
  callSearchInitialQuery: InitialQueryData | null;
  filteredUserMentionResults: Array<{ id: string; name: string; email?: string }>;
  channelMentionResults: Array<{ id: string; name?: string }>;
  selectedMentionIndex: number;
  setSelectedMentionIndex: Dispatch<SetStateAction<number>>;
  hasNavigatedMentions: boolean;
  setHasNavigatedMentions: Dispatch<SetStateAction<boolean>>;
  onInsertMentionReady: (
    insertMention: (item: { id: string; name: string; email?: string }) => void,
  ) => void;
  closeCallMentionSearch: () => void;
  handleCallSearchChange: (
    text: string,
    mentions: Array<{ id: string; type: MentionType; prefix?: string }>,
  ) => void;
  handleCallUserSearch: (query: string | null) => void;
  handleCallChannelSearch: (query: string | null) => void;
  isMobile: boolean;
  currentUserId?: string;
  onOpenAskAI: () => void;
}

export function CallHistorySearchPanel({
  callMentionSearchType,
  callMentionSearchQuery,
  callSearchSelectedMentions,
  callSearchInitialQuery,
  filteredUserMentionResults,
  channelMentionResults,
  selectedMentionIndex,
  setSelectedMentionIndex,
  hasNavigatedMentions,
  setHasNavigatedMentions,
  onInsertMentionReady,
  closeCallMentionSearch,
  handleCallSearchChange,
  handleCallUserSearch,
  handleCallChannelSearch,
  isMobile,
  currentUserId,
  onOpenAskAI,
}: CallHistorySearchPanelProps): ReactElement {
  const insertMentionRef = useRef<
    ((item: { id: string; name: string; email?: string }) => void) | null
  >(null);

  return (
    <>
      <div className='mb-6 flex items-center justify-between'>
        <h1 className='m-0 text-3xl font-semibold leading-none tracking-tight text-foreground'>
          Calls V2
        </h1>
        <Button
          type='button'
          variant='outline'
          onClick={onOpenAskAI}
          className='h-9 gap-1.5 whitespace-nowrap rounded-xl border-border px-4 font-semibold hover:bg-muted/70'
          data-track-category='CALLS'
          data-track-name='open_ask_ai'
        >
          <XyneAIStar size={15} />
          Ask AI
        </Button>
      </div>

      <div className='mb-3.5'>
        <Popover.Root open={callMentionSearchType !== null} modal={false}>
          <Popover.Anchor asChild>
            <div className='relative w-full'>
              <LexicalSearchInput
                {...(!callMentionSearchQuery ? { value: '' } : {})}
                initialQuery={callSearchInitialQuery}
                placeholder={
                  callSearchSelectedMentions.length ? '' : 'Search title, @user, #channel'
                }
                onChange={handleCallSearchChange}
                onUserSearch={handleCallUserSearch}
                onChannelSearch={handleCallChannelSearch}
                availableUsers={filteredUserMentionResults.map(candidate => ({
                  id: candidate.id,
                  name: getUserDisplayName(candidate),
                  ...(candidate.email ? { email: candidate.email } : {}),
                }))}
                availableChannels={channelMentionResults.map(channel => ({
                  id: channel.id,
                  name: channel.name || channel.id,
                }))}
                mentionSearchType={callMentionSearchType}
                selectedMentionIndex={selectedMentionIndex}
                setSelectedMentionIndex={setSelectedMentionIndex}
                onNavigate={() => setHasNavigatedMentions(true)}
                hasNavigated={hasNavigatedMentions}
                onInsertMentionReady={insertMention => {
                  insertMentionRef.current = insertMention;
                  onInsertMentionReady(insertMention);
                }}
                onMentionInserted={closeCallMentionSearch}
                open={true}
                disableAutoFocus={isMobile}
                {...(currentUserId ? { currentUserID: currentUserId } : {})}
                className='min-h-10 w-full overflow-hidden rounded-xl border border-border bg-background pr-3 focus-within:ring-1 focus-within:ring-ring flex items-center [&>div]:w-full'
              />
            </div>
          </Popover.Anchor>
          <Popover.Portal>
            <Popover.Content
              side='bottom'
              align='start'
              sideOffset={4}
              collisionPadding={8}
              onOpenAutoFocus={e => e.preventDefault()}
              onInteractOutside={closeCallMentionSearch}
              onEscapeKeyDown={closeCallMentionSearch}
              className='z-[9999] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-md border border-border bg-popover shadow-lg'
            >
              {callMentionSearchType === MentionType.USER ? (
                filteredUserMentionResults.length > 0 ? (
                  <ul className='max-h-64 overflow-y-auto py-1'>
                    {filteredUserMentionResults.map((candidate, index) => (
                      <li key={candidate.id}>
                        <button
                          type='button'
                          className={cn(
                            'flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                            index === selectedMentionIndex &&
                              hasNavigatedMentions &&
                              'bg-accent text-accent-foreground',
                          )}
                          data-track-category='CALLS'
                          data-track-name='call-search-select-user-filter'
                          onMouseEnter={() => {
                            setSelectedMentionIndex(index);
                            setHasNavigatedMentions(true);
                          }}
                          onClick={() => {
                            insertMentionRef.current?.({
                              id: candidate.id,
                              name: getUserDisplayName(candidate),
                              ...(candidate.email ? { email: candidate.email } : {}),
                            });
                          }}
                        >
                          <Avatar userId={candidate.id} size='sm' showActiveStatus={false} />
                          <span className='flex min-w-0 flex-col'>
                            <span className='truncate font-medium'>
                              {getUserDisplayName(candidate)}
                            </span>
                            <span className='truncate text-xs text-muted-foreground'>
                              {candidate.email}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className='px-3 py-3 text-sm text-muted-foreground'>No users found</div>
                )
              ) : callMentionSearchType === MentionType.CHANNEL ? (
                channelMentionResults.length > 0 ? (
                  <ul className='max-h-64 overflow-y-auto py-1'>
                    {channelMentionResults.map((channel, index) => (
                      <li key={channel.id}>
                        <button
                          type='button'
                          className={cn(
                            'flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                            index === selectedMentionIndex &&
                              hasNavigatedMentions &&
                              'bg-accent text-accent-foreground',
                          )}
                          data-track-category='CALLS'
                          data-track-name='call-search-select-channel-filter'
                          onMouseEnter={() => {
                            setSelectedMentionIndex(index);
                            setHasNavigatedMentions(true);
                          }}
                          onClick={() => {
                            insertMentionRef.current?.({
                              id: channel.id,
                              name: channel.name || channel.id,
                            });
                          }}
                        >
                          <Hash className='size-4 shrink-0 text-muted-foreground' />
                          <span className='truncate font-medium'>{channel.name || channel.id}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className='px-3 py-3 text-sm text-muted-foreground'>No channels found</div>
                )
              ) : null}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </>
  );
}
