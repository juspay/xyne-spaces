import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEventHandler,
  type ReactNode,
} from 'react';
import { useEditor, EditorContent, type Editor, type JSONContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import { Variable as VariableIcon } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Popover } from '../../../ui/Popover/Popover';
import { VariablePicker } from '../VariablePicker/VariablePicker';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import {
  VariableRef,
  VariableLabelProvider,
  buildVariableLabelResolver,
} from './VariableRefExtension';

interface VariableAwareInputProps {
  value: string;
  onChange: (next: string) => void;
  variableSources: VariablePickerSource[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSubmit?: () => void;
  onBlur?: FocusEventHandler<HTMLDivElement>;
  showVariableButton?: boolean;
  ariaInvalid?: boolean;
  style?: CSSProperties;
  rightSlot?: ReactNode;
}

export function VariableAwareInput({
  value,
  onChange,
  variableSources,
  placeholder,
  disabled,
  className,
  onSubmit,
  onBlur,
  showVariableButton = true,
  ariaInvalid,
  style,
  rightSlot,
}: VariableAwareInputProps): React.ReactElement {
  const [varOpen, setVarOpen] = useState(false);
  const labelFor = useMemo(() => buildVariableLabelResolver(variableSources), [variableSources]);

  const [initialDoc] = useState(() => textToDoc(value));

  const cb = useRef({ onChange, onSubmit });
  cb.current = { onChange, onSubmit };
  const lastEmittedRef = useRef(value);

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      History,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      VariableRef,
    ],
    content: initialDoc,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      const text = docToText(editor);
      lastEmittedRef.current = text;
      cb.current.onChange(text);
    },
    editorProps: {
      attributes: {
        class: cn(
          'flex-1 min-w-0 outline-none whitespace-pre-wrap break-words text-sm text-foreground',
          '[&_p]:m-0',
        ),
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          cb.current.onSubmit?.();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    const doc = textToDoc(value);
    editor.commands.setContent(doc, { emitUpdate: false });
    lastEmittedRef.current = value;
  }, [value, editor]);

  return (
    <VariableLabelProvider value={labelFor}>
      <div
        data-slot='variable-aware-input'
        onBlur={onBlur}
        style={style}
        aria-invalid={ariaInvalid ?? undefined}
        className={cn(
          // Mirror ui/Input/Input.tsx baseline styling so swaps are 1-line.
          'border-input flex h-9 w-full min-w-0 items-center gap-1 rounded-md border bg-transparent px-3 py-1 shadow-xs transition-[color,box-shadow]',
          'focus-within:border-ring focus-within:ring-ring/10 focus-within:ring-[2px]',
          'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
          disabled && 'pointer-events-none cursor-not-allowed opacity-50',
          className,
        )}
      >
        <EditorContent editor={editor} className='flex-1 min-w-0' />
        {rightSlot}
        {showVariableButton && (
          <VariableInsertButton
            open={varOpen}
            onOpenChange={setVarOpen}
            editor={editor}
            variableSources={variableSources}
          />
        )}
      </div>
    </VariableLabelProvider>
  );
}

function VariableInsertButton({
  open,
  onOpenChange,
  editor,
  variableSources,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  editor: Editor | null;
  variableSources: VariablePickerSource[];
}): React.ReactElement {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      align='end'
      side='bottom'
      sideOffset={4}
      className='rounded-xl p-0 overflow-hidden'
      trigger={
        <button
          type='button'
          aria-label='Insert variable'
          title='Insert variable'
          className='-mr-1 flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground'
        >
          <VariableIcon className='size-3.5' />
        </button>
      }
    >
      <VariablePicker
        sources={variableSources}
        onSelect={entry => {
          const ref = entry.reference.replace(/^\{\{|\}\}$/g, '');
          if (editor) {
            editor.chain().focus().insertContent({ type: 'variableRef', attrs: { ref } }).run();
          }
          onOpenChange(false);
        }}
        onClose={() => onOpenChange(false)}
      />
    </Popover>
  );
}

function textToDoc(text: string): JSONContent {
  const inline: JSONContent[] = [];
  let cursor = 0;
  const RE = /\{\{([^{}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    if (m.index > cursor) {
      const chunk = text.slice(cursor, m.index);
      if (chunk) inline.push({ type: 'text', text: chunk });
    }
    inline.push({ type: 'variableRef', attrs: { ref: m[1] ?? '' } });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    const tail = text.slice(cursor);
    if (tail) inline.push({ type: 'text', text: tail });
  }
  const paragraph: JSONContent =
    inline.length > 0 ? { type: 'paragraph', content: inline } : { type: 'paragraph' };
  return { type: 'doc', content: [paragraph] };
}

function docToText(editor: Editor): string {
  const parts: string[] = [];
  editor.state.doc.descendants(node => {
    if (node.type.name === 'variableRef') {
      const ref = (node.attrs as { ref?: string }).ref ?? '';
      parts.push(`{{${ref}}}`);
      return false; // atom — no children
    }
    if (node.isText) {
      parts.push(node.text ?? '');
    }
    return true;
  });
  return parts.join('');
}
