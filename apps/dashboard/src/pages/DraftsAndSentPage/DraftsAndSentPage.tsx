import { type ReactElement, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import DraftsPanel from '../../components/Chat/DraftsPanel/DraftsPanel';
import SentPanel from '../../components/Chat/SentPanel/SentPanel';
import DelayedMessagesPanel from '../../components/Chat/DelayedMessagesPanel/DelayedMessagesPanel';
import { stateMachineActor } from '../../machines/stateMachine';
import { usePendingDelayedMessagesCount } from '../../hooks/useUserDelayedMessages';
import { cn } from '../../utils/classNames';

type TabValue = 'drafts' | 'scheduled' | 'sent';

const DraftsAndSentPage = (): ReactElement => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: TabValue = (searchParams.get('tab') as TabValue) || 'drafts';

  const handleTabChange = useCallback(
    (value: TabValue) => {
      setSearchParams({ tab: value }, { replace: true });
    },
    [setSearchParams],
  );

  const draftsCount = useSelector(stateMachineActor, state => state.context.draftMessages.length);
  const pendingScheduledCount = usePendingDelayedMessagesCount();

  const tabOptions = [
    { value: 'drafts' as TabValue, label: 'Drafts', count: draftsCount },
    { value: 'scheduled' as TabValue, label: 'Scheduled', count: pendingScheduledCount },
    { value: 'sent' as TabValue, label: 'Sent' },
  ];

  return (
    <div className='flex flex-col h-full w-full bg-background'>
      {/* Header with title */}
      <div className='px-6 pt-6 pb-2 bg-background'>
        <div className='flex items-center justify-between'>
          <h2 className='text-xl font-semibold text-foreground'>Drafts &amp; scheduled messages</h2>
        </div>
      </div>

      {/* Tab navigation */}
      <div className='px-6 bg-background border-b border-border'>
        <nav className='flex gap-6'>
          {tabOptions.map(tab => (
            <button
              key={tab.value}
              type='button'
              onClick={() => handleTabChange(tab.value)}
              data-track-category='DRAFTS_AND_SENT_PAGE'
              data-track-name={`switch-tab-${tab.value}`}
              className={cn(
                'relative py-3 text-sm font-medium transition-colors',
                activeTab === tab.value
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {tab.count !== undefined && <span className='ml-1'>{tab.count}</span>}
              {activeTab === tab.value && (
                <span className='absolute bottom-0 left-0 right-0 h-0.5 bg-gray-300 rounded-t-full' />
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className='flex-1 min-h-0 overflow-hidden'>
        {activeTab === 'drafts' && <DraftsPanel />}
        {activeTab === 'scheduled' && <DelayedMessagesPanel />}
        {activeTab === 'sent' && <SentPanel />}
      </div>
    </div>
  );
};

DraftsAndSentPage.displayName = 'DraftsAndSentPage';

export default DraftsAndSentPage;
