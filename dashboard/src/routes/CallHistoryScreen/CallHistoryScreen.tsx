import { ReactElement, useEffect, useRef } from 'react';
import { Phone, Search, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useWindowWidth } from '../../hooks/useWindowWidth';
import { useCallHistory } from './useCallHistory';
import { CallHistoryItem } from './CallHistoryItem';
import { ParticipantsModal } from './ParticipantsModal';
import { CallConfirmationModal } from '../../components/Call/CallConfirmationModal';
import Input from '../../components/ui/Input';
import Avatar from '../../components/ui/Avatar/Avatar';
import type { User } from '../../machines/stateMachine';
import HuddleIcon from '../../components/icons/HuddleIcon';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { CallStatus } from '@xyne/shared';
import { logger, Event } from '../../utils/logger';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';

const CallHistoryScreen = (): ReactElement => {
  const { user } = useAuth();
  const windowWidth = useWindowWidth();
  const isMobileView = windowWidth < 500;
  const {
    calls,
    queryDetails,
    selectedCall,
    isParticipantsModalOpen,
    searchQuery,
    setSearchQuery,
    filteredUsers,
    filteredCalls,
    selectedUsers,
    handleCallRowClick,
    handleParticipantsClick,
    handleUserToggle,
    handleRemoveUser,
    handleInitiateCall,
    closeParticipantsModal,
    handleGotoTranscript,
    handleDownloadTranscript,
    showConfirmModal,
    confirmModalConfig,
    handleConfirmCall,
    closeConfirmModal,
  } = useCallHistory(user?.id);

  const zero = useZero();
  const callHistoryLoadStartTimeRef = useRef<number | null>(null);

  const endedCallsCount = calls?.filter(c => c.status === CallStatus.ENDED).length ?? 0;

  useEffect(() => {
    if (endedCallsCount === 0) return;

    zero.mutate(mutators.activities.markMissedCallsAsRead({}));
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
    <div className='flex-1 bg-white dark:bg-[#1E1E1E] flex flex-col h-full md:rounded-2xl overflow-hidden shadow-[0_0_8px_0_rgba(0,0,0,0.15)] border-root-border border relative'>
      {/* Header */}
      <div className='border-b border-[#D7E0E9] dark:border-gray-700 px-6 py-4'>
        <h1 className='text-2xl font-semibold text-[#384049] dark:text-[#F1F3F4] mb-1'>Calls</h1>
        <p className='text-sm text-gray-500 dark:text-gray-400'>View all your calls</p>

        {/* Search Input */}
        <div className='mt-4 relative'>
          <Search
            className='absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400'
            size={18}
          />
          <Input
            type='text'
            placeholder='Search users and calls...'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className='pl-10 w-full'
            data-testid='user-search-input'
          />
        </div>

        {/* Selected Users Pills */}
        {selectedUsers.length > 0 && (
          <div className='mt-4 flex flex-wrap gap-2'>
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
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Call List */}
      <div className='flex-1 overflow-y-auto' data-testid='call-history-list'>
        {!calls || calls.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full px-6 text-center'>
            <div className='w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4'>
              <Phone size={32} className='text-gray-400 dark:text-gray-500' />
            </div>
            <p className='text-lg text-[#384049] dark:text-[#F1F3F4] font-medium mb-2'>
              No calls yet
            </p>
            <p className='text-sm text-gray-500 dark:text-gray-400 max-w-md'>
              Your call history will appear here once you make your first call
            </p>
          </div>
        ) : searchQuery.trim() ? (
          // Search results - show two sections
          <>
            {filteredUsers.length === 0 && filteredCalls.length === 0 ? (
              <div className='flex flex-col items-center justify-center h-full px-6 text-center'>
                <div className='w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4'>
                  <Search size={32} className='text-gray-400 dark:text-gray-500' />
                </div>
                <p className='text-lg text-[#384049] dark:text-[#F1F3F4] font-medium mb-2'>
                  No results found
                </p>
                <p className='text-sm text-gray-500 dark:text-gray-400 max-w-md'>
                  No users or calls found for &quot;{searchQuery}&quot;
                </p>
              </div>
            ) : (
              <>
                {/* Users Section */}
                {filteredUsers.length > 0 && (
                  <div className='border-b border-[#D7E0E9] dark:border-gray-700'>
                    <div className='px-6 py-3 bg-gray-50 dark:bg-gray-800/50'>
                      <h2 className='text-sm font-semibold text-[#384049] dark:text-[#F1F3F4] uppercase tracking-wide'>
                        Users
                      </h2>
                    </div>
                    <div>
                      {filteredUsers.map(userItem => (
                        <UserListItem
                          key={userItem.id}
                          user={userItem}
                          isSelected={selectedUsers.some(u => u.id === userItem.id)}
                          onToggle={() => handleUserToggle(userItem)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Call History Section */}
                {filteredCalls.length > 0 && (
                  <div>
                    <div className='px-6 py-3 bg-gray-50 dark:bg-gray-800/50'>
                      <h2 className='text-sm font-semibold text-[#384049] dark:text-[#F1F3F4] uppercase tracking-wide'>
                        Calls
                      </h2>
                    </div>
                    <div>
                      {filteredCalls.map(call => (
                        <CallHistoryItem
                          key={call.id}
                          call={call}
                          currentUserId={user?.id}
                          onCallClick={() => handleCallRowClick(call)}
                          onParticipantsClick={() => handleParticipantsClick(call)}
                          handleGotoTranscript={() => handleGotoTranscript(call)}
                          handleDownloadTranscript={() => handleDownloadTranscript(call)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          // Default view - show all calls
          <div>
            {calls.map(call => (
              <CallHistoryItem
                key={call.id}
                call={call}
                currentUserId={user?.id}
                onCallClick={() => handleCallRowClick(call)}
                onParticipantsClick={() => handleParticipantsClick(call)}
                handleGotoTranscript={() => handleGotoTranscript(call)}
                handleDownloadTranscript={() => handleDownloadTranscript(call)}
              />
            ))}
          </div>
        )}
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

      {/* Floating Huddle Button */}
      {selectedUsers.length > 0 && (
        <button
          onClick={handleInitiateCall}
          className={`absolute w-14 h-14 bg-blue-400 hover:bg-blue-500 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 ${
            isMobileView ? 'top-4 right-4' : 'bottom-16 right-6'
          }`}
          aria-label='Start call'
          data-testid='start-call-button'
        >
          <HuddleIcon size={20} color='white' />
        </button>
      )}
    </div>
  );
};

// User list item component for search results
function UserListItem({
  user,
  isSelected,
  onToggle,
}: {
  user: User;
  isSelected: boolean;
  onToggle: () => void;
}): ReactElement {
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      role='button'
      tabIndex={0}
      className='px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer'
      onClick={onToggle}
      onKeyDown={handleKeyDown}
    >
      <div className='flex items-center gap-3'>
        <Avatar userId={user.id} size='md' />
        <div className='flex-1 min-w-0'>
          <p className='text-sm font-semibold text-[#384049] dark:text-[#F1F3F4] truncate'>
            {user.name}
          </p>
          <p className='text-xs text-gray-500 dark:text-gray-400 truncate'>{user.email}</p>
        </div>
        <input
          type='checkbox'
          checked={isSelected}
          onChange={onToggle}
          onClick={e => e.stopPropagation()}
          className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer'
        />
      </div>
    </div>
  );
}

export default CallHistoryScreen;
