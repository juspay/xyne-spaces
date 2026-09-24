import { useMemo, useState, type ReactElement } from 'react';
import {
  type CommandDef,
  COMMAND_SECTION_ORDER,
  COMMAND_SECTION_LABELS,
} from '@xyne/shared/commands';
import { cn } from '../../utils/classNames';

interface CommandMenuProps {
  commands: readonly CommandDef[];
  onSelect: (command: CommandDef) => void;
  onClose: () => void;
  lockedCommand?: { name: string; onUnlock: () => void } | undefined;
}

export function CommandMenu({
  commands,
  onSelect,
  onClose,
  lockedCommand,
}: CommandMenuProps): ReactElement {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().replace(/^\//, '').toLowerCase();
    if (!q) return commands;
    return commands.filter(
      c =>
        c.name.includes(q) || c.label.toLowerCase().includes(q) || c.help.toLowerCase().includes(q),
    );
  }, [commands, query]);

  const grouped = useMemo(
    () =>
      COMMAND_SECTION_ORDER.map(section => ({
        section,
        items: filtered.filter(c => c.section === section),
      })).filter(g => g.items.length > 0),
    [filtered],
  );

  return (
    <div className='rounded-2xl border border-chat-composer-border-active bg-background p-2 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.18)]'>
      <input
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
        }}
        placeholder='Search commands…'
        className='mb-1 w-full rounded-lg bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground/70 focus:outline-none'
        data-track-category='XyneAI'
        data-track-name='COMMAND_MENU_SEARCH'
      />
      <div className='max-h-72 overflow-y-auto'>
        {grouped.length === 0 && (
          <div className='px-2 py-3 text-sm text-muted-foreground'>
            No commands match “{query}”.
          </div>
        )}
        {grouped.map(({ section, items }) => (
          <div key={section} className='mb-1'>
            <div className='px-2 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70'>
              {COMMAND_SECTION_LABELS[section]}
            </div>
            {items.map(command => {
              const locked = lockedCommand?.name === command.name;
              return (
                <div key={command.name} className='flex items-center gap-1'>
                  <button
                    type='button'
                    onClick={() => onSelect(command)}
                    className={cn(
                      'flex min-w-0 flex-1 items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition',
                      'hover:bg-muted focus:bg-muted focus:outline-none',
                      locked && 'bg-primary/10',
                    )}
                    data-track-category='XyneAI'
                    data-track-name='COMMAND_MENU_SELECT'
                  >
                    <span
                      className={cn(
                        'shrink-0 font-mono text-sm',
                        locked ? 'text-primary' : 'text-foreground',
                      )}
                    >
                      /{command.name}
                    </span>
                    {locked ? (
                      <span className='shrink-0 rounded bg-primary/15 px-1.5 text-[10px] font-medium uppercase tracking-wide text-primary'>
                        Locked
                      </span>
                    ) : (
                      command.argsHint && (
                        <span className='shrink-0 font-mono text-xs text-muted-foreground/70'>
                          {command.argsHint}
                        </span>
                      )
                    )}
                    <span className='truncate text-xs text-muted-foreground'>
                      {locked
                        ? 'Every message runs this command. Unlock to send plain messages.'
                        : command.help}
                    </span>
                  </button>
                  {locked && lockedCommand && (
                    <button
                      type='button'
                      onClick={lockedCommand.onUnlock}
                      className='shrink-0 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground'
                      data-track-category='XyneAI'
                      data-track-name='COMMAND_MENU_UNLOCK'
                    >
                      Unlock
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
