import { ReactElement, useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorToolbar } from '../../ui/EditorToolbar/EditorToolbar';
import { Dialog } from '../../ui/Dialog/Dialog';
import type { EmailSignature } from '@xyne/shared';

interface SignatureEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: EmailSignature;
  onSaved: (data: { id?: string; name: string; content: string }) => void | Promise<void>;
  onSetDefault?: () => void;
}

export const SignatureEditorModal = ({
  open,
  onOpenChange,
  initial,
  onSaved,
  onSetDefault,
}: SignatureEditorModalProps): ReactElement => {
  const [name, setName] = useState(initial?.name ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const isEditMode = !!initial;

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
      Placeholder.configure({ placeholder: 'Write your signature here…' }),
    ],
    editorProps: {
      attributes: {
        class: 'tiptap prose prose-sm focus:outline-none min-h-[120px] px-3 py-2 text-sm',
      },
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItem = items.find(item => item.type.startsWith('image/'));
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
    if (open) {
      setName(initial?.name ?? '');
      editor?.commands.setContent(initial?.content ?? '');
    }
  }, [open, initial, editor]);

  const handleSave = async (): Promise<void> => {
    if (!editor || name.trim() === '') return;
    setIsSaving(true);
    try {
      await onSaved({
        ...(initial?.id ? { id: initial.id } : {}),
        name: name.trim(),
        content: editor.getHTML(),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditMode ? 'Edit Signature' : 'New Signature'}
      className='max-w-xl'
    >
      <div className='flex flex-col gap-4 p-5'>
        <div className='flex flex-col gap-1'>
          <label htmlFor='signature-name' className='text-xs font-medium text-muted-foreground'>
            Signature name
          </label>
          <input
            id='signature-name'
            type='text'
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder='e.g. Work, Personal…'
            className='border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6276be]'
            data-track-category='email-signature'
            data-track-name='edit-signature-name'
          />
        </div>

        <div className='border border-border rounded-xl overflow-hidden'>
          <EditorToolbar editor={editor} showImageUpload />
          <EditorContent editor={editor} />
        </div>

        <div className='flex items-center justify-between'>
          <div>
            {isEditMode && !initial.isDefault && onSetDefault && (
              <button
                type='button'
                onClick={() => {
                  setIsSettingDefault(true);
                  onSetDefault();
                  setIsSettingDefault(false);
                  onOpenChange(false);
                }}
                disabled={isSettingDefault}
                className='px-4 py-2 text-sm font-medium text-[#6276be] border border-[#6276be] rounded-lg hover:bg-[#eef0fb] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                data-track-category='email-signature'
                data-track-name='set-default-signature'
              >
                {isSettingDefault ? 'Setting…' : 'Set as default'}
              </button>
            )}
          </div>
          <div className='flex gap-2'>
            <button
              type='button'
              onClick={() => onOpenChange(false)}
              className='px-4 py-2 text-sm font-medium text-muted-foreground bg-muted rounded-lg hover:bg-secondary transition-colors'
              data-track-category='email-signature'
              data-track-name='cancel-signature'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={() => void handleSave()}
              disabled={isSaving || name.trim() === ''}
              className='px-4 py-2 text-sm font-medium text-white bg-[#6276be] rounded-lg hover:bg-[#4f62a8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              data-track-category='email-signature'
              data-track-name={isEditMode ? 'update-signature' : 'create-signature'}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
