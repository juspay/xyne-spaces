import React, { useMemo, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { AlertTriangle } from 'lucide-react';
import type { CommandItem, CommandSelectorProps } from './Selectors.types';
import { detectCommandTrigger, createVirtualAnchor } from './Selectors.utils';
import { commandPluginKey } from '../TipTapExtensions';
import { BasePopoverSelector } from './BasePopoverSelector';

export const CommandSelector: React.FC<CommandSelectorProps> = ({
  editor,
  commandItems,
  isLoadingCommands = false,
  onCommandSelect,
}) => {
  const [query, setQuery] = React.useState('');

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commandItems;
    return commandItems.filter(cmd => cmd.name.toLowerCase().includes(query.toLowerCase()));
  }, [commandItems, query]);

  const detectTriggerWithQuery = useCallback((ed: Editor) => {
    const trigger = detectCommandTrigger(ed);
    if (trigger) {
      setQuery(trigger.query);
    } else {
      setQuery('');
    }
    return trigger;
  }, []);

  const handleSelect = useCallback(
    (command: CommandItem) => {
      if (!editor) return;

      const trigger = detectCommandTrigger(editor);
      if (!trigger) return;

      // Replace the typed /query with just /{commandName} so the user can
      // review it in the input box. Dispatch happens when they press Enter/send.
      editor
        .chain()
        .focus()
        .deleteRange({ from: trigger.triggerStart, to: trigger.triggerEnd })
        .insertContent(command.kind === 'slash-command-artifact' ? '' : `/${command.name}`)
        .run();

      if (command.kind === 'slash-command-artifact') {
        void onCommandSelect?.(command);
      }
      setQuery('');
    },
    [editor, onCommandSelect],
  );

  const renderItem = useCallback(
    (item: CommandItem, _index: number, isSelected: boolean) => (
      <div
        className={`flex items-center gap-3 p-3 transition-all duration-200 ease-in active:scale-[0.98] ${
          isSelected ? 'bg-accent' : ''
        }`}
      >
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
            item.kind === 'slash-command-artifact'
              ? 'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {item.kind === 'slash-command-artifact' ? (
            <AlertTriangle className='size-4' />
          ) : (
            <span>/</span>
          )}
        </span>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <span className='shrink-0 text-sm font-semibold text-foreground'>/{item.name}</span>
          <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
            {item.description}
          </span>
          {(item.badge || item.category) && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                item.kind === 'slash-command-artifact'
                  ? 'border border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-400'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {item.badge ?? item.category}
            </span>
          )}
        </div>
      </div>
    ),
    [],
  );

  return (
    <BasePopoverSelector<CommandItem>
      editor={editor}
      pluginKey={commandPluginKey}
      items={filteredCommands}
      detectTrigger={detectTriggerWithQuery}
      getPosition={createVirtualAnchor}
      onSelect={handleSelect}
      renderItem={renderItem}
      emptyMessage='No commands found'
      loadingMessage={
        <div className='flex items-center gap-2'>
          <div className='w-3 h-3 border-2 border-muted border-t-primary rounded-full animate-spin' />
          <span>Loading commands...</span>
        </div>
      }
      isLoading={isLoadingCommands}
      triggerChar='/'
      className='w-[470px] max-w-[calc(100vw-24px)]'
      header={
        <div className='flex items-center justify-between border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
          <span>
            Commands{' '}
            <span className='ml-1 font-normal normal-case'>{filteredCommands.length} matches</span>
          </span>
          <kbd className='rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px]'>
            /
          </kbd>
        </div>
      }
      footer={
        <div className='flex items-center gap-4 border-t border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground'>
          <span>↑ ↓ Navigate</span>
          <span>↵ Select</span>
          <span>esc Dismiss</span>
        </div>
      }
    />
  );
};
