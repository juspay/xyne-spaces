import React, { useCallback, useMemo, useState } from 'react';
import { PluginKey } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { FileText, FileImage, FileVideo, Paperclip } from 'lucide-react';
import { detectFileReferenceTrigger, createVirtualAnchor } from './Selectors.utils';
import { fileReferencePluginKey } from '../TipTapExtensions';
import type { FileReferenceItem } from '../TipTapExtensions';
import { BasePopoverSelector, type BaseSelectorPluginState } from './BasePopoverSelector';

export type { FileReferenceItem };

export interface FileReferenceSelectorProps {
  editor: Editor | null;
  fileItems: FileReferenceItem[];
  onFileSelect?: (file: FileReferenceItem) => void;
}

const FileGlyph: React.FC<{ mimeType?: string | undefined }> = ({ mimeType }) => {
  const cls = 'h-3.5 w-3.5 text-muted-foreground';
  if (mimeType?.startsWith('image/')) return <FileImage className={cls} />;
  if (mimeType?.startsWith('video/')) return <FileVideo className={cls} />;
  if (mimeType === 'application/pdf' || mimeType?.startsWith('text/'))
    return <FileText className={cls} />;
  return <Paperclip className={cls} />;
};

/**
 * FileReferenceSelector
 *
 * The `~`-triggered picker that lets a user tag an existing file from the
 * current thread — the file analogue of the @-user and #-channel pickers.
 * Items come from the thread's attachments (see ChatInput → conversationMessages).
 * Selecting inserts a `fileReference` chip whose identity is the immutable
 * attachmentId; the backend re-authorizes that id server-side, so the embedded
 * id is display metadata, never a trusted grant.
 *
 * Filtering is local: the thread's file list is small and already client-side,
 * so we match the `~query` against file names here instead of round-tripping.
 */
export const FileReferenceSelector: React.FC<FileReferenceSelectorProps> = ({
  editor,
  fileItems,
  onFileSelect,
}) => {
  const [query, setQuery] = useState('');

  const detectTriggerWithSearch = useCallback(
    (ed: typeof editor) => {
      if (!ed) return null;
      const trigger = detectFileReferenceTrigger(ed);
      if (trigger) {
        setQuery(trigger.query.replace(/[.,!?:;)]*$/, ''));
      }
      return trigger;
    },
    [],
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fileItems.slice(0, 10);
    return fileItems.filter(f => f.name.toLowerCase().includes(q)).slice(0, 10);
  }, [fileItems, query]);

  const handleSelect = useCallback(
    (file: FileReferenceItem) => {
      if (!editor) return;

      const { state } = editor;
      const { from, $from } = state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
      const match = textBefore.match(/~([\w\s.-]*)$/);
      if (!match) return;

      const triggerStart = from - match[0].length;

      editor
        .chain()
        .focus()
        .deleteRange({ from: triggerStart, to: from })
        .insertFileReference({
          attachmentId: file.id,
          fileName: file.name,
          ...(file.mimeType !== undefined && { mimeType: file.mimeType }),
        })
        .insertContent(' ')
        .run();

      onFileSelect?.(file);
    },
    [editor, onFileSelect],
  );

  const renderItem = useCallback(
    (item: FileReferenceItem, _index: number, isSelected: boolean) => (
      <div
        className={`flex items-center h-8 px-1 transition-all duration-200 ease-in active:scale-[0.98] ${
          isSelected ? 'bg-accent' : ''
        }`}
      >
        <div className='w-8 h-8 flex items-center justify-center flex-shrink-0'>
          <FileGlyph mimeType={item.mimeType} />
        </div>
        <div className='flex-1 min-w-0 flex flex-col gap-0.5'>
          <span className='text-sm font-medium text-foreground whitespace-nowrap overflow-hidden text-ellipsis'>
            {item.name}
          </span>
        </div>
      </div>
    ),
    [],
  );

  return (
    <BasePopoverSelector<FileReferenceItem>
      editor={editor}
      pluginKey={fileReferencePluginKey as PluginKey<BaseSelectorPluginState<FileReferenceItem>>}
      items={filteredItems}
      detectTrigger={detectTriggerWithSearch}
      getPosition={createVirtualAnchor}
      onSelect={handleSelect}
      renderItem={renderItem}
      emptyMessage='No files in this thread'
      className='w-80'
      triggerChar='#'
    />
  );
};
