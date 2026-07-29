import { useMemo } from 'react';
import { ConfigChannelField } from '../SchemaForm/ConfigChannelField';
import { VariableRefField } from '../SchemaForm/VariableRefField';
import { EntityKind } from '../SchemaForm/SchemaForm.utils';
import { AutomationRichTextField } from '../SchemaForm/AutomationRichTextField';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ValidationIssue } from '../../Automation.types';

interface CreateEmailDraftConfigShape {
  channelId?: string;
  conversationId?: string;
  draftContent?: string;
}

interface CreateEmailDraftStepFormProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
}

export function CreateEmailDraftStepForm({
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
}: CreateEmailDraftStepFormProps): React.ReactElement {
  const cfg = value as CreateEmailDraftConfigShape;

  const issuesAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) {
      if (i.path.startsWith(`${pathPrefix}.`))
        map.set(i.path.slice(pathPrefix.length + 1), i.message);
    }
    return map;
  }, [issues, pathPrefix]);

  const setField = <K extends keyof CreateEmailDraftConfigShape>(
    key: K,
    next: CreateEmailDraftConfigShape[K],
  ): void => {
    onChange({ ...cfg, [key]: next });
  };

  return (
    <div className='flex flex-col gap-5'>
      <FieldRow
        label='Channel'
        description='Channel the draft belongs to — usually from the trigger.'
        error={issuesAt.get('channelId')}
        required
      >
        <ConfigChannelField
          value={cfg.channelId}
          onChange={next => setField('channelId', next)}
          variableSources={variableSources}
          mode='variable'
        />
      </FieldRow>

      <FieldRow label='Conversation Id' error={issuesAt.get('conversationId')} required>
        <VariableRefField
          value={cfg.conversationId}
          onChange={next => setField('conversationId', next)}
          variableSources={variableSources}
          targetEntityKind={EntityKind.CONVERSATION}
          placeholder='Pick a conversation'
        />
      </FieldRow>

      <FieldRow
        label='Draft content'
        description='Draft body content.'
        error={issuesAt.get('draftContent')}
        required
      >
        <AutomationRichTextField
          value={cfg.draftContent ?? ''}
          onChange={next => setField('draftContent', next)}
          variableSources={variableSources}
          placeholder='Write the draft…'
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
