import { useMemo } from 'react';
import { VariableRefField } from '../SchemaForm/VariableRefField';
import { EntityVariableField } from '../SchemaForm/EntityVariableField';
import { EntityKind } from '../SchemaForm/SchemaForm.utils';
import { SendMessageRichTextField } from '../SchemaForm/SendMessageRichTextField';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ValidationIssue } from '../../Automation.types';

interface ReplyOnMessageConfigShape {
  conversationId?: string;
  senderId?: string;
  content?: string;
}

interface ReplyOnMessageStepFormProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
}

export function ReplyOnMessageStepForm({
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
}: ReplyOnMessageStepFormProps): React.ReactElement {
  const cfg = value as ReplyOnMessageConfigShape;

  const issuesAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) {
      if (i.path.startsWith(`${pathPrefix}.`))
        map.set(i.path.slice(pathPrefix.length + 1), i.message);
    }
    return map;
  }, [issues, pathPrefix]);

  const setField = <K extends keyof ReplyOnMessageConfigShape>(
    key: K,
    next: ReplyOnMessageConfigShape[K],
  ): void => {
    onChange({ ...cfg, [key]: next });
  };

  return (
    <div className='flex flex-col gap-5'>
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
        label='Send as'
        error={issuesAt.get('senderId')}
        description='Who the reply is posted as. Leave empty to post as the automations bot.'
      >
        <EntityVariableField
          value={cfg.senderId}
          onChange={next => setField('senderId', next)}
          variableSources={variableSources}
          entityKind={EntityKind.SENDER}
          placeholder='Pick a bot (defaults to the automations bot)'
        />
      </FieldRow>

      <FieldRow
        label='Message'
        error={issuesAt.get('content')}
        required
        description='Type @ to mention a person. Use the Variable button to insert values from the trigger or earlier steps.'
      >
        {/* No concrete channel here (the reply targets a conversation), so the
            mention search falls back to workspace-wide. */}
        <SendMessageRichTextField
          value={cfg.content ?? ''}
          onChange={next => setField('content', next)}
          variableSources={variableSources}
          channelId={null}
          placeholder='Type your reply… use @ to mention someone'
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
