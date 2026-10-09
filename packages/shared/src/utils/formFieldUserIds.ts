export const extractFormFieldUserIds = (
  actualFieldValue: unknown,
  fieldValue: string | null | undefined,
): string[] => {
  if (actualFieldValue) {
    if (Array.isArray(actualFieldValue)) {
      return actualFieldValue.filter((id): id is string => typeof id === 'string');
    }
    return typeof actualFieldValue === 'string' ? [actualFieldValue] : [];
  }
  if (fieldValue) {
    return fieldValue.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
};
