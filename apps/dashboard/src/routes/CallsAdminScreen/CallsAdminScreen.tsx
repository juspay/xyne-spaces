import { useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, UserTwo } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { useHasResourceAccess } from '@/hooks/usePermissions';
import type { CallAdminListScope } from '@/services/Call/callAdminService';
import { CallsTab } from './CallsTab';
import { SeriesTab } from './SeriesTab';
import { CALLS_ADMIN_TRACK } from './CallsAdminScreen.utils';

type TabKey = 'calls' | 'series';

const TABS: readonly TabItem[] = [
  { id: 'calls', label: 'Calls' },
  { id: 'series', label: 'Recurring series' },
];

const SCOPE_LABELS: Record<CallAdminListScope, string> = {
  mine: 'My calls',
  all: 'All workspace calls',
};

/**
 * Repair broken calls: stuck in ACTIVE, orphaned series, bad transcripts, stuck
 * summaries, wrong owner. Open to everyone — SCRIBE admins act on the whole
 * workspace, everyone else on their own calls — so it is not resource-gated; each
 * row carries the actions the backend will allow on it.
 */
export default function CallsAdminScreen(): ReactElement {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isScribeAdmin = useHasResourceAccess('SCRIBE');
  const [scopeChoice, setScopeChoice] = useState<CallAdminListScope>('all');

  const tab: TabKey = searchParams.get('tab') === 'series' ? 'series' : 'calls';
  // Only SCRIBE admins may list the whole workspace; everyone else sees their own.
  const scope: CallAdminListScope = isScribeAdmin ? scopeChoice : 'mine';

  const setTab = (id: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className='bg-background flex h-full w-full flex-col overflow-hidden shadow-md md:rounded-2xl'>
      <div className='mx-auto flex h-full min-h-0 w-full max-w-[1200px] flex-col px-4 md:px-6'>
        <div className='flex shrink-0 flex-col gap-3 pb-4 pt-5'>
          <div className='flex items-center gap-3'>
            <Button
              type='button'
              variant='ghost'
              size='iconSm'
              onClick={() => void navigate('/calls')}
              aria-label='Back to calls'
              data-track-category={CALLS_ADMIN_TRACK}
              data-track-name='Calls admin: back to calls'
            >
              <ArrowLeft className='size-4' aria-hidden />
            </Button>
            <div className='flex min-w-0 flex-1 flex-col justify-center gap-1'>
              <h1 className='text-2xl font-semibold leading-tight tracking-tight text-foreground'>
                Manage calls
              </h1>
              <p className='text-sm leading-tight text-muted-foreground'>
                Fix stuck calls, transcripts, summaries and ownership
                {isScribeAdmin ? ' across the workspace' : ' for your calls'}
              </p>
            </div>
            {isScribeAdmin && (
              <Select
                value={scopeChoice}
                onValueChange={value => setScopeChoice(value as CallAdminListScope)}
              >
                <SelectTrigger
                  className='w-auto shrink-0 gap-2 focus-visible:border-ring focus-visible:ring-0'
                  aria-label='Which calls to show'
                >
                  <SelectValue>
                    <span className='flex min-w-0 items-center gap-2'>
                      <UserTwo className='size-4 shrink-0 text-muted-foreground' aria-hidden />
                      <span className='truncate'>{SCOPE_LABELS[scopeChoice]}</span>
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align='end'>
                  <SelectItem value='mine'>{SCOPE_LABELS.mine}</SelectItem>
                  <SelectItem value='all'>{SCOPE_LABELS.all}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <Tabs
            items={TABS}
            activeId={tab}
            onSelect={setTab}
            trackCategory={CALLS_ADMIN_TRACK}
            trackPrefix='Calls admin tab'
          />
        </div>

        {/* Keyed on scope so switching it starts again from the first page. */}
        {tab === 'calls' ? (
          <CallsTab key={scope} scope={scope} />
        ) : (
          <SeriesTab key={scope} scope={scope} />
        )}
      </div>
    </div>
  );
}
