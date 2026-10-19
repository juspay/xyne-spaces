/**
 * Projects Hook - Fetches all projects using Zero query
 *
 * Used for project selection in channel creation and other features.
 * Similar to dashboard's useCachedQuery(queries.getAllProjects()).
 */

import { useMemo } from 'react';
import { useQuery } from './useQuery';
import { queries } from '@/src/zero/queries';

/**
 * Hook to get all projects from Zero
 * @returns Array of all projects
 */
export const useProjects = () => {
  const [projects, details] = useQuery(queries.getAllProjects());

  return useMemo(() => {
    // Only return complete data, otherwise empty array
    if (details.type === 'complete') {
      return projects;
    }
    return [];
  }, [projects, details.type]);
};
