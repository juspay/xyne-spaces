// A channel's fields (e.g. which merchant it is for), from the workspace's channel form. Shown only on
// channels that have values, and only the fields the channel has (the form may hold other use cases' fields);
// channel admins correct them or add another. A Channels desk copies them onto the tickets it opens for the channel.
import { useState, type ReactElement } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import {
  FormContextType,
  FormEntityType,
  FormFieldType,
  parseFieldOptionValues,
} from '@xyne/shared';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input';
import { EditableFormField } from '../../Tickets/TicketDetails/EditableFormField';

const TEXT_TYPES = new Set([FormFieldType.STRING, FormFieldType.NUMBER]);

// Saves on blur or Enter, only when the value changed.
function TextFieldInput({
  value,
  type,
  disabled,
  onSave,
}: {
  value: string;
  type: FormFieldType;
  disabled: boolean;
  onSave: (newValue: string[]) => void;
}): ReactElement {
  const [draft, setDraft] = useState(value);
  const commit = (): void => {
    const next = draft.trim();
    if (next !== value) onSave(next ? [next] : []);
  };
  return (
    <Input
      variant='flat'
      type={type === FormFieldType.NUMBER ? 'number' : 'text'}
      value={draft}
      disabled={disabled}
      placeholder={disabled ? '-' : 'Not set'}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

export function ChannelFields({
  channelId,
  canEdit,
}: {
  channelId: string;
  canEdit: boolean;
}): ReactElement | null {
  const zero = useZero();
  const { workspaceId } = useAuthContextValues();
  const [mapping] = useCachedQuery(
    queries.getFormMappingByContextId({
      contextId: workspaceId ?? '',
      contextType: FormContextType.WORKSPACE,
      entityType: FormEntityType.CHANNEL,
    }),
    { enabled: !!workspaceId },
  );
  const [values, valuesDetails] = useCachedQuery(
    queries.getFormEntityValuesByEntityId({ entityId: channelId }),
  );
  // Fields picked with "Add field", shown until they get a value.
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);

  if (!mapping || mapping.formFields.length === 0) return null;
  // Wait for the saved values: an edit made before they load would be lost, or saved as a second value.
  if (valuesDetails.type !== 'complete') return null;

  // Values are keyed like ticket fields: the global field's id, or the form field's for legacy rows.
  const fields = [...mapping.formFields]
    .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    .map(row => ({
      id: row.globalFieldId ?? row.id,
      name: row.globalField?.fieldName ?? row.fieldName ?? 'Unknown field',
      type: row.globalField?.fieldType ?? row.fieldType ?? FormFieldType.STRING,
      options: parseFieldOptionValues(
        row.globalField?.fieldOptions ??
          row.globalField?.fieldEnum ??
          row.fieldOptions ??
          row.fieldEnum,
      ),
    }));
  const valueOf = new Map(
    (values ?? [])
      .filter(value => (value.entityType as FormEntityType) === FormEntityType.CHANNEL)
      .map(value => [value.fieldId, value]),
  );
  // Only channels given fields (e.g. by the app that made them) show them; others stay as they are.
  if (!fields.some(field => valueOf.has(field.id))) return null;
  const shown = fields.filter(field => valueOf.has(field.id) || added.has(field.id));
  const hidden = fields.filter(field => !valueOf.has(field.id) && !added.has(field.id));

  const save = async (fieldId: string, newValue: string[]): Promise<void> => {
    const existing = valueOf.get(fieldId);
    const result = await zero.mutate(
      existing
        ? mutators.formEntityValue.update({
            formEntityValueId: existing.id,
            newValue,
            updatedAt: Date.now(),
          })
        : mutators.formEntityValue.createV2({
            id: uuidv4(),
            entityId: channelId,
            entityType: FormEntityType.CHANNEL,
            fieldId,
            formId: mapping.formId,
            newValue,
            timestamp: Date.now(),
            ...(workspaceId && { contextId: workspaceId }),
          }),
    ).server;
    if (result.type === 'error') {
      toast.error('Failed to save field', { description: result.error.message });
    }
  };

  return (
    <div className='bg-card p-[12px] rounded-[12px] border border-border'>
      <div className='flex flex-col gap-y-3'>
        <div className='flex flex-col gap-y-1'>
          <p className='text-sm font-medium text-foreground'>Channel fields</p>
          <p className='text-sm text-muted-foreground'>
            Copied onto tickets a Channels desk opens for this channel.
          </p>
        </div>
        {shown.map(field => {
          const value = valueOf.get(field.id);
          const current = value?.actualFieldValue ?? value?.fieldValue ?? null;
          if (!TEXT_TYPES.has(field.type)) {
            return (
              <EditableFormField
                key={field.id}
                readOnly={!canEdit}
                fieldName={field.name}
                fieldValue={current}
                fieldType={field.type}
                fieldEnum={field.options.length > 0 ? field.options : undefined}
                onSave={newValue => void save(field.id, newValue)}
              />
            );
          }
          const text = current === null ? '' : String(current);
          return (
            <label key={field.id} className='flex flex-col gap-y-1.5'>
              <span className='text-sm text-foreground'>{field.name}</span>
              <TextFieldInput
                // Remount when the saved value changes elsewhere.
                key={text}
                value={text}
                type={field.type}
                disabled={!canEdit}
                onSave={newValue => void save(field.id, newValue)}
              />
            </label>
          );
        })}
        {canEdit && hidden.length > 0 && !picking && (
          <Button
            variant='link'
            size='inline'
            className='p-0 text-sm'
            onClick={() => setPicking(true)}
          >
            + Add field
          </Button>
        )}
        {canEdit && picking && (
          <div className='flex flex-wrap gap-2'>
            {hidden.map(field => (
              <Button
                key={field.id}
                variant='outline'
                size='sm'
                onClick={() => {
                  setAdded(prev => new Set(prev).add(field.id));
                  setPicking(false);
                }}
              >
                {field.name}
              </Button>
            ))}
          </div>
        )}
        {!canEdit && (
          <p className='text-sm text-muted-foreground'>
            You don&apos;t have permission to change these fields.
          </p>
        )}
      </div>
    </div>
  );
}
