import { isVariableRefValue } from './SchemaForm.utils';
import { ReferenceChip, UseVariableButton, useSeedSoleVariable } from './VariableFieldParts';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';

interface VariableRefFieldProps {
  value?: string | undefined;
  onChange: (next: string | undefined) => void;
  variableSources: VariablePickerSource[];
  placeholder?: string;
  targetEntityKind?: string | null;
}

export function VariableRefField({
  value,
  onChange,
  variableSources,
  placeholder,
  targetEntityKind,
}: VariableRefFieldProps): React.ReactElement {
  useSeedSoleVariable(value, onChange, variableSources, targetEntityKind);

  if (isVariableRefValue(value)) {
    return (
      <ReferenceChip value={value} sources={variableSources} onClear={() => onChange(undefined)} />
    );
  }

  return (
    <div className='flex items-start gap-2'>
      <input
        type='text'
        value={value ?? ''}
        onChange={e => onChange(e.target.value.length > 0 ? e.target.value : undefined)}
        placeholder={placeholder}
        data-track-category='automation-builder'
        data-track-name='VariableRefFieldInput'
        className='h-9 w-full flex-1 rounded-md border border-input bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40'
      />
      <UseVariableButton
        sources={variableSources}
        onPick={reference => onChange(reference)}
        targetEntityKind={targetEntityKind ?? null}
      />
    </div>
  );
}
