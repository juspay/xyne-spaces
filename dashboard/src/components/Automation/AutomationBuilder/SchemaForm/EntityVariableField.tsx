import { EntityField } from './EntityField';
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
