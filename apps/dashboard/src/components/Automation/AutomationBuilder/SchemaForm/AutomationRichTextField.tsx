import { useCallback, useMemo, useRef, useState } from 'react';
import { Variable } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { cn } from '../../../../utils/classNames';
import { Popover } from '../../../ui/Popover/Popover';
import { EmailEditor } from '../../../xyne-desk/EmailEditor/EmailEditor';
import { VariablePicker } from '../VariablePicker/VariablePicker';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import {
  VariableRef,
  VariableLabelProvider,
  buildVariableLabelResolver,
  wrapVariableRefsForLoad,
} from './VariableRefExtension';

interface AutomationRichTextFieldProps {
  value: string;
  onChange: (next: string) => void;
  variableSources: VariablePickerSource[];
  placeholder?: string;
}

export function AutomationRichTextField({
  value,
  onChange,
  variableSources,
  placeholder,
}: AutomationRichTextFieldProps): React.ReactElement {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [varOpen, setVarOpen] = useState(false);

  // Tracks the last HTML the underlying editor emitted through onChange.
  // Used to distinguish the editor's own echoed value from a genuinely
  // external value (initial load / programmatic update).
  const lastEmittedRef = useRef<string | null>(null);

  const labelFor = useMemo(() => buildVariableLabelResolver(variableSources), [variableSources]);

  // Only wrap `{{ref}}` tokens for a genuinely external value. When `value` is
  // the editor's own emitted HTML (echoed back to us via onChange), pass it
  // through untouched: re-wrapping the echo produces HTML that never equals the
  // editor's serialized output, so EmailEditor's value-sync effect would keep
  // re-emitting it — an infinite render loop ("Maximum update depth exceeded").
  // Passing the echo through unchanged lets that effect see value === its last
  // emitted value and bail, so the field converges after one load normalization.
  const editorValue = useMemo(
    () => (value === lastEmittedRef.current ? value : wrapVariableRefsForLoad(value)),
    [value],
  );

  const handleEditorChange = useCallback(
    (next: string) => {
      lastEmittedRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const variableButton = (
    <Popover
      open={varOpen}
      onOpenChange={setVarOpen}
      align='end'
      side='bottom'
      sideOffset={4}
      className='rounded-xl p-0 overflow-hidden'
      trigger={
        <button
          type='button'
          aria-label='Insert variable'
          title='Insert variable'
          className={cn(
            'flex h-7 items-center gap-1 rounded px-1.5 text-xs transition-colors',
            'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <Variable className='h-3.5 w-3.5' />
          <span>Variable</span>
        </button>
      }
    >
      <VariablePicker
        sources={variableSources}
        onSelect={entry => {
          const ref = entry.reference.replace(/^\{\{|\}\}$/g, '');
          if (editor) {
            editor.chain().focus().insertContent({ type: 'variableRef', attrs: { ref } }).run();
          } else {
            onChange(`${value}${entry.reference}`);
          }
          setVarOpen(false);
        }}
        onClose={() => setVarOpen(false)}
      />
    </Popover>
  );

  return (
    <VariableLabelProvider value={labelFor}>
      <div className='flex flex-col rounded-md border border-border bg-background min-h-[160px]'>
        <EmailEditor
          value={editorValue}
          onChange={handleEditorChange}
          onEditorReady={setEditor}
          placeholder={placeholder ?? 'Type your message…'}
          toolbarRightSlot={variableButton}
          className='min-h-[160px]'
          extraExtensions={[VariableRef]}
        />
      </div>
    </VariableLabelProvider>
  );
}
