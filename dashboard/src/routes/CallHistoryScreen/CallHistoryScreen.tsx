import {
  CalendarClock,
  CalendarDays,
  ChevronDown,
  LucideIcon,
  Megaphone,
  Phone,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { ReactElement, useEffect, useState, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useCallHistory } from './useCallHistory';
import { CallStatus } from '@xyne/shared';
import { logger, Event } from '../../utils/logger';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';
import { useLocation, useNavigate } from 'react-router-dom';
import { CallConfirmationModal } from '../../components/Call/CallConfirmationModal';
import { InstantCallModal } from '../../components/Call/InstantCallModal/InstantCallModal';
import { ScheduleCallModal } from '../../components/Call/ScheduleCallModal/ScheduleCallModal';
import Avatar from '../../components/ui/Avatar/Avatar';
import Button from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import Input from '../../components/ui/Input';
import { useAllChannels } from '../../hooks/useChannels';
import { useUsers } from '../../hooks/useUsers';
import { useZero } from '../../hooks/useZero';
import { cn } from '../../utils/classNames';
import { mutators } from '../../zero/mutators';
import { CallCard, UpcomingCallCard } from './CallCard';
import { Call } from './callHistoryItem.utils';
import { ParticipantsModal } from './ParticipantsModal';
import * as Tabs from '@radix-ui/react-tabs';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export type CallTabType = 'all' | 'upcoming' | 'missed';

const MAX_UPCOMING_CALLS_TO_SHOW = 3;

const CallHistoryScreen = (): ReactElement => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const allChannels = useAllChannels();
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isInstantCallModalOpen, setIsInstantCallModalOpen] = useState(false);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  const {
    calls,
    scheduledCalls,
    missedCalls,
    queryDetails,
    selectedCall,
    isParticipantsModalOpen,
    searchQuery,
    setSearchQuery,
    filteredUsers,
    selectedUsers,
    handleCallRowClick,
    handleParticipantsClick,
    handleRemoveUser,
    closeParticipantsModal,
    handleGotoTranscript,
    handleDownloadTranscript,
    showConfirmModal,
    confirmModalConfig,
    handleConfirmCall,
    closeConfirmModal,
    handleInstantCall,
    handleCancelCall,
  } = useCallHistory(user?.id);

  const zero = useZero();
  const callHistoryLoadStartTimeRef = useRef<number | null>(null);

  const endedCallsCount = calls?.filter(c => c.status === CallStatus.ENDED).length ?? 0;

  const searchParams = new URLSearchParams(location.search);
  const tabParam = searchParams.get('tab');
  const activeTab = (tabParam as CallTabType) || 'all';

  useEffect(() => {
    if (endedCallsCount === 0) return;

    void zero.mutate(mutators.activities.markMissedCallsAsRead({}));
  }, [endedCallsCount]);

  useEffect(() => {
    if (queryDetails.type === 'unknown') {
      callHistoryLoadStartTimeRef.current = Date.now();
    } else if (queryDetails.type === 'complete') {
      if (callHistoryLoadStartTimeRef.current !== null) {
        const duration = Date.now() - callHistoryLoadStartTimeRef.current;
        logger.info(Event.CALL_HISTORY_LOADED, {
          source: 'CallHistoryScreen',
          message: 'Call history loaded',
          durationMs: duration,
          url: window.location.href,
        });

        safeRecordMetric(() => {
          dataLoadDuration.record(duration, {
            source: 'CallHistoryScreen',
            event: Event.CALL_HISTORY_LOADED,
            platform: logger.platformName,
          });
        });

        callHistoryLoadStartTimeRef.current = null;
      }
    } else if (queryDetails.type === 'error') {
      if (callHistoryLoadStartTimeRef.current !== null) {
        const duration = Date.now() - callHistoryLoadStartTimeRef.current;
        logger.info(Event.CALL_HISTORY_LOADED, {
          source: 'CallHistoryScreen',
          message: 'Call history load failed',
          durationMs: duration,
          url: window.location.href,
        });

        safeRecordMetric(() => {
          dataLoadDuration.record(duration, {
            source: 'CallHistoryScreen',
            event: Event.CALL_HISTORY_LOADED,
            platform: logger.platformName,
          });
        });
        callHistoryLoadStartTimeRef.current = null;
      }
    } else {
      callHistoryLoadStartTimeRef.current = null;
    }
  }, [queryDetails.type]);

  // call tabs
  const tabs: Array<{ id: CallTabType; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'missed', label: 'Missed' },
  ];

  // update query params
  const handleTabChange = (newTab: string) => {
    const params = new URLSearchParams(location.search);
    params.set('tab', newTab);
    void navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  };

  // Redirect to /calls/all if no tab or invalid tab
  useEffect(() => {
    if (!tabParam) {
      const params = new URLSearchParams(location.search);
      params.set('tab', 'all');
      void navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    }
  }, [tabParam, location.pathname, location.search, navigate]);

  const allUsersData = useUsers();

  const filterCallsBySearchQuery = (calls: Call[], query: string): Call[] => {
    if (!query.trim()) return calls;

    const lowerQuery = query.toLowerCase();

    return calls.filter(call => {
      // Search by call title
      if (call.title?.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Search by channel name
      const channel = allChannels.find(c => c.id === call.channelId);
      if (channel?.name?.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Search by participant names
      const participantNames = call.participants
        ?.map(p => {
          const user = allUsersData.find(u => u.id === p.userId);
          return user?.name?.toLowerCase() || '';
        })
        .join(' ');

      if (participantNames?.includes(lowerQuery)) {
        return true;
      }

      // Search by participant emails
      const participantEmails = call.participants
        ?.map(p => {
          const user = allUsersData.find(u => u.id === p.userId);
          return user?.email?.toLowerCase() || '';
        })
        .join(' ');

      if (participantEmails?.includes(lowerQuery)) {
        return true;
      }

      return false;
    });
  };

  const filteredScheduledCalls = searchQuery.trim()
    ? filterCallsBySearchQuery(scheduledCalls || [], searchQuery)
    : scheduledCalls;

  const displayScheduledCalls = showAllUpcoming
    ? filteredScheduledCalls
    : filteredScheduledCalls?.slice(0, MAX_UPCOMING_CALLS_TO_SHOW);

  const filteredRecentCalls = searchQuery.trim()
    ? filterCallsBySearchQuery(calls || [], searchQuery)
    : calls;

  const filteredMissedCalls = searchQuery.trim()
    ? filterCallsBySearchQuery(missedCalls || [], searchQuery)
    : missedCalls;

  // Filter calls based on active tab
  const getTabContent = () => {
    if (searchQuery.trim()) {
      if (activeTab === 'missed') {
        return filteredMissedCalls;
      } else if (activeTab === 'upcoming') {
        return filteredScheduledCalls;
      } else {
        return filteredRecentCalls;
      }
    }

    //default view without search
    if (activeTab === 'missed') {
      return missedCalls;
    } else if (activeTab === 'upcoming') {
      return scheduledCalls;
    } else {
      return calls;
    }
  };

  const tabContent = getTabContent();

  if (queryDetails.type === 'unknown') {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-sm text-gray-500'>Loading call history...</div>
      </div>
    );
  }

  if (queryDetails.type === 'error') {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-sm text-red-500'>Error loading call history</div>
      </div>
    );
  }

  return (
    <div className='bg-white dark:bg-[#1E1E1E] flex flex-col w-full h-full md:rounded-2xl overflow-y-auto shadow-[0_0_8px_0_rgba(0,0,0,0.15)] border-root-border border relative '>
      <div className='w-full flex flex-col items-center px-4'>
        <div className='max-w-[810px] w-full sticky top-0 bg-white z-50 '>
          {/* Header */}
          <div className='flex items-center justify-between py-3'>
            <h1 className='text-lg font-semibold text-[#181B1D]'>Calls</h1>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className='bg-sidebar-badge-accent hover:opacity-90 duration-300 ease-in-out rounded-lg gap-1.5 px-3 py-2 h-8'>
                  <span className='text-white text-sm leading-5 font-semibold'>New Call</span>
                  <ChevronDown className='size-4' strokeWidth={2.3} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' sideOffset={8} className='rounded-xl'>
                <DropdownMenuItem
                  className='flex gap-2 items-center text-sm rounded-lg'
                  onSelect={() => {
                    setIsInstantCallModalOpen(true);
                  }}
                >
                  <Plus className='size-4' />
                  Start an instant call
                </DropdownMenuItem>
                <DropdownMenuItem
                  className='flex gap-2 items-center text-sm leading-5 rounded-lg'
                  onSelect={() => setIsScheduleModalOpen(true)}
                >
                  <CalendarDays className='size-4' />
                  Schedule call for later
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Tabs Options */}
          <div className='overflow-x-auto border-b border-gray-200 dark:border-gray-700 shrink-0'>
            <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
              <Tabs.List className='flex items-center justify-start'>
                {tabs.map(tab => (
                  <Tabs.Trigger asChild key={tab.id} value={tab.id}>
                    <button
                      className={cn(
                        'flex items-center p-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 cursor-pointer',
                        activeTab === tab.id
                          ? 'border-black text-gray-900'
                          : 'border-transparent text-[#788187]',
                      )}
                    >
                      {tab.label}
                    </button>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </Tabs.Root>
          </div>

          {/* Search Input */}
          <div className='my-4 relative'>
            <Search className='absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-300  size-4' />
            <Input
              type='text'
              placeholder='Search calls'
              value={searchQuery}
              maxLength={56}
              onChange={e => setSearchQuery(e.target.value)}
              className='pl-8 w-full placeholder:text-[#C9CCCF] max-w-full md:max-w-[350px] rounded-xl focus-visible:border-sidebar-badge-accent focus-visible:ring-0 duration-300 ease-in-out'
              data-testid='user-search-input'
            />
          </div>

          {/* Selected Users Pills */}
          {selectedUsers.length > 0 && (
            <div className='my-4 flex flex-wrap gap-2'>
              {selectedUsers.map(selectedUser => (
                <div
                  key={selectedUser.id}
                  className='flex items-center gap-2 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-full'
                >
                  <Avatar userId={selectedUser.id} size='sm' />
                  <span className='text-sm font-medium text-blue-900 dark:text-blue-100'>
                    {selectedUser.name}
                  </span>
                  <button
                    onClick={() => handleRemoveUser(selectedUser.id)}
                    className='text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100'
                    data-track-category='Calls'
                    data-track-name='RemoveUserFilter'
                    data-track-metadata={JSON.stringify({ userId: selectedUser.id })}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Call List */}
        <div className='flex-1 overflow-y-auto max-w-[810px] w-full no-scrollbar'>
          {/* All Tab View */}
          {activeTab === 'all' && (
            <div className='flex flex-col gap-7'>
              {/* Upcoming calls */}
              {(!searchQuery.trim() ||
                (filteredScheduledCalls && filteredScheduledCalls.length > 0)) &&
                scheduledCalls &&
                scheduledCalls.length > 0 && (
                  <div className='flex flex-col gap-4 mt-3 w-full'>
                    <div className='flex items-center justify-between'>
                      <span className='font-mono text-black/40 text-sm leading-5 font-medium uppercase cursor-default'>
                        upcoming calls
                      </span>
                      {!searchQuery.trim() && scheduledCalls.length > 3 && (
                        <Button
                          variant='secondary'
                          size='sm'
                          onClick={() => setShowAllUpcoming(!showAllUpcoming)}
                          className='font-mono text-[#3B4145] text-sm leading-5 font-medium capitalize rounded-xl h-7'
                        >
                          {showAllUpcoming ? 'less' : 'more'}
                        </Button>
                      )}
                    </div>

                    <div className='grid grid-cols-1 md:grid-cols-3 md:gap-4 border md:border-none border-gray-100 rounded-xl'>
                      {displayScheduledCalls &&
                        displayScheduledCalls.length > 0 &&
                        displayScheduledCalls.map((call, i) => (
                          <UpcomingCallCard
                            key={call.id}
                            call={call}
                            allUsers={filteredUsers}
                            onCallClick={() => handleCallRowClick(call)}
                            onParticipantsClick={() => handleParticipantsClick(call)}
                            isLastItem={i === displayScheduledCalls.length - 1}
                            currentUserId={user?.id ?? ''}
                            onCancelClick={e => {
                              e.stopPropagation();
                              handleCancelCall(call.externalId);
                            }}
                          />
                        ))}
                    </div>
                  </div>
                )}

              {/* Recent Calls */}
              {filteredRecentCalls && filteredRecentCalls.length > 0 && (
                <div className='flex flex-col gap-4 w-full pb-20 md:pb-4'>
                  <span className='font-mono text-black/40 text-sm leading-5 font-medium uppercase cursor-default'>
                    recents
                  </span>
                  <div className='border border-gray-100 rounded-xl overflow-hidden'>
                    {filteredRecentCalls.map((call, i) => (
                      <CallCard
                        key={call.id}
                        call={call}
                        currentUserId={user?.id}
                        isLastItem={i === filteredRecentCalls.length - 1}
                        onCallClick={() => handleCallRowClick(call)}
                        onParticipantsClick={() => handleParticipantsClick(call)}
                        handleGotoTranscript={() => handleGotoTranscript(call)}
                        handleDownloadTranscript={() => handleDownloadTranscript(call)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {filteredRecentCalls &&
                filteredRecentCalls.length === 0 &&
                displayScheduledCalls &&
                displayScheduledCalls.length === 0 &&
                (searchQuery.trim() ? (
                  <NoFiltredCalls searchQuery={searchQuery} />
                ) : (
                  <EmptyState
                    icon={Phone}
                    title='No Calls Yet'
                    description='Start a conversation by making your first call.'
                  />
                ))}
            </div>
          )}

          {/* Upcoming Calls Tab View */}
          {activeTab === 'upcoming' && (
            <div className='flex flex-col gap-4 w-full pb-20 md:pb-4'>
              {tabContent && tabContent.length > 0 && (
                <div className='grid grid-cols-1 md:grid-cols-3 md:gap-4 border md:border-none border-gray-100 rounded-xl'>
                  {tabContent.map((call, i) => (
                    <UpcomingCallCard
                      key={call.id}
                      call={call}
                      allUsers={filteredUsers}
                      onCallClick={() => handleCallRowClick(call)}
                      onParticipantsClick={() => handleParticipantsClick(call)}
                      isLastItem={i === tabContent.length - 1}
                      currentUserId={user?.id ?? ''}
                      onCancelClick={e => {
                        e.stopPropagation();
                        handleCancelCall(call.externalId);
                      }}
                    />
                  ))}
                </div>
              )}
              {tabContent &&
                tabContent.length === 0 &&
                (searchQuery.trim() ? (
                  <NoFiltredCalls searchQuery={searchQuery} />
                ) : (
                  <EmptyState
                    icon={CalendarClock}
                    title='No Upcoming Calls'
                    description='Your calendar is clear. Schedule a call to get started.'
                  />
                ))}
            </div>
          )}

          {/* Missed Calls Tab View */}
          {activeTab === 'missed' && (
            <div className='flex flex-col gap-4 w-full pb-20 md:pb-4 '>
              {tabContent && tabContent.length > 0 && (
                <div className='border border-gray-100 rounded-xl'>
                  {tabContent.map((call, i) => (
                    <CallCard
                      key={call.id}
                      call={call}
                      currentUserId={user?.id}
                      isLastItem={i === tabContent.length - 1}
                      onCallClick={() => handleCallRowClick(call)}
                      onParticipantsClick={() => handleParticipantsClick(call)}
                      handleGotoTranscript={() => handleGotoTranscript(call)}
                      handleDownloadTranscript={() => handleDownloadTranscript(call)}
                    />
                  ))}
                </div>
              )}
              {tabContent &&
                tabContent.length === 0 &&
                (searchQuery.trim() ? (
                  <NoFiltredCalls searchQuery={searchQuery} />
                ) : (
                  <EmptyState
                    icon={Megaphone}
                    title='No Missed Calls'
                    description="You haven't missed any calls. All caught up!"
                  />
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Participants Modal */}
      <ParticipantsModal
        isOpen={isParticipantsModalOpen}
        onClose={closeParticipantsModal}
        call={selectedCall}
        currentUserId={user?.id}
      />

      {/* Call Confirmation Modal */}
      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeConfirmModal}
        onConfirm={handleConfirmCall}
        title={confirmModalConfig.title}
        subtitle={confirmModalConfig.subtitle}
      />

      {/* Schedule Call Modal */}
      <ScheduleCallModal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
      />

      {/* Instant Call Modal */}
      <InstantCallModal
        isOpen={isInstantCallModalOpen}
        onClose={() => setIsInstantCallModalOpen(false)}
        onSubmit={handleInstantCall}
      />
    </div>
  );
};

const EmptyState = ({ icon: Icon, title, description }: EmptyStateProps): ReactElement => {
  return (
    <div className='flex flex-col items-center justify-center h-full px-6 py-12'>
      <div className='size-12 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center border border-slate-200 dark:border-slate-700 mb-4'>
        <Icon size={20} strokeWidth={1.5} className='text-slate-400 dark:text-slate-500' />
      </div>

      <h2 className='text-xl text-gray-900 dark:text-white font-light mb-4'>{title}</h2>

      <p className='text-sm text-gray-500 text-center dark:text-gray-400 max-w-sm'>{description}</p>
    </div>
  );
};

const NoFiltredCalls = ({ searchQuery }: { searchQuery: string }): ReactElement => {
  return (
    <div className='flex flex-col items-center justify-center h-full px-6 py-12'>
      <p className='text-xs font-mono text-gray-400 dark:text-gray-600 mb-6 tracking-widest'>
        [0 RESULTS]
      </p>

      <h2 className='text-xl text-gray-900 dark:text-white font-light mb-4'>Nothing matches</h2>

      <p className='text-sm text-gray-500 text-center dark:text-gray-400 max-w-sm'>
        &quot;{searchQuery}&quot; didn&apos;t return any calls
      </p>
    </div>
  );
};

export default CallHistoryScreen;
