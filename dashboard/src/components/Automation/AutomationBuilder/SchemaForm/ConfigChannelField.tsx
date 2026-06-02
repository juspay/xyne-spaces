import { useMemo } from 'react';
import { EntityField, MultiEntityField } from './EntityField';
import { EntityKind, isVariableRefValue } from './SchemaForm.utils';
import { VariableRefField } from './VariableRefField';
import { ReferenceChip, UseVariableButton, useSeedSoleVariable } from './VariableFieldParts';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';

export type ChannelFieldMode = 'variable' | 'both';

type CommonProps = {
  variableSources: VariablePickerSource[];
  mode?: ChannelFieldMode;
  placeholder?: string;
};

type SingleProps = CommonProps & {
  multiple?: false;
  value?: string | undefined;
  onChange: (next: string | undefined) => void;
};

type MultiProps = CommonProps & {
  multiple: true;
  value: string[];
  onChange: (next: string[]) => void;
};

type ConfigChannelFieldProps = SingleProps | MultiProps;

export function ConfigChannelField(props: ConfigChannelFieldProps): React.ReactElement {
  if (props.multiple) return <MultiChannelField {...props} />;
  return <SingleChannelField {...props} />;
}

function SingleChannelField({
  value,
  onChange,
  variableSources,
  mode = 'both',
  placeholder,
}: SingleProps): React.ReactElement {
  useSeedSoleVariable(
    value,
    onChange,
    variableSources,
    mode === 'both' ? EntityKind.CHANNEL : null,
  );

  if (mode === 'variable') {
    return (
      <VariableRefField
        value={value}
        onChange={onChange}
        variableSources={variableSources}
        targetEntityKind={EntityKind.CHANNEL}
        placeholder={placeholder ?? 'Insert the channel id'}
      />
    );
  }

  if (isVariableRefValue(value)) {
    return (
      <ReferenceChip value={value} sources={variableSources} onClear={() => onChange(undefined)} />
    );
  }

  return (
    <div className='flex items-start gap-2'>
      <div className='flex-1'>
        <EntityField
          kind={EntityKind.CHANNEL}
          value={value}
          onChange={onChange}
          placeholder={placeholder ?? 'Pick a channel'}
        />
      </div>
      <UseVariableButton
        sources={variableSources}
        onPick={reference => onChange(reference)}
        targetEntityKind={EntityKind.CHANNEL}
      />
    </div>
  );
}

function MultiChannelField({
  value,
  onChange,
  variableSources,
  mode = 'both',
  placeholder,
}: MultiProps): React.ReactElement {
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
      {mode === 'both' ? (
        <div className='flex items-start gap-2'>
          <div className='flex-1'>
            <MultiEntityField
              kind={EntityKind.CHANNEL}
              value={concrete}
              onChange={next => onChange([...next, ...refs])}
              placeholder={placeholder ?? 'Pick channels'}
            />
          </div>
          <UseVariableButton
            sources={variableSources}
            onPick={addRef}
            targetEntityKind={EntityKind.CHANNEL}
          />
        </div>
      ) : (
        <div className='flex items-start gap-2'>
          <span className='flex-1 text-xs text-muted-foreground'>
            Add channels from the trigger or earlier steps.
          </span>
          <UseVariableButton
            sources={variableSources}
            onPick={addRef}
            targetEntityKind={EntityKind.CHANNEL}
          />
        </div>
      )}

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
