import type { Prisma } from '@prisma/client';
import { FormFieldType } from '@xyne/shared';
import { formEntityValueTextHash } from '@/utils/formEntityValueHash';

const uniqueStrings = (values: ReadonlyArray<string | number | boolean>): string[] =>
  [...new Set(values.map(value => String(value).trim()).filter(Boolean))];

/**
 * Prisma counterpart of applyTypedDynamicFieldFilter (@xyne/shared): narrows form_entity_values
 * rows of one field to those whose typed value is one of `values`. No usable values, or an
 * unknown field type, leaves only the field-presence match.
 */
export function typedDynamicFieldWhere(
  fieldType: string | null | undefined,
  values: ReadonlyArray<string | number | boolean>,
): Prisma.FormEntityValuesWhereInput {
  switch (fieldType) {
    case FormFieldType.STRING: {
      const texts = uniqueStrings(values);
      return texts.length > 0 ? { textHash: { in: [...new Set(texts.map(formEntityValueTextHash))] } } : {};
    }
    case FormFieldType.NUMBER: {
      const numbers = [...new Set(values.map(Number).filter(Number.isFinite))];
      return numbers.length > 0 ? { numberValue: { in: numbers } } : {};
    }
    case FormFieldType.BOOLEAN: {
      const booleans = [
        ...new Set(
          values.flatMap(value => {
            const normalized = String(value).trim().toLowerCase();
            return normalized === 'true' ? [true] : normalized === 'false' ? [false] : [];
          }),
        ),
      ];
      return booleans.length > 0 ? { OR: booleans.map(boolValue => ({ boolValue })) } : {};
    }
    case FormFieldType.SINGLE_SELECT:
    case FormFieldType.TICKET:
    case FormFieldType.DOC: {
      const options = uniqueStrings(values);
      return options.length > 0 ? { plainValue: { in: options } } : {};
    }
    case FormFieldType.MULTI_SELECT:
    case FormFieldType.USER: {
      const items = uniqueStrings(values);
      return items.length > 0 ? { items: { some: { item: { in: items } } } } : {};
    }
    case FormFieldType.DATE: {
      const times = [
        ...new Set(
          values
            .map(value => (typeof value === 'number' ? value : Date.parse(String(value))))
            .filter(Number.isFinite),
        ),
      ];
      return times.length > 0 ? { dateValue: { in: times.map(time => new Date(time)) } } : {};
    }
    default:
      return {};
  }
}
