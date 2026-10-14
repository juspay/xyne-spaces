import { useMemo } from 'react';
import { FormFieldType } from '@xyne/shared';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';

export type DeskDynamicFieldDef = {
  id: string;
  name: string;
  fieldType: FormFieldType;
  /** Enum options for SELECT fields. */
  fieldEnum: string[];
};

type FormFieldRow = {
  id?: string | null;
  name?: string | null;
  fieldType?: FormFieldType | string | null;
  fieldEnum?: string[] | null;
};

/**
 * Desk board custom fields for filter drawer rows (dashboard deskDynamicFields).
 */
export function useTicketDynamicFieldFilterOptions(channelId: string): {
  fields: DeskDynamicFieldDef[];
  fieldTypesById: Map<string, FormFieldType>;
} {
  const [prefs] = useCachedQuery(queries.getEmailChannelPreference({ channelId }), {
    enabled: Boolean(channelId),
    ttl: '10m',
  });
  const boardId = (prefs?.[0] as { boardId?: string | null } | undefined)?.boardId ?? '';

  const [board] = useCachedQuery(queries.boardDetailById({ boardId }), {
    enabled: Boolean(boardId),
    ttl: '10m',
  });

  const fields = useMemo((): DeskDynamicFieldDef[] => {
    const map = new Map<string, DeskDynamicFieldDef>();
    const mappings =
      (
        board as {
          formContextMappings?: ReadonlyArray<{ formFields?: readonly FormFieldRow[] }>;
        } | null
      )?.formContextMappings ?? [];

    for (const mapping of mappings) {
      for (const field of mapping.formFields ?? []) {
        if (!field.id || map.has(field.id)) continue;
        const fieldType = normalizeFormFieldType(field.fieldType);
        if (!fieldType) continue;
        // Filter UI supports select / boolean / string / number (scalar V4 path).
        if (
          fieldType !== FormFieldType.SINGLE_SELECT &&
          fieldType !== FormFieldType.MULTI_SELECT &&
          fieldType !== FormFieldType.BOOLEAN
        ) {
          continue;
        }
        map.set(field.id, {
          id: field.id,
          name: field.name?.trim() || 'Untitled field',
          fieldType,
          fieldEnum: Array.isArray(field.fieldEnum) ? field.fieldEnum.map(String) : [],
        });
      }
    }
    return [...map.values()];
  }, [board]);

  const fieldTypesById = useMemo(() => {
    return new Map(fields.map(f => [f.id, f.fieldType]));
  }, [fields]);

  return { fields, fieldTypesById };
}

function normalizeFormFieldType(
  raw: FormFieldType | string | null | undefined,
): FormFieldType | null {
  if (!raw) return null;
  const value = String(raw);
  if ((Object.values(FormFieldType) as string[]).includes(value)) {
    return value as FormFieldType;
  }
  return null;
}
