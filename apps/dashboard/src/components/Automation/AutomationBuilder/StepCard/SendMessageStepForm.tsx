import { useMemo } from 'react';
import { ConfigChannelField } from '../SchemaForm/ConfigChannelField';
import { EntityVariableField, MultiEntityVariableField } from '../SchemaForm/EntityVariableField';
import { EntityKind } from '../SchemaForm/SchemaForm.utils';
import { SendMessageRichTextField } from '../SchemaForm/SendMessageRichTextField';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ValidationIssue } from '../../Automation.types';
import type { AutomationTemplateAttachment } from '../../../../api/automationsApi';
import { TemplateAttachmentsField } from './TemplateAttachmentsField';

interface SendMessageConfigShape {
  channelId?: string;
  userIds?: string[];
  senderId?: string;
  content?: string;
  attachments?: AutomationTemplateAttachment[];
}

interface SendMessageStepFormProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
  stepId: string;
  readOnly?: boolean;
}

export function SendMessageStepForm({
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
  stepId,
  readOnly = false,
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
        label='Channel (optional)'
        error={issuesAt.get('channelId')}
        description='Pick a channel to post in. Leave empty to only send DMs.'
      >
        <ConfigChannelField
          value={cfg.channelId}
          onChange={next => setField('channelId', next)}
          variableSources={variableSources}
          mode='both'
        />
      </FieldRow>

      <FieldRow
        label='Users (optional)'
        error={issuesAt.get('userIds')}
        description='Select users to DM. Leave empty to only post to the channel.'
      >
        <MultiEntityVariableField
          entityKind={EntityKind.USER}
          value={Array.isArray(cfg.userIds) ? cfg.userIds : []}
          onChange={next => setField('userIds', next)}
          variableSources={variableSources}
          placeholder='Pick users to DM'
        />
      </FieldRow>

      <FieldRow
        label='Send as'
        error={issuesAt.get('senderId')}
        description='Who the message is posted as. Leave empty to post as the automations bot.'
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
        description='Optional when files are attached. Type @ to mention someone or insert an automation variable.'
      >
        <SendMessageRichTextField
          value={cfg.content ?? ''}
          onChange={next => setField('content', next)}
          variableSources={variableSources}
          channelId={cfg.channelId ?? null}
          placeholder='Type your message… use @ to mention someone'
        />
      </FieldRow>

      <FieldRow
        label='Files'
        error={issuesAt.get('attachments')}
        description='Attach UTF-8 text templates. Variables are resolved into run-specific copies before the message is sent.'
      >
        <TemplateAttachmentsField
          stepId={stepId}
          value={Array.isArray(cfg.attachments) ? cfg.attachments : []}
          onChange={next => setField('attachments', next)}
          variableSources={variableSources}
          readOnly={readOnly}
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
