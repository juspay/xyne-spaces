import { Hash, Info, RefreshCw } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useRef, type Dispatch, type ReactElement, type SetStateAction } from 'react';
import Avatar from '../../components/ui/Avatar/Avatar';
import { Switch } from '../../components/ui/Switch';
import { Tooltip } from '../../components/ui/Tooltip/Tooltip';
import { cn } from '../../utils/classNames';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { MentionType } from '../../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import {
  LexicalSearchInput,
  type InitialQueryData,
} from '../../components/Chat/ChatDirectory/LexicalSearchInput';
import { GoogleCalendarIcon, MicrosoftIcon } from './CalendarIcons';
import type { CalendarProvider } from '../../services/clients/calendarApi';
import type { CalendarReauthCountdown, CalendarSyncMessage } from '../../utils/calendarSync';

interface CallHistorySearchPanelProps {
  calendarProvider: CalendarProvider | null;
  isSyncing: boolean;
  syncMessage: CalendarSyncMessage | null;
  reauthCountdown: CalendarReauthCountdown | null;
  onCalendarSync: () => void;
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
  showChannelCalls: boolean;
  setShowChannelCalls: (checked: boolean) => void;
  isMobile: boolean;
  currentUserId?: string;
}

export function CallHistorySearchPanel({
  calendarProvider,
  isSyncing,
  syncMessage,
  reauthCountdown,
  onCalendarSync,
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
  showChannelCalls,
  setShowChannelCalls,
  isMobile,
  currentUserId,
}: CallHistorySearchPanelProps): ReactElement {
  const insertMentionRef = useRef<
    ((item: { id: string; name: string; email?: string }) => void) | null
  >(null);

  return (
    <>
      <div className='flex items-center justify-between'>
        <h1 className='text-lg font-semibold text-foreground'>Calls</h1>
        <div className='flex items-center gap-2'>
          {calendarProvider && (
            <button
              onClick={onCalendarSync}
              disabled={isSyncing}
              data-track-category='CALLS'
              data-track-name='calendar-sync'
              title={`Sync ${calendarProvider === 'GOOGLE' ? 'Google' : 'Microsoft'} Calendar`}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-lg text-sm font-medium border transition-colors disabled:opacity-60',
                syncMessage?.reauth
                  ? 'border-destructive text-destructive hover:bg-destructive/10'
                  : 'border-border text-foreground hover:bg-muted',
              )}
            >
              {isSyncing ? (
                <RefreshCw className='size-3.5 animate-spin' />
              ) : calendarProvider === 'GOOGLE' ? (
                <GoogleCalendarIcon size={14} />
              ) : (
                <MicrosoftIcon size={14} />
              )}
              <span>
                {reauthCountdown ? (
                  <>
                    <span className='md:hidden'>{`Redirecting in ${reauthCountdown.count}s…`}</span>
                    <span className='hidden md:inline'>{`Need calendar access, redirecting for authorization in ${reauthCountdown.count}s…`}</span>
                  </>
                ) : syncMessage ? (
                  syncMessage.text
                ) : isSyncing ? (
                  'Syncing…'
                ) : (
                  <>
                    <span className='md:hidden'>Sync</span>
                    <span className='hidden md:inline'>{`Sync ${calendarProvider === 'GOOGLE' ? 'Google' : 'Microsoft'} Calendar`}</span>
                  </>
                )}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className='flex items-center justify-between gap-4'>
        <Popover.Root open={callMentionSearchType !== null} modal={false}>
          <Popover.Anchor asChild>
            <div className='relative flex-1 max-w-full md:max-w-[350px]'>
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
                className='min-h-10 w-full overflow-hidden rounded-xl border border-input bg-background pr-2 focus-within:ring-1 focus-within:ring-ring flex items-center [&>div]:w-full'
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
        <div className='flex items-center gap-3 shrink-0'>
          <label
            htmlFor='channel-calls-toggle'
            className='hidden md:block text-sm text-muted-foreground whitespace-nowrap cursor-pointer select-none'
          >
            Include all channel calls
          </label>
          <Switch
            id='channel-calls-toggle'
            checked={showChannelCalls}
            onCheckedChange={setShowChannelCalls}
          />
          <Tooltip content='Include all channel calls' side='bottom'>
            <button className='md:hidden text-muted-foreground flex items-center'>
              <Info className='size-4' />
            </button>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
