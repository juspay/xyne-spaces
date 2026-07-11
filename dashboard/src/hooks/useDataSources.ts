import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  refreshDataSource,
  deleteDataSource,
} from '../services/DynamicDashboard/dataSourcesAdminService';

export const dataSourceKeys = {
  list: ['dataSources', 'list'] as const,
};

export function useDataSourceMutations() {
  const queryClient = useQueryClient();
  const invalidateList = (): void => {
    void queryClient.invalidateQueries({ queryKey: dataSourceKeys.list });
  };

  const refresh = useMutation({
    mutationFn: (id: string) => refreshDataSource(id),
    onSuccess: invalidateList,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteDataSource(id),
    onSuccess: invalidateList,
  });

  return { refresh, remove };
}
