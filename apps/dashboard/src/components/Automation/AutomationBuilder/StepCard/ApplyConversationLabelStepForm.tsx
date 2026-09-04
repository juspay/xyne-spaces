import { useMemo } from 'react';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import { VariableRefField } from '../SchemaForm/VariableRefField';
import { EntityKind } from '../SchemaForm/SchemaForm.utils';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ValidationIssue } from '../../Automation.types';
import { useAuth } from '../../../../hooks/useAuth';
import { cn } from '../../../../utils/classNames';

interface ApplyConversationLabelConfigShape {
  conversationId?: string;
  channelId?: string;
  labelName?: string;
  color?: string;
  labelId?: string;
}

interface ApplyConversationLabelStepFormProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
}

const LABEL_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

const colorForName = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length] ?? '#6b7280';
};

export function ApplyConversationLabelStepForm({
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
}: ApplyConversationLabelStepFormProps): React.ReactElement {
  const { user } = useAuth();
  const cfg = value as ApplyConversationLabelConfigShape;
  const channelId =
    typeof cfg.channelId === 'string' && !cfg.channelId.includes('{{') ? cfg.channelId : '';

  const [catalog] = useCachedQuery(queries.conversationLabelsByChannelId({ channelId }), {
    enabled: !!channelId,
  });

  const issuesAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) {
      if (i.path.startsWith(`${pathPrefix}.`))
        map.set(i.path.slice(pathPrefix.length + 1), i.message);
    }
    return map;
  }, [issues, pathPrefix]);

  const setField = <K extends keyof ApplyConversationLabelConfigShape>(
    key: K,
    next: ApplyConversationLabelConfigShape[K],
  ): void => {
    onChange({ ...cfg, [key]: next });
  };

  return (
    <div className='flex flex-col gap-5'>
      <FieldRow
        label='Conversation'
        description='Email thread to label — usually from the trigger.'
        error={issuesAt.get('conversationId')}
        required
      >
        <VariableRefField
          value={cfg.conversationId}
          onChange={next => setField('conversationId', next)}
          variableSources={variableSources}
          targetEntityKind={EntityKind.CONVERSATION}
          placeholder='{{context.trigger.email.conversationId}}'
        />
      </FieldRow>

      <FieldRow
        label='Channel'
        description='Desk channel for the label catalog.'
        error={issuesAt.get('channelId')}
        required
      >
        <VariableRefField
          value={cfg.channelId}
          onChange={next => setField('channelId', next)}
          variableSources={variableSources}
          targetEntityKind={EntityKind.CHANNEL}
          placeholder='Channel id or {{context…}}'
        />
      </FieldRow>

      <FieldRow
        label='Label'
        description='Label from this channel’s catalog (created if missing).'
        error={issuesAt.get('labelName')}
        required
      >
        <input
          type='text'
          value={cfg.labelName ?? ''}
          onChange={e => {
            const name = e.target.value;
            const matches = (catalog ?? []).filter(
              l => l.name.toLowerCase() === name.trim().toLowerCase(),
            );
            const existing = matches.find(l => l.createdBy === user?.id) ?? matches[0];
            onChange({
              ...cfg,
              labelName: name,
              labelId: existing?.id,
              color: existing?.color ?? colorForName(name),
            });
          }}
          list={`apply-label-suggestions-${pathPrefix}`}
          placeholder='e.g. VIP / Refunds'
          className='h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground'
          data-track-category='automation-builder'
          data-track-name='apply-conversation-label-name'
        />
        <datalist id={`apply-label-suggestions-${pathPrefix}`}>
          {(catalog ?? []).map(l => (
            <option key={l.id} value={l.name} />
          ))}
        </datalist>
        {channelId && (catalog?.length ?? 0) > 0 && (
          <div className='mt-2 flex flex-wrap gap-1.5'>
            {catalog.slice(0, 12).map(label => {
              const selected =
                (cfg.labelName ?? '').trim().toLowerCase() === label.name.toLowerCase();
              return (
                <button
                  key={label.id}
                  type='button'
                  onClick={() =>
                    onChange({
                      ...cfg,
                      labelName: label.name,
                      labelId: label.id,
                      color: label.color ?? colorForName(label.name),
                    })
                  }
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]',
                    selected
                      ? 'border-foreground bg-accent text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent/40',
                  )}
                  data-track-category='automation-builder'
                  data-track-name='apply-conversation-label-chip'
                >
                  <span
                    className='size-2 rounded-full'
                    style={{ backgroundColor: label.color ?? colorForName(label.name) }}
                  />
                  {label.name}
                </button>
              );
            })}
          </div>
        )}
      </FieldRow>
    </div>
  );
}

function FieldRow({
  label,
  description,
  error,
  required,
  children,
}: {
  label: string;
  description?: string;
  error?: string | undefined;
  required?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex flex-col gap-0.5'>
        <span className='text-xs font-medium text-foreground'>
          {label}
          {required ? <span className='text-red-500'> *</span> : null}
        </span>
        {description && <span className='text-[11px] text-muted-foreground'>{description}</span>}
      </div>
      {children}
      {error && <span className='text-[11px] text-red-600 dark:text-red-400'>{error}</span>}
    </div>
  );
}
