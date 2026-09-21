import { useState, type ReactElement, type ReactNode } from 'react';
import { LayoutList } from 'lucide-react';
import Popover from '../ui/Popover';
import { cn } from '../../utils/classNames';
import type { WorkspaceItem } from './itemDescriptor';
import type { TabState } from './tabState';

export interface QuickSwitchSection {
  id: string;
  label: string;
  onSelect: () => void;
  active?: boolean;
}

export interface QuickSwitchProps {
  items: readonly WorkspaceItem[];
  tabs: TabState;
  onOpen: (id: string) => void;
  icon?: (item: WorkspaceItem) => ReactNode;
  sections?: readonly QuickSwitchSection[];
}

interface Group {
  label: string;
  rows: WorkspaceItem[];
  onSelect?: (() => void) | undefined;
}

function rowsFor(label: string, items: readonly WorkspaceItem[]): WorkspaceItem[] {
  const key = label.toLowerCase();
  if (key === 'artifacts') return items.filter(item => item.origin === 'artifact');
  if (key === 'sources') return items.filter(item => item.origin === 'source');
  return [];
}

function groups(
  items: readonly WorkspaceItem[],
  panes: readonly QuickSwitchSection[] | undefined,
): Group[] {
  if (panes?.length) {
    return panes.map(pane => ({
      label: pane.label,
      rows: rowsFor(pane.label, items),
      onSelect: pane.onSelect,
    }));
  }
  return [
    { label: 'Artifacts', rows: rowsFor('Artifacts', items) },
    { label: 'Sources', rows: rowsFor('Sources', items) },
  ].filter(group => group.rows.length > 0);
}

export function QuickSwitch({
  items,
  tabs,
  onOpen,
  icon,
  sections,
}: QuickSwitchProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (items.length === 0 && !sections?.length) return null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side='bottom'
      align='start'
      className='w-72 p-1'
      trigger={
        <button
          type='button'
          aria-label='Jump to an item'
          title='Jump to an item'
          className='grid h-7 w-7 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          data-track-category='Workspace'
          data-track-name='quick-switch-open'
        >
          <LayoutList className='h-4 w-4' />
        </button>
      }
    >
      <div className='max-h-96 overflow-y-auto'>
        {groups(items, sections).map(group => (
          <div key={group.label} className='mb-1 last:mb-0'>
            {group.onSelect ? (
              <button
                type='button'
                onClick={() => {
                  group.onSelect?.();
                  setOpen(false);
                }}
                className='flex w-full items-center px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground'
                data-track-category='Workspace'
                data-track-name='quick-switch-pane'
              >
                {group.label}
              </button>
            ) : (
              <p className='px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                {group.label}
              </p>
            )}
            {group.rows.map(item => (
              <button
                key={item.id}
                type='button'
                onClick={() => {
                  onOpen(item.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-secondary/60',
                  item.id === tabs.activeId ? 'bg-secondary text-foreground' : 'text-foreground',
                )}
                title={item.title}
                data-track-category='Workspace'
                data-track-name='quick-switch-jump'
              >
                <span className='flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground'>
                  {icon?.(item)}
                </span>
                <span className='min-w-0 flex-1 truncate'>{item.title}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Popover>
  );
}
