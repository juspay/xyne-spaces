import { SavedConfigEntityName } from '@xyne/shared';
import type { StoredFilters } from '../hooks/usePersistedDeskMetricsFilters';

export interface DeskMetricsValueRow {
  entityName: SavedConfigEntityName.DESK_METRICS;
  fieldName: string;
  fieldValue: string;
}

export function deskMetricsFiltersToValues(filters: StoredFilters): DeskMetricsValueRow[] {
  const rows: DeskMetricsValueRow[] = [];

  const add = (fieldName: string, fieldValue: string): void => {
    rows.push({ entityName: SavedConfigEntityName.DESK_METRICS, fieldName, fieldValue });
  };

  add('rangeLabel', filters.rangeLabel);
  add('startTime', filters.startTime);
  add('endTime', filters.endTime);
  add('chartView', filters.chartView);
  add('activeTab', filters.activeTab);

  if (filters.customStart) add('customStart', filters.customStart);
  if (filters.customEnd) add('customEnd', filters.customEnd);
  if (filters.selectedTagCategory) add('selectedTagCategory', filters.selectedTagCategory);

  for (const id of filters.selectedAssigneeIds) add('selectedAssigneeIds', id);
  for (const name of filters.selectedStageNames) add('selectedStageNames', name);
  for (const p of filters.selectedPriorities) add('selectedPriorities', p);
  for (const id of filters.selectedUserGroupIds) add('selectedUserGroupIds', id);
  for (const v of filters.selectedTagValues) add('selectedTagValues', v);
  for (const cat of filters.selectedAiCategories) add('selectedAiCategories', cat);
  for (const id of filters.comparedChannelIds) add('comparedChannelIds', id);

  for (const [key, vals] of Object.entries(filters.selectedCustomFieldValues)) {
    add(`selectedCustomFieldValues.${key}`, JSON.stringify(vals));
  }

  return rows;
}

export function valuesToDeskMetricsFilters(
  rows: readonly { fieldName: string; fieldValue: string }[],
): Partial<StoredFilters> {
  const result: Partial<StoredFilters> = {
    selectedAssigneeIds: [],
    selectedStageNames: [],
    selectedPriorities: [],
    selectedUserGroupIds: [],
    selectedTagValues: [],
    selectedAiCategories: [],
    comparedChannelIds: [],
    selectedCustomFieldValues: {},
  };

  for (const { fieldName, fieldValue } of rows) {
    if (fieldName.startsWith('selectedCustomFieldValues.')) {
      const key = fieldName.slice('selectedCustomFieldValues.'.length);
      try {
        (result.selectedCustomFieldValues as Record<string, string[]>)[key] = JSON.parse(
          fieldValue,
        ) as string[];
      } catch {
        // skip malformed
      }
      continue;
    }

    switch (fieldName) {
      case 'rangeLabel':
        (result as Record<string, unknown>)['rangeLabel'] = fieldValue;
        break;
      case 'customStart':
        result.customStart = fieldValue;
        break;
      case 'customEnd':
        result.customEnd = fieldValue;
        break;
      case 'startTime':
        result.startTime = fieldValue;
        break;
      case 'endTime':
        result.endTime = fieldValue;
        break;
      case 'chartView':
        (result as Record<string, unknown>)['chartView'] = fieldValue;
        break;
      case 'activeTab':
        (result as Record<string, unknown>)['activeTab'] = fieldValue;
        break;
      case 'selectedTagCategory':
        result.selectedTagCategory = fieldValue;
        break;
      case 'selectedAssigneeIds':
        result.selectedAssigneeIds!.push(fieldValue);
        break;
      case 'selectedStageNames':
        result.selectedStageNames!.push(fieldValue);
        break;
      case 'selectedPriorities':
        (result.selectedPriorities as string[]).push(fieldValue);
        break;
      case 'selectedUserGroupIds':
        result.selectedUserGroupIds!.push(fieldValue);
        break;
      case 'selectedTagValues':
        result.selectedTagValues!.push(fieldValue);
        break;
      case 'selectedAiCategories':
        result.selectedAiCategories!.push(fieldValue);
        break;
      case 'comparedChannelIds':
        result.comparedChannelIds!.push(fieldValue);
        break;
    }
  }

  return result;
}
