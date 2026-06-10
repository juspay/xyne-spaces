import { useMemo } from 'react';
import { VariableRefField } from '../SchemaForm/VariableRefField';
import { EntityVariableField } from '../SchemaForm/EntityVariableField';
import { EntityKind } from '../SchemaForm/SchemaForm.utils';
import { SendMessageRichTextField } from '../SchemaForm/SendMessageRichTextField';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ValidationIssue } from '../../Automation.types';

type LinkType = 'NONE' | 'TICKET' | 'CONVERSATION' | 'MESSAGE' | 'CHANNEL' | 'EMAIL';

const LINK_OPTIONS: { value: LinkType; label: string }[] = [
  { value: 'NONE', label: 'No link' },
  { value: 'TICKET', label: 'Ticket' },
  { value: 'CONVERSATION', label: 'Conversation' },
  { value: 'MESSAGE', label: 'Message' },
  { value: 'CHANNEL', label: 'Channel' },
  { value: 'EMAIL', label: 'Email' },
];

// The id field's variable picker is scoped to this entity kind, so only ids of
// the selected kind are offered.
const LINK_KIND: Record<LinkType, EntityKind | null> = {
  NONE: null,
  TICKET: EntityKind.TICKET,
  CONVERSATION: EntityKind.CONVERSATION,
  MESSAGE: EntityKind.MESSAGE,
  CHANNEL: EntityKind.CHANNEL,
  EMAIL: EntityKind.EMAIL,
};

interface NotifyConfigShape {
  userId?: string;
  groupId?: string;
  title?: string;
  message?: string;
  linkType?: LinkType;
  linkId?: string;
}

interface NotifyStepFormProps {
  recipient: 'user' | 'group';
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
}

/**
 * Custom form for NOTIFY_USER / NOTIFY_GROUP. The link is a single type selector
 * plus one id field whose variable picker is scoped to the selected type (pick
 * "Conversation" → only conversation ids are offered). The URL is built
 * server-side from the type + id.
 */
export function NotifyStepForm({
  recipient,
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
}: NotifyStepFormProps): React.ReactElement {
  const cfg = value as NotifyConfigShape;
  const linkType: LinkType = cfg.linkType ?? 'NONE';

  const issuesAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) {
      if (i.path.startsWith(`${pathPrefix}.`))
        map.set(i.path.slice(pathPrefix.length + 1), i.message);
    }
    return map;
  }, [issues, pathPrefix]);

  const setField = <K extends keyof NotifyConfigShape>(
    key: K,
    next: NotifyConfigShape[K],
  ): void => {
    onChange({ ...cfg, [key]: next });
  };

  const linkKind = LINK_KIND[linkType];

  return (
    <div className='flex flex-col gap-5'>
      {recipient === 'user' ? (
        <FieldRow label='User' required error={issuesAt.get('userId')}>
          <EntityVariableField
            value={cfg.userId}
            onChange={next => setField('userId', next)}
            variableSources={variableSources}
            entityKind={EntityKind.USER}
            placeholder='Pick a user'
          />
        </FieldRow>
      ) : (
        <FieldRow label='User group' required error={issuesAt.get('groupId')}>
          <EntityVariableField
            value={cfg.groupId}
            onChange={next => setField('groupId', next)}
            variableSources={variableSources}
            entityKind={EntityKind.USER_GROUP}
            placeholder='Pick a user group'
          />
        </FieldRow>
      )}

      <FieldRow label='Title' required error={issuesAt.get('title')}>
        <VariableRefField
          value={cfg.title}
          onChange={next => setField('title', next)}
          variableSources={variableSources}
          placeholder='Notification title'
        />
      </FieldRow>

      <FieldRow
        label='Message'
        required
        error={issuesAt.get('message')}
        description='Type @ to mention. Use the Variable button to insert values.'
      >
        <SendMessageRichTextField
          value={cfg.message ?? ''}
          onChange={next => setField('message', next)}
          variableSources={variableSources}
          channelId={null}
          placeholder='Notification message'
        />
      </FieldRow>

      <FieldRow label='Link to' description='Optional — what clicking the notification opens.'>
        <Select
          value={linkType}
          onValueChange={v => {
            // Switching type (or to "No link") clears the previously-picked id.
            onChange({ ...cfg, linkType: v as LinkType, linkId: undefined });
          }}
        >
          <SelectTrigger className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINK_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      {linkKind && (
        <FieldRow
          label={`${LINK_OPTIONS.find(o => o.value === linkType)?.label} id`}
          error={issuesAt.get('linkId')}
        >
          <VariableRefField
            value={cfg.linkId}
            onChange={next => setField('linkId', next)}
            variableSources={variableSources}
            targetEntityKind={linkKind}
            placeholder={`Pick the ${LINK_OPTIONS.find(o => o.value === linkType)?.label.toLowerCase()}`}
          />
        </FieldRow>
      )}
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
