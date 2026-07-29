import { useMemo } from 'react';
import { EntityField, MultiEntityField } from './EntityField';
import { EntityKind, isVariableRefValue } from './SchemaForm.utils';
import { ReferenceChip, UseVariableButton } from './VariableFieldParts';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';

interface EntityVariableFieldProps {
  value?: string | undefined;
  onChange: (next: string | undefined) => void;
  variableSources: VariablePickerSource[];
  entityKind: EntityKind;
  placeholder?: string;
}

/**
 * An entity field that also accepts a `{{variable}}`: shows the entity picker
 * plus a "Use variable" button, and a removable {@link ReferenceChip} once a
 * variable is selected. Generic over the entity kind (user, channel, etc.).
 */
export function EntityVariableField({
  value,
  onChange,
  variableSources,
  entityKind,
  placeholder,
}: EntityVariableFieldProps): React.ReactElement {
  if (isVariableRefValue(value)) {
    return (
      <ReferenceChip value={value} sources={variableSources} onClear={() => onChange(undefined)} />
    );
  }

  return (
    <div className='flex items-start gap-2'>
      <div className='flex-1'>
        <EntityField
          kind={entityKind}
          value={value}
          onChange={onChange}
          {...(placeholder !== undefined && { placeholder })}
        />
      </div>
      <UseVariableButton
        sources={variableSources}
        onPick={reference => onChange(reference)}
        targetEntityKind={entityKind}
      />
    </div>
  );
}

interface MultiEntityVariableFieldProps {
  value: string[];
  onChange: (next: string[]) => void;
  variableSources: VariablePickerSource[];
  entityKind: EntityKind;
  placeholder?: string;
}

export function MultiEntityVariableField({
  value,
  onChange,
  variableSources,
  entityKind,
  placeholder,
}: MultiEntityVariableFieldProps): React.ReactElement {
  const refs = useMemo(() => value.filter(isVariableRefValue), [value]);
  const concrete = useMemo(() => value.filter(v => !isVariableRefValue(v)), [value]);

  const addRef = (reference: string): void => {
    if (value.includes(reference)) return;
    onChange([...value, reference]);
  };
  const removeRef = (reference: string): void => {
    onChange(value.filter(v => v !== reference));
  };

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-start gap-2'>
        <div className='flex-1'>
          <MultiEntityField
            kind={entityKind}
            value={concrete}
            onChange={next => onChange([...next, ...refs])}
            {...(placeholder !== undefined && { placeholder })}
          />
        </div>
        <UseVariableButton
          sources={variableSources}
          onPick={addRef}
          targetEntityKind={entityKind}
        />
      </div>

      {refs.length > 0 && (
        <div className='flex flex-wrap gap-1.5'>
          {refs.map(ref => (
            <ReferenceChip
              key={ref}
              value={ref}
              sources={variableSources}
              onClear={() => removeRef(ref)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
