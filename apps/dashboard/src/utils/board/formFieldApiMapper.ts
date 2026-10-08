import { FormFieldType } from '@xyne/shared';
import type { CreateFormField } from '../../services/Form/formService';
import type { FormDetailResponse } from '../../services/Form/formService';
import type { FormField } from '../../components/Board/CreateFormSlideOut/CreateFormSlideOut.types';
import { fromLegacyFormFieldArray, toRestPayload } from '../form/formBuilderMapper';
import { v4 as uuidv4 } from 'uuid';

/** Board hosts build their REST payload through the same mapper as the FormBuilder adapter. */
export const mapFormFieldsToApiPayload = (fields: FormField[]): CreateFormField[] =>
  toRestPayload({ fields: fromLegacyFormFieldArray(fields) });

export const getFieldTypeLabel = (fieldType: FormFieldType): string => {
  switch (fieldType) {
    case FormFieldType.STRING:
      return 'String';
    case FormFieldType.NUMBER:
      return 'Number';
    case FormFieldType.BOOLEAN:
      return 'Boolean';
    case FormFieldType.DATE:
      return 'Date';
    case FormFieldType.SINGLE_SELECT:
      return 'Single Select';
    case FormFieldType.MULTI_SELECT:
      return 'Multi Select';
    case FormFieldType.USER:
      return 'User';
    case FormFieldType.DOC:
      return 'Document';
    case FormFieldType.TICKET:
      return 'Ticket';
    default:
      return fieldType;
  }
};

export const mapFormDetailsToBuilderFields = (formDetails: FormDetailResponse): FormField[] =>
  formDetails.fields.map(field => {
    const options = field.fieldOptions ?? field.fieldEnum;
    return {
      id: uuidv4(),
      persistedFieldId: field.id,
      ...(field.membershipId ? { membershipId: field.membershipId } : {}),
      fieldName: field.fieldName,
      fieldType: field.fieldType,
      isOptional: field.isOptional,
      ...(options ? { fieldEnum: options } : {}),
      ...(field.parentOptionId ? { parentOptionId: field.parentOptionId } : {}),
    };
  });
