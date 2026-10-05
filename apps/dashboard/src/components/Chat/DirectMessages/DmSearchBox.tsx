import { memo, useCallback, useEffect } from 'react';
import type { ReactElement } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import Button from '../../ui/Button';
import { DmSearchDropdown } from './DmSearchDropdown';
import { useDmsSearch } from '../../../hooks/useDmsSearch';

interface DmSearchBoxProps {
  currentUserId: string;
  onSelectChannel: (channelId: string) => void;
  onSelectUser: (userId: string) => void;
  /** When this changes to a truthy string the box clears itself (e.g. pass channelId). */
  clearSignal: string | undefined;
  /** filteredDirectMessages.length — used for analytics tracking. */
  trackedDmCount: number;
  isMobile?: boolean;
}

const DmSearchBoxComponent = ({
  currentUserId,
  onSelectChannel,
  onSelectUser,
  clearSignal,
  trackedDmCount,
  isMobile,
}: DmSearchBoxProps): ReactElement => {
  const {
    dmSearchQuery,
    setDmSearchQuery,
    peopleResults,
    groupDmResults,
    isSearchStale,
    showDmSearchDropdown,
    setShowDmSearchDropdown,
    selectedDmSearchIndex,
    dmSearchInputRef,
    handleDmSearchKeyDown,
  } = useDmsSearch();

  useEffect(() => {
    if (clearSignal) {
      setDmSearchQuery('');
      setShowDmSearchDropdown(false);
    }
  }, [clearSignal, setDmSearchQuery, setShowDmSearchDropdown]);

  // Clear search state before delegating to the parent so DmsPage's navigation callbacks
  // don't need to know about search state.
  const handleSelectChannel = useCallback(
    (channelId: string): void => {
      setDmSearchQuery('');
      setShowDmSearchDropdown(false);
      onSelectChannel(channelId);
    },
    [onSelectChannel, setDmSearchQuery, setShowDmSearchDropdown],
  );

  const handleSelectUser = useCallback(
    (userId: string): void => {
      setDmSearchQuery('');
      setShowDmSearchDropdown(false);
      onSelectUser(userId);
    },
    [onSelectUser, setDmSearchQuery, setShowDmSearchDropdown],
  );

  return (
    <div className={cn('relative dm-search-container', isMobile && 'w-full')}>
      {isMobile ? (
        <div className='absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none'>
          <Search className='size-5 text-muted-foreground' />
        </div>
      ) : (
        <Search className='absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
      )}
      <input
        id='dm-search-input'
        ref={dmSearchInputRef}
        type='text'
        className={
          isMobile
            ? 'w-full h-11 pl-12 pr-10 py-3 bg-background rounded-full border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0'
            : 'w-full pl-9 pr-8 py-2 bg-muted rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring'
        }
        placeholder='Search DMs (Cmd+K)'
        autoFocus={!isMobile}
        value={dmSearchQuery}
        onChange={e => {
          setDmSearchQuery(e.target.value);
          setShowDmSearchDropdown(true);
        }}
        onFocus={() => setShowDmSearchDropdown(true)}
        onKeyDown={e => handleDmSearchKeyDown(e, handleSelectChannel, handleSelectUser)}
        data-track-event={isMobile ? 'blur' : undefined}
        data-track-category='DM'
        data-track-name={isMobile ? 'SEARCH_DMS_INPUT' : 'SEARCH_DMS_INPUT_DESKTOP'}
        data-testid={isMobile ? undefined : 'search-messages-input'}
        data-track-metadata={JSON.stringify({
          resultCount: trackedDmCount,
          queryLength: dmSearchQuery.length,
        })}
      />
      {dmSearchQuery && (
        <Button
          className={
            isMobile
              ? 'absolute inset-y-1 right-1 pr-3 flex items-center'
              : 'absolute right-1 top-1/2 -translate-y-1/2 flex items-center'
          }
          onClick={() => {
            setDmSearchQuery('');
            setShowDmSearchDropdown(false);
          }}
          data-track-category='DM'
          data-track-name='CLEAR_DM_SEARCH'
          data-track-metadata={JSON.stringify({
            hadResults: trackedDmCount > 0,
            resultCount: trackedDmCount,
          })}
          aria-label='Clear search'
          variant='link'
          size='icon'
        >
          <X className='size-4 text-muted-foreground hover:text-foreground' />
        </Button>
      )}
      <DmSearchDropdown
        isVisible={showDmSearchDropdown && dmSearchQuery.trim().length > 0}
        peopleResults={peopleResults}
        groupDmResults={groupDmResults}
        selectedIndex={selectedDmSearchIndex}
        isStale={isSearchStale}
        queryLength={dmSearchQuery.length}
        trackedResultCount={trackedDmCount}
        currentUserId={currentUserId}
        onSelectChannel={handleSelectChannel}
        onSelectUser={handleSelectUser}
      />
    </div>
  );
};

// Search state lives here, not in DmsPage — keystrokes only re-render this subtree.
export const DmSearchBox = memo(DmSearchBoxComponent);
