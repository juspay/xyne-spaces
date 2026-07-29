/**
 * Format custom fields with truncation
 */
export const formatCustomFields = (fields?: string[]): string => {
  if (!fields || fields.length === 0) return '-';
  const maxDisplay = 3;
  if (fields.length <= maxDisplay) {
    return fields.join(', ');
  }
  return `${fields.slice(0, maxDisplay).join(', ')} +${fields.length - maxDisplay}`;
};
