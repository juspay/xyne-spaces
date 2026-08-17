import { logger, Event as LogEvent } from '../utils/logger';
import { useState, useCallback, useEffect } from 'react';
import { apiInstance } from '../services/clients/apiClient';
import type {
  ActivityAlias,
  ActivityAliasesResponse,
  CreateActivityAliasInput,
  UpdateActivityAliasInput,
} from '@xyne/shared';

export type { ActivityAlias };

interface UseActivityAliasesReturn {
  aliases: ActivityAlias[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createAlias: (input: CreateActivityAliasInput) => Promise<ActivityAlias>;
  updateAlias: (id: string, input: UpdateActivityAliasInput) => Promise<ActivityAlias>;
  deleteAlias: (id: string) => Promise<void>;
  resolveKeyFromCurrentName: (
    currentName: string,
    currentCategory: string,
  ) => { keyName: string; keyCategory: string; existingId?: string };
}

export const useActivityAliases = (): UseActivityAliasesReturn => {
  const [aliases, setAliases] = useState<ActivityAlias[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAliases = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiInstance.get<ActivityAliasesResponse>('/activity-aliases');
      setAliases(response.data.aliases);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch aliases';
      setError(message);
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Error fetching activity aliases:'),
        error: err,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void fetchAliases();
  }, [fetchAliases]);

  const refresh = useCallback(async () => {
    await fetchAliases();
  }, [fetchAliases]);

  const createAlias = useCallback(
    async (input: CreateActivityAliasInput): Promise<ActivityAlias> => {
      try {
        const response = await apiInstance.post<{ alias: ActivityAlias }>(
          '/activity-aliases',
          input,
        );
        const newAlias = response.data.alias;
        setAliases(prev => [newAlias, ...prev]);
        return newAlias;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create alias';
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Error creating activity alias:'),
          error: err,
        });
        throw new Error(message);
      }
    },
    [],
  );

  const updateAlias = useCallback(
    async (id: string, input: UpdateActivityAliasInput): Promise<ActivityAlias> => {
      try {
        const response = await apiInstance.put<{ alias: ActivityAlias }>(
          `/activity-aliases/${id}`,
          input,
        );
        const updatedAlias = response.data.alias;
        setAliases(prev => prev.map(a => (a.id === id ? updatedAlias : a)));
        return updatedAlias;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update alias';
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Error updating activity alias:'),
          error: err,
        });
        throw new Error(message);
      }
    },
    [],
  );

  const deleteAlias = useCallback(async (id: string): Promise<void> => {
    try {
      await apiInstance.delete(`/activity-aliases/${id}`);
      setAliases(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete alias';
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Error deleting activity alias:'),
        error: err,
      });
      throw new Error(message);
    }
  }, []);

  const resolveKeyFromCurrentName = useCallback(
    (
      currentName: string,
      currentCategory: string,
    ): { keyName: string; keyCategory: string; existingId?: string } => {
      const existingAlias = aliases.find(
        a => a.aliasEventName === currentName && a.aliasEventCategory === currentCategory,
      );

      if (existingAlias) {
        return {
          keyName: existingAlias.eventName,
          keyCategory: existingAlias.eventCategory,
          existingId: existingAlias.id,
        };
      }

      const keyAlias = aliases.find(
        a => a.eventName === currentName && a.eventCategory === currentCategory,
      );

      if (keyAlias) {
        return {
          keyName: currentName,
          keyCategory: currentCategory,
          existingId: keyAlias.id,
        };
      }

      // This is a new, original event name
      return {
        keyName: currentName,
        keyCategory: currentCategory,
      };
    },
    [aliases],
  );

  return {
    aliases,
    isLoading,
    error,
    refresh,
    createAlias,
    updateAlias,
    deleteAlias,
    resolveKeyFromCurrentName,
  };
};
