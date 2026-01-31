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
  onCommandSelect,
}) => {
  const [query, setQuery] = React.useState('');

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commandItems;
    return commandItems.filter(
      cmd =>
        cmd.name.toLowerCase().includes(query.toLowerCase()) ||
        cmd.description.toLowerCase().includes(query.toLowerCase()),
    );
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

      const { state } = editor;
      const { selection } = state;
      const { from } = selection;

      let commandStart = from;
      const textBefore = state.doc.textBetween(Math.max(0, from - 50), from);
      const lastSlashIndex = textBefore.lastIndexOf('/');

      if (lastSlashIndex !== -1) {
        commandStart = from - (textBefore.length - lastSlashIndex);
      }

      editor
        .chain()
        .focus()
        .deleteRange({ from: commandStart, to: from })
        .insertContent(`/${command.name} `)
        .run();

      if (onCommandSelect) {
        void onCommandSelect(command);
      }

      setQuery('');
    },
    [editor, onCommandSelect],
  );

  const renderItem = useCallback(
    (item: CommandItem, _index: number, isSelected: boolean) => (
      <div
        className={`flex flex-col gap-1 p-3 transition-all duration-200 ease-in active:scale-[0.98] ${
          isSelected ? 'bg-blue-50' : ''
        }`}
      >
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium text-gray-800'>/{item.name}</span>
          {item.category && (
            <span className='text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full'>
              {item.category}
            </span>
          )}
        </div>
        <span className='text-xs text-gray-600'>{item.description}</span>
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
          <div className='w-3 h-3 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin' />
          <span>Loading commands...</span>
        </div>
      }
      isLoading={isLoadingCommands}
      className='w-80'
    />
  );
};
