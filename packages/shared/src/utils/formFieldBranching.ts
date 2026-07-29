import { resolveParentOption } from './formFieldOptions';

// Whether a field currently applies: always true with no parent; otherwise only when the
// parent field (derived from parentOptionId via resolveParentOption) holds that option's value.
export const isFieldActive = <TField extends { id: string; fieldEnum?: unknown }>(
  field: { parentOptionId?: string | null },
  allFields: readonly TField[],
  getFieldEffectiveValue: (fieldId: string) => string | null | undefined,
): boolean => {
  if (!field.parentOptionId) return true;
  const resolved = resolveParentOption(allFields, field.parentOptionId);
  if (!resolved) return false; // option/field removed — branch is orphaned
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
    if (parentIdByFieldId.has(field.id)) return; // placed alongside its parent instead
    appendWithChildren(field);
  });

  return result;
};
