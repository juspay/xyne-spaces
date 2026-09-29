import { FormContextType, FormEntityType } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { memo, useCallback, useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useUsers } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { runTicketMutation } from '@/src/screens/ticket-details/run-ticket-mutation';
import { showMessageToast } from '@/src/utils/toast';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

import {
  resolveBoardAdditionalFields,
  resolveLeftoverFieldValues,
  type FormEntityValueRow,
  type ResolvedBoardAdditionalField,
} from './board-form-entity-values';
import { EditableFormField } from './editable-form-field';
import {
  formatLeftoverFieldValue,
  getFieldEffectiveRaw,
  getFormEntityFieldEnum,
  getFormEntityFieldName,
  getFormEntityFieldType,
  isFormFieldEmpty,
} from './form-field-helpers';
import { isFieldActive } from './form-field-shared';
import type { MembershipFormFieldRow } from './resolve-display-form-fields';

type TicketCustomFieldsSectionProps = {
  ticketId: string;
  boardId: string | null | undefined;
  workspaceId: string | null | undefined;
  isArchived?: boolean;
};

export const TicketCustomFieldsSection = memo(function TicketCustomFieldsSection({
  ticketId,
  boardId,
  workspaceId,
  isArchived = false,
}: TicketCustomFieldsSectionProps): ReactElement | null {
  const zero = useZero();
  const users = useUsers();
  const [showEmptyFields, setShowEmptyFields] = useState(false);

  const [formEntityValues] = useCachedQuery(
    queries.getFormEntityValuesByEntityId({ entityId: ticketId }),
    { enabled: Boolean(ticketId) },
  );

  const [formMapping] = useCachedQuery(
    queries.getFormMappingByContextId({
      contextId: boardId ?? '',
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: Boolean(boardId) },
  );

  const boardCustomFieldsFormId = formMapping?.formId;

  const allFormFields = useMemo(() => {
    if (!workspaceId) return [] as ResolvedBoardAdditionalField[];

    const allFields = resolveBoardAdditionalFields({
      formMapping: formMapping
        ? {
            formId: formMapping.formId,
            formFields: formMapping.formFields as unknown as MembershipFormFieldRow[],
          }
        : undefined,
      formEntityValues: (formEntityValues ?? []) as FormEntityValueRow[],
      boardId,
      ticketId,
      workspaceId,
    });

    const allFieldDefs = allFields.map(fv => ({
      id: fv.fieldId,
      fieldEnum:
        fv.globalField?.fieldOptions ??
        fv.globalField?.fieldEnum ??
        fv.formField?.globalField?.fieldOptions ??
        fv.formField?.globalField?.fieldEnum ??
        fv.formField?.fieldOptions ??
        fv.formField?.fieldEnum,
    }));

    const getFieldEffectiveValue = (fieldId: string): string | undefined => {
      const parentEntry = allFields.find(fv => fv.fieldId === fieldId);
      if (!parentEntry) return undefined;
      const parentRaw = getFieldEffectiveRaw(parentEntry);
      return typeof parentRaw === 'string' ? parentRaw : undefined;
    };

    const parentOptionIdByFieldId = new Map(
      ((formMapping?.formFields ?? []) as unknown as MembershipFormFieldRow[]).map(row => [
        row.globalFieldId ?? row.id,
        row.parentOptionId ?? null,
      ]),
    );

    return allFields.filter(fieldValue => {
      const parentOptionId = parentOptionIdByFieldId.get(fieldValue.fieldId) ?? null;
      if (!parentOptionId) return true;
      return isFieldActive({ parentOptionId }, allFieldDefs, getFieldEffectiveValue);
    });
  }, [boardId, formEntityValues, formMapping, ticketId, workspaceId]);

  const leftoverFieldValues = useMemo(
    () =>
      resolveLeftoverFieldValues({
        formMapping: formMapping
          ? {
              formId: formMapping.formId,
              formFields: formMapping.formFields as unknown as MembershipFormFieldRow[],
            }
          : undefined,
        formEntityValues: (formEntityValues ?? []) as FormEntityValueRow[],
        boardId,
      }),
    [boardId, formEntityValues, formMapping],
  );

  const leftoverFieldUserById = useMemo(() => {
    return new Map(users.map(user => [user.id, user]));
  }, [users]);

  const hiddenEmptyFieldCount = allFormFields.filter(isFormFieldEmpty).length;

  const orderedFormFields = useMemo(
    () =>
      [...allFormFields].sort(
        (a, b) => Number(isFormFieldEmpty(a)) - Number(isFormFieldEmpty(b)),
      ),
    [allFormFields],
  );

  const visibleFormFields = showEmptyFields
    ? orderedFormFields
    : orderedFormFields.filter(fieldValue => !isFormFieldEmpty(fieldValue));

  const handleFormFieldSave = useCallback(
    (
      formEntityValueId: string,
      newValue: string[],
      isPlaceholder: boolean,
      formId?: string | null,
      membershipFieldId?: string | null,
    ): void => {
      if (isPlaceholder) {
        const resolvedFieldId = formEntityValueId.replace(/^(placeholder|prefill)-/, '');
        if (!boardId) {
          showMessageToast('Cannot save field without a board.', 'error');
          return;
        }

        // Newer shared pins expose createV2 (global fields + explicit formId).
        // mobile-dev's pin only has legacy create, which looks up form_fields by id.
        const createV2 = (
          mutators.formEntityValue as {
            createV2?: (args: {
              id: string;
              entityId: string;
              entityType: FormEntityType;
              fieldId: string;
              formId: string;
              newValue: string[];
              timestamp: number;
              contextId?: string;
            }) => Parameters<typeof zero.mutate>[0];
          }
        ).createV2;

        if (createV2) {
          const resolvedFormId = formId ?? boardCustomFieldsFormId;
          if (!resolvedFormId) {
            showMessageToast(
              'Board custom fields form is not available yet. Please try again.',
              'error',
            );
            return;
          }
          void runTicketMutation(
            zero.mutate(
              createV2({
                id: uuidv4(),
                entityId: ticketId,
                entityType: FormEntityType.TICKET,
                fieldId: resolvedFieldId,
                formId: resolvedFormId,
                newValue,
                timestamp: Date.now(),
                contextId: boardId,
              }),
            ),
            'Failed to save field',
          );
          return;
        }

        const legacyFieldId = membershipFieldId ?? resolvedFieldId;
        void runTicketMutation(
          zero.mutate(
            mutators.formEntityValue.create({
              id: uuidv4(),
              entityId: ticketId,
              entityType: FormEntityType.TICKET,
              fieldId: legacyFieldId,
              newValue,
              timestamp: Date.now(),
              contextId: boardId,
            }),
          ),
          'Failed to save field',
        );
        return;
      }

      void runTicketMutation(
        zero.mutate(
          mutators.formEntityValue.update({
            formEntityValueId,
            newValue,
            updatedAt: Date.now(),
          }),
        ),
        'Failed to save field',
      );
    },
    [boardCustomFieldsFormId, boardId, ticketId, zero],
  );

  if (allFormFields.length === 0 && leftoverFieldValues.length === 0) {
    return null;
  }

  return (
    <View className='px-4 py-4 border-t border-ticket-overview-divider'>
      <Text className='mb-2 text-sm font-bold uppercase tracking-wider text-secondary-foreground'>
        Fields
      </Text>

      {isArchived ? (
        <Text className='mb-2 text-[12px] text-ticket-meta-left-text'>
          Read-only — this ticket is archived
        </Text>
      ) : null}

      {visibleFormFields.map(fieldValue => (
        <EditableFormField
          key={fieldValue.resolvedFieldId}
          fieldName={getFormEntityFieldName(fieldValue)}
          fieldValue={getFieldEffectiveRaw(fieldValue)}
          fieldType={getFormEntityFieldType(fieldValue)}
          fieldEnum={getFormEntityFieldEnum(fieldValue)}
          readOnly={isArchived}
          onSave={newValue =>
            handleFormFieldSave(
              fieldValue.id,
              newValue,
              fieldValue.isPlaceholder,
              fieldValue.formId,
              fieldValue.formField?.id ?? null,
            )
          }
        />
      ))}

      {leftoverFieldValues.map(field => (
        <View
          key={field.resolvedFieldId}
          className='border-b border-ticket-overview-divider py-3'
        >
          <View className='flex-row items-start'>
            <View className='w-[186px] pr-3'>
              <Text className='text-[13px] font-medium text-ticket-meta-left-text'>
                {field.fieldName}
              </Text>
              <Text className='mt-0.5 text-[11px] text-ticket-meta-left-text'>
                no longer defined on this board
              </Text>
            </View>
            <Text className='min-w-0 flex-1 text-[14px] font-medium text-foreground'>
              {formatLeftoverFieldValue(field, leftoverFieldUserById)}
            </Text>
          </View>
        </View>
      ))}

      {(hiddenEmptyFieldCount > 0 || showEmptyFields) && allFormFields.length > 0 ? (
        <Pressable
          accessibilityRole='button'
          onPress={() => setShowEmptyFields(current => !current)}
          className='mt-3 self-start active:opacity-70'
        >
          <Text className='text-[13px] font-medium text-ticket-meta-left-text'>
            {showEmptyFields
              ? 'Hide empty fields'
              : `Show ${hiddenEmptyFieldCount} empty field${hiddenEmptyFieldCount === 1 ? '' : 's'}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});
