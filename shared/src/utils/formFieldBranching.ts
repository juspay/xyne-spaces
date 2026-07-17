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
