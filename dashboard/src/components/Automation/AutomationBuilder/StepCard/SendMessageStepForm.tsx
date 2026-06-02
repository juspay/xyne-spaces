import { useMemo } from 'react';
import { ConfigChannelField } from '../SchemaForm/ConfigChannelField';
import { SendMessageRichTextField } from '../SchemaForm/SendMessageRichTextField';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ValidationIssue } from '../../Automation.types';

interface SendMessageConfigShape {
  channelId?: string;
  content?: string;
}

interface SendMessageStepFormProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
}

export function SendMessageStepForm({
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
}: SendMessageStepFormProps): React.ReactElement {
  const cfg = value as SendMessageConfigShape;

  const issuesAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) {
      if (i.path.startsWith(`${pathPrefix}.`))
        map.set(i.path.slice(pathPrefix.length + 1), i.message);
    }
    return map;
  }, [issues, pathPrefix]);

  const setField = <K extends keyof SendMessageConfigShape>(
    key: K,
    next: SendMessageConfigShape[K],
  ): void => {
    onChange({ ...cfg, [key]: next });
  };

  return (
    <div className='flex flex-col gap-5'>
      <FieldRow
        label='Channel'
        error={issuesAt.get('channelId')}
        required
        description='Pick a channel or insert one from the trigger or an earlier step.'
      >
        <ConfigChannelField
          value={cfg.channelId}
          onChange={next => setField('channelId', next)}
          variableSources={variableSources}
          mode='both'
        />
      </FieldRow>

      <FieldRow
        label='Message'
        error={issuesAt.get('content')}
        required
        description='Type @ to mention a person. Use the Variable button to insert values from the trigger or earlier steps.'
      >
        <SendMessageRichTextField
          value={cfg.content ?? ''}
          onChange={next => setField('content', next)}
          variableSources={variableSources}
          channelId={cfg.channelId ?? null}
          placeholder='Type your message… use @ to mention someone'
        />
      </FieldRow>
    </div>
  );
}

function FieldRow({
  label,
  description,
  required,
  error,
  children,
}: {
  label: string;
  description?: string;
  required?: boolean;
  error?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-baseline gap-2'>
        <label className='text-sm font-medium text-foreground'>
          {label}
          {required && <span className='text-red-600'> *</span>}
        </label>
        {description && <span className='text-[11px] text-muted-foreground'>{description}</span>}
      </div>
      {children}
      {error && <span className='text-[11px] text-red-600'>{error}</span>}
    </div>
  );
}
