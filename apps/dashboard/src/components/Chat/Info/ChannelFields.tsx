// A channel's fields (e.g. which merchant it is for), from the workspace's channel form. Channel admins
// edit them; a Channels desk copies them onto the tickets it opens for the channel.
import type { ReactElement } from 'react';
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
import { EditableFormField } from '../../Tickets/TicketDetails/EditableFormField';

export function ChannelFields({
  channelId,
  canEdit,
}: {
  channelId: string;
  canEdit: boolean;
}): ReactElement {
  const zero = useZero();
  const { workspaceId } = useAuthContextValues();
  const [mapping, mappingDetails] = useCachedQuery(
    queries.getFormMappingByContextId({
      contextId: workspaceId ?? '',
      contextType: FormContextType.WORKSPACE,
      entityType: FormEntityType.CHANNEL,
    }),
    { enabled: !!workspaceId },
  );
  const [values] = useCachedQuery(queries.getFormEntityValuesByEntityId({ entityId: channelId }));

  if (!mapping) {
    if (mappingDetails.type !== 'complete') return <></>;
    return (
      <div className='px-6 py-10 text-center text-sm text-muted-foreground'>
        No channel fields yet. A workspace admin can add them in Forms (context WORKSPACE, entity
        CHANNEL).
      </div>
    );
  }

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
    <div className='flex flex-col gap-1 px-6 py-4'>
      {fields.map(field => {
        const value = valueOf.get(field.id);
        return (
          <EditableFormField
            key={field.id}
            readOnly={!canEdit}
            fieldName={field.name}
            fieldValue={value?.actualFieldValue ?? value?.fieldValue ?? null}
            fieldType={field.type}
            fieldEnum={field.options.length > 0 ? field.options : undefined}
            onSave={newValue => void save(field.id, newValue)}
          />
        );
      })}
    </div>
  );
}
