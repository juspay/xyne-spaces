import { useMemo, useState, type ReactElement } from 'react';
import { Check, ChevronDown, Database, Search } from 'lucide-react';
import { Popover } from '../../ui/Popover/Popover';
import type { DataSourceListItem } from '../../../services/DynamicDashboard/dataSourcesService';
import { healthDotClass } from '../DatabaseVisualizer/DataSourcePicker';

interface DataSourceChipProps {
  dataSourceId: string | null;
  setDataSourceId: (id: string) => void;
  dataSources: ReadonlyArray<DataSourceListItem>;
  trackName: string;
}

/**
 * Persistent, chat-context chip for picking which data source the assistant
 * reasons about. Sits alongside the other context chips (dashboard, focused
 * component) so it survives past the first message, instead of being a
 * one-shot control that vanishes once the empty state does.
 */
export function DataSourceChip({
  dataSourceId,
  setDataSourceId,
  dataSources,
  trackName,
}: DataSourceChipProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const ready = useMemo(
    () => dataSources.filter(d => d.ingestionStatus === 'complete'),
    [dataSources],
  );
  if (ready.length <= 1) return null;

  const selected = ready.find(d => d.id === dataSourceId) ?? null;
  const showSearch = ready.length > 7;
  const filtered = q.trim()
    ? ready.filter(d => d.name.toLowerCase().includes(q.trim().toLowerCase()))
    : ready;

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setQ('');
      }}
      side='bottom'
      align='start'
      sideOffset={6}
      className='p-0'
      trigger={
        <button
          type='button'
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name={trackName}
          className='group inline-flex items-center gap-1 h-6 pl-1.5 pr-1.5 rounded-md bg-muted border border-border hover:bg-accent data-[state=open]:bg-accent transition-colors text-[12px] leading-4 text-foreground'
        >
          <Database size={11} className='shrink-0 text-muted-foreground' />
          <span className='truncate max-w-[130px]'>{selected?.name ?? 'Pick data source'}</span>
          <ChevronDown size={11} className='shrink-0 text-muted-foreground' />
        </button>
      }
    >
      <div className='w-[240px] max-h-[60vh] flex flex-col overflow-hidden'>
        {showSearch && (
          <div className='relative p-2 border-b border-border'>
            <Search
              size={13}
              className='absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground'
            />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder='Search data sources…'
              aria-label='Search data sources'
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name={`${trackName}-search`}
              className='w-full h-8 pl-7 pr-2 text-[13px] bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
            />
          </div>
        )}
        <div className='flex-1 min-h-0 overflow-y-auto py-1'>
          {filtered.length === 0 ? (
            <div className='px-3 py-6 text-center text-[12px] text-muted-foreground'>
              No data sources match.
            </div>
          ) : (
            filtered.map(d => {
              const active = d.id === selected?.id;
              return (
                <button
                  key={d.id}
                  type='button'
                  onClick={() => {
                    setDataSourceId(d.id);
                    setOpen(false);
                    setQ('');
                  }}
                  data-track-category='DYNAMIC_DASHBOARD'
                  data-track-name={`${trackName}-select`}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors ${
                    active ? 'bg-accent' : 'hover:bg-accent/60'
                  }`}
                >
                  <span
                    className={`shrink-0 w-1.5 h-1.5 rounded-full ${healthDotClass(d.healthStatus)}`}
                  />
                  <span className='flex-1 min-w-0'>
                    <span className='block truncate text-[13px] font-medium text-foreground'>
                      {d.name}
                    </span>
                    <span className='block truncate text-[11px] text-muted-foreground'>
                      {d.sourceType}
                    </span>
                  </span>
                  {active && <Check size={14} className='shrink-0 text-foreground' />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </Popover>
  );
}
