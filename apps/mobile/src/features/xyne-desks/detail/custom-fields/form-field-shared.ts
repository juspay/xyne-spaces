/**
 * Local copies of @xyne/shared form-field helpers.
 * mobile-dev's shared pin does not export these yet; keep the dashboard
 * semantics here until the pin includes formFieldOptions / formFieldBranching.
 */

export type FieldEnumOption = { id: string; value: string };

const generateOptionId = (): string =>
  `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const parseFieldOptions = (fieldEnum: unknown): FieldEnumOption[] => {
  let value = fieldEnum;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) return [];

  return value
    .map((entry): FieldEnumOption | undefined => {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        return trimmed ? { id: generateOptionId(), value: trimmed } : undefined;
      }
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { id?: unknown }).id === 'string' &&
        typeof (entry as { value?: unknown }).value === 'string'
      ) {
        const trimmed = (entry as { value: string }).value.trim();
        return trimmed ? { id: (entry as { id: string }).id, value: trimmed } : undefined;
      }
      return undefined;
    })
    .filter((option): option is FieldEnumOption => option !== undefined);
};

export const parseFieldOptionValues = (fieldEnum: unknown): string[] =>
  parseFieldOptions(fieldEnum).map(option => option.value);

export const resolveParentOption = <TField extends { fieldEnum?: unknown }>(
  allFields: readonly TField[],
  optionId: string,
): { parentField: TField; option: FieldEnumOption } | undefined => {
  for (const field of allFields) {
    const match = parseFieldOptions(field.fieldEnum).find(option => option.id === optionId);
    if (match) return { parentField: field, option: match };
  }
  return undefined;
};

export const isFieldActive = <TField extends { id: string; fieldEnum?: unknown }>(
  field: { parentOptionId?: string | null },
  allFields: readonly TField[],
  getFieldEffectiveValue: (fieldId: string) => string | null | undefined,
): boolean => {
  if (!field.parentOptionId) return true;
  const resolved = resolveParentOption(allFields, field.parentOptionId);
  if (!resolved) return false;
  return resolved.option.value === getFieldEffectiveValue(resolved.parentField.id);
};

export const orderFieldsWithBranchChildrenAfterParent = <
  TField extends { id: string; parentOptionId?: string | null; fieldEnum?: unknown },
>(
  fields: readonly TField[],
): TField[] => {
  const parentIdByFieldId = new Map<string, string>();
  fields.forEach(field => {
    if (!field.parentOptionId) return;
    const resolved = resolveParentOption(fields, field.parentOptionId);
    if (resolved) parentIdByFieldId.set(field.id, resolved.parentField.id);
  });

  const childrenByParentId = new Map<string, TField[]>();
  fields.forEach(field => {
    const parentId = parentIdByFieldId.get(field.id);
    if (!parentId) return;
    const siblings = childrenByParentId.get(parentId);
    if (siblings) {
      siblings.push(field);
    } else {
      childrenByParentId.set(parentId, [field]);
    }
  });

  const result: TField[] = [];
  const appendWithChildren = (field: TField): void => {
    result.push(field);
    (childrenByParentId.get(field.id) ?? []).forEach(appendWithChildren);
  };

  fields.forEach(field => {
    if (parentIdByFieldId.has(field.id)) return;
    appendWithChildren(field);
  });

  return result;
};
