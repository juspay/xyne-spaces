/**
 * Hook for persisting workflow form values in localStorage
 * Saves the last used values per workflow type and restores them on subsequent opens
 */

import { useCallback, useEffect, useState } from 'react';
import type { TriggerWorkflowFormData } from '../components/Workflow/utils';

const STORAGE_PREFIX = 'workflow_form_';

export interface SavedWorkflowFormValues {
  workflowType: string;
  customFields: Record<string, unknown>;
  context?: string;
  timestamp: number;
}

/**
 * Get the localStorage key for a specific workflow type
 */
function getStorageKey(workflowType: string): string {
  return `${STORAGE_PREFIX}${workflowType}`;
}

/**
 * Save workflow form values to localStorage
 */
export function saveWorkflowFormValues(
  workflowType: string,
  formData: Pick<TriggerWorkflowFormData, 'customFields' | 'context'>,
): void {
  if (!workflowType || typeof window === 'undefined') return;

  const data: SavedWorkflowFormValues = {
    workflowType,
    customFields: formData.customFields,
    context: formData.context,
    timestamp: Date.now(),
  };

  try {
    localStorage.setItem(getStorageKey(workflowType), JSON.stringify(data));
  } catch (error) {
    console.error('[useWorkflowFormPersistence] Failed to save form values:', error);
  }
}

/**
 * Load workflow form values from localStorage
 */
export function loadWorkflowFormValues(workflowType: string): SavedWorkflowFormValues | null {
  if (!workflowType || typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(getStorageKey(workflowType));
    if (!stored) return null;

    const data = JSON.parse(stored) as SavedWorkflowFormValues;
    return data;
  } catch (error) {
    console.error('[useWorkflowFormPersistence] Failed to load form values:', error);
    return null;
  }
}

/**
 * Clear saved workflow form values from localStorage
 */
export function clearWorkflowFormValues(workflowType: string): void {
  if (!workflowType || typeof window === 'undefined') return;

  try {
    localStorage.removeItem(getStorageKey(workflowType));
  } catch (error) {
    console.error('[useWorkflowFormPersistence] Failed to clear form values:', error);
  }
}

/**
 * Hook for managing workflow form persistence
 * Provides methods to save, load, and clear form values for a specific workflow type
 */
export function useWorkflowFormPersistence(workflowType: string | undefined) {
  const [savedValues, setSavedValues] = useState<SavedWorkflowFormValues | null>(null);

  // Load saved values when workflow type changes
  useEffect(() => {
    if (workflowType) {
      const loaded = loadWorkflowFormValues(workflowType);
      setSavedValues(loaded);
    } else {
      setSavedValues(null);
    }
  }, [workflowType]);

  const save = useCallback(
    (formData: Pick<TriggerWorkflowFormData, 'customFields' | 'context'>) => {
      if (workflowType) {
        saveWorkflowFormValues(workflowType, formData);
      }
    },
    [workflowType],
  );

  const clear = useCallback(() => {
    if (workflowType) {
      clearWorkflowFormValues(workflowType);
      setSavedValues(null);
    }
  }, [workflowType]);

  return {
    savedValues,
    hasSavedValues: savedValues !== null,
    save,
    clear,
  };
}
