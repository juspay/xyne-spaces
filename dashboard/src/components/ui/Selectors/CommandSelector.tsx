import React, { useMemo, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import type { CommandItem, CommandSelectorProps } from './Selectors.types';
import { detectCommandTrigger, createVirtualAnchor } from './Selectors.utils';
import { commandPluginKey } from '../TipTapExtensions';
import { BasePopoverSelector } from './BasePopoverSelector';

export const CommandSelector: React.FC<CommandSelectorProps> = ({
  editor,
  commandItems,
  isLoadingCommands = false,
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
        .insertContent(`/${command.name}`)
        .run();

      setQuery('');
    },
    [editor],
  );

  const renderItem = useCallback(
    (item: CommandItem, _index: number, isSelected: boolean) => (
      <div
        className={`flex flex-col gap-1 p-3 transition-all duration-200 ease-in active:scale-[0.98] ${
          isSelected ? 'bg-accent' : ''
        }`}
      >
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium text-foreground'>/{item.name}</span>
          {item.category && (
            <span className='text-xs px-2 py-0.5 bg-muted text-muted-foreground rounded-full'>
              {item.category}
            </span>
          )}
        </div>
        <span className='text-xs text-muted-foreground'>{item.description}</span>
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
      className='w-80'
    />
  );
};
