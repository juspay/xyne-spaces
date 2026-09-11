import { useQuery } from '@tanstack/react-query';
import { getSkillFile } from './skillFileService';

export interface SkillFileContentState {
  content: string;
  loading: boolean;
  isError: boolean;
}

export function useSkillFileContent(slug: string, fileId: string | null): SkillFileContentState {
  const query = useQuery({
    queryKey: ['claw-skill-file', slug, fileId],
    queryFn: () => getSkillFile(slug, fileId as string),
    enabled: Boolean(slug && fileId),
    staleTime: 5 * 60 * 1000,
  });

  return {
    content: query.data?.content ?? '',
    loading: query.isLoading,
    isError: query.isError,
  };
}
