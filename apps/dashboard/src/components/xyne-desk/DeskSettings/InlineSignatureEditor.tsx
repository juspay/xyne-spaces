import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { EditorToolbar } from '../../ui/EditorToolbar/EditorToolbar';
import SignatureIcon from '../../icons/SignatureIcon';

const ALLOWED_PASTE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export interface InlineSignatureEditorProps {
  initial?: { id?: string; name: string; content: string } | undefined;
  onSave: (data: { id?: string; name: string; content: string }) => void | Promise<void>;
  onCancel: () => void;
}

export const InlineSignatureEditor: React.FC<InlineSignatureEditorProps> = ({
  initial,
  onSave,
  onCancel,
}) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bold: { HTMLAttributes: { class: 'font-semibold' } },
        italic: { HTMLAttributes: { class: 'italic' } },
        bulletList: { HTMLAttributes: { class: 'list-disc pl-6' } },
        orderedList: { HTMLAttributes: { class: 'list-decimal pl-6' } },
        paragraph: { HTMLAttributes: { class: 'm-0 leading-6' } },
      }),
      Link.extend({ inclusive: false }).configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-blue-600 underline cursor-pointer' },
      }),
      Image.configure({ HTMLAttributes: { class: 'max-w-full h-auto' } }),
      Placeholder.configure({ placeholder: 'Write your signature here' }),
      Underline.configure({ HTMLAttributes: { class: 'underline' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    editorProps: {
      attributes: {
        class:
          'tiptap signature-editor prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[90px] px-3 py-2 text-sm text-foreground',
      },
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItem = items.find(item => ALLOWED_PASTE_IMAGE_TYPES.has(item.type));
        if (!imageItem) return false;
        event.preventDefault();
        const file = imageItem.getAsFile();
        if (!file) return false;
        const reader = new FileReader();
        reader.onload = e => {
          const src = e.target?.result as string;
          view.dispatch(
            view.state.tr.replaceSelectionWith(view.state.schema.nodes['image']!.create({ src })),
          );
        };
        reader.readAsDataURL(file);
        return true;
      },
    },
    content: initial?.content ?? '',
  });

  useEffect(() => {
    if (!editor) return;
    setName(initial?.name ?? '');
    editor.commands.setContent(initial?.content ?? '');
  }, [editor, initial?.id, initial?.name, initial?.content]);

  const handleSave = async () => {
    if (!editor || name.trim() === '') return;
    setIsSaving(true);
    try {
      await onSave({
        ...(initial?.id ? { id: initial.id } : {}),
        name: name.trim(),
        content: editor.getHTML(),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-col pt-[8px] px-[4px] gap-[4px] border border-border rounded-[16px] bg-background shadow-md overflow-auto'>
        <div className='flex h-[17px] items-center gap-[6px] px-[8px]'>
          <SignatureIcon className='text-muted-foreground' />
          <input
            id='signature-name-inline'
            type='text'
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder='Signature Name'
            autoComplete='off'
            data-1p-ignore
            data-lpignore='true'
            className='w-full text-sm text-foreground placeholder:text-muted-foreground bg-transparent focus:outline-none'
            data-track-category='DeskSettings'
            data-track-name='SignatureNameInput'
          />
        </div>
        <div className='h-[2px] bg-gray-100 dark:bg-gray-700 mt-1 mb-0' />
        <EditorContent editor={editor} />
        <EditorToolbar editor={editor} showImageUpload variant='compact' />
      </div>
      <div className='flex items-center justify-end h-[32px] gap-[8px]'>
        <button
          type='button'
          onClick={onCancel}
          className='px-[12px] py-[6px] text-sm font-medium text-foreground bg-background border border-border rounded-[10px] hover:bg-accent transition-colors'
          data-track-category='DeskSettings'
          data-track-name='CancelSignatureEdit'
        >
          Cancel
        </button>
        <button
          type='button'
          onClick={() => void handleSave()}
          data-ph-capture-attribute-track-id='save_signature'
          disabled={isSaving || name.trim() === ''}
          className='rounded-[10px] bg-desk-accent px-[12px] py-[6px] text-sm font-medium text-white transition-colors hover:bg-desk-accent-hover disabled:cursor-not-allowed disabled:opacity-50'
          data-track-category='DeskSettings'
          data-track-name='SaveSignature'
        >
          {isSaving ? 'Saving…' : initial?.id ? 'Save' : 'Add Signature'}
        </button>
      </div>
    </div>
  );
};
