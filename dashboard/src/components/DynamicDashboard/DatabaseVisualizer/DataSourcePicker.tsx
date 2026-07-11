import { useMemo, useState, type ReactElement } from 'react';
import { Check, ChevronsUpDown, Database, Search } from 'lucide-react';
import { Popover } from '../../ui/Popover/Popover';
import type { DataSourceListItem } from '../../../services/DynamicDashboard/dataSourcesService';

interface DataSourcePickerProps {
  sources: DataSourceListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function healthDotClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('health') || s === 'ok' || s === 'connected' || s === 'active') {
    return 'bg-emerald-500';
  }
  if (s.includes('error') || s.includes('fail') || s === 'unhealthy' || s === 'disconnected') {
    return 'bg-rose-500';
  }
  return 'bg-amber-500';
}

export function DataSourcePicker({
  sources,
  selectedId,
  onSelect,
}: DataSourcePickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = sources.find(s => s.id === selectedId) ?? sources[0] ?? null;
  const showSearch = sources.length > 7;
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? sources.filter(s => s.name.toLowerCase().includes(query)) : sources;
  }, [sources, q]);

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
          data-track-name='Db_Viz_Open_Source_Picker'
          className='group inline-flex items-center gap-2 h-9 pl-2.5 pr-2 max-w-[260px] rounded-lg border border-border bg-card hover:bg-accent data-[state=open]:bg-accent transition-colors'
        >
          <span className='shrink-0 flex items-center justify-center w-6 h-6 rounded-md bg-muted'>
            <Database size={13} className='text-muted-foreground' />
          </span>
          <span className='min-w-0 flex flex-col items-start leading-tight'>
            <span className='truncate max-w-[170px] text-[13px] font-semibold text-foreground'>
              {selected?.name ?? 'Select database'}
            </span>
            {selected && (
              <span className='flex items-center gap-1 text-[10px] text-muted-foreground'>
                <span className={`w-1 h-1 rounded-full ${healthDotClass(selected.healthStatus)}`} />
                {selected.sourceType}
              </span>
            )}
          </span>
          <ChevronsUpDown size={14} className='shrink-0 text-muted-foreground' />
        </button>
      }
    >
      <div className='w-[280px] max-h-[60vh] flex flex-col overflow-hidden'>
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
              placeholder='Search databases…'
              aria-label='Search databases'
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Db_Viz_Source_Search'
              className='w-full h-8 pl-7 pr-2 text-[13px] bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
            />
          </div>
        )}
        <div className='flex-1 min-h-0 overflow-y-auto py-1'>
          {filtered.length === 0 ? (
            <div className='px-3 py-6 text-center text-[12px] text-muted-foreground'>
              No databases match.
            </div>
          ) : (
            filtered.map(s => {
              const active = s.id === selected?.id;
              return (
                <button
                  key={s.id}
                  type='button'
                  onClick={() => {
                    onSelect(s.id);
                    setOpen(false);
                    setQ('');
                  }}
                  data-track-category='DYNAMIC_DASHBOARD'
                  data-track-name='Db_Viz_Pick_Source'
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors ${
                    active ? 'bg-accent' : 'hover:bg-accent/60'
                  }`}
                >
                  <span
                    className={`shrink-0 w-1.5 h-1.5 rounded-full ${healthDotClass(s.healthStatus)}`}
                  />
                  <span className='flex-1 min-w-0'>
                    <span className='block truncate text-[13px] font-medium text-foreground'>
                      {s.name}
                    </span>
                    <span className='block truncate text-[11px] text-muted-foreground'>
                      {s.sourceType}
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
