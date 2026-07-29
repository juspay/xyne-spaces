import { useMemo } from 'react';
import { useUsers } from './useUsers';
import { getUserDisplayName } from '../utils/userDisplayName';
import { detectFieldType } from '../utils/queryBuilderFieldMappings';
import { collectReferenceIdsFromRows, type ReferenceLabels } from '../utils/referenceLabelUtils';

function extractFieldNames(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      keys.add(key);
    }
  }
  return Array.from(keys);
}

/**
 * Resolves user ID fields in analytics results using the globally loaded users cache.
 */
export function useReferenceLabels(
  rows: Record<string, unknown>[] | null | undefined,
): ReferenceLabels {
  const users = useUsers();

  return useMemo(() => {
    if (!rows || rows.length === 0) {
      return {};
    }

    const fieldNames = extractFieldNames(rows);
    const userMap = new Map(users.map(user => [user.id, user]));
    const explicitUserFields = fieldNames.filter(name => detectFieldType(name) === 'user');

    // Custom USER form fields use display names — resolve when all values match known user IDs
    const heuristicUserFields = fieldNames.filter(fieldName => {
      if (explicitUserFields.includes(fieldName) || detectFieldType(fieldName) !== null) {
        return false;
      }
      const values = rows
        .map(row => row[fieldName])
        .filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (values.length === 0) return false;
      return values.every(id => userMap.has(id));
    });

    const userFields = Array.from(new Set([...explicitUserFields, ...heuristicUserFields]));
    if (userFields.length === 0) {
      return {};
    }

    const idsByField = collectReferenceIdsFromRows(rows, userFields);
    const labels: ReferenceLabels = {};

    for (const fieldName of userFields) {
      const fieldLabels: Record<string, string> = {};
      for (const userId of idsByField[fieldName] ?? []) {
        const user = userMap.get(userId);
        if (user) {
          fieldLabels[userId] = getUserDisplayName(user);
        }
      }
      if (Object.keys(fieldLabels).length > 0) {
        labels[fieldName] = fieldLabels;
      }
    }

    return labels;
  }, [rows, users]);
}
