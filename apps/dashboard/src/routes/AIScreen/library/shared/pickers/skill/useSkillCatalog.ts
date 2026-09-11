import { useMemo } from 'react';
import { useClawSkills } from '@/hooks/useClawSkills';
import { buildSkillCatalog, type SkillCatalogEntry } from './skillCatalog';

export interface SkillCatalog {
  entries: SkillCatalogEntry[];
  loading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useSkillCatalog(): SkillCatalog {
  const skills = useClawSkills();

  const entries = useMemo(() => buildSkillCatalog(skills.data ?? []), [skills.data]);

  return {
    entries,
    loading: skills.isLoading,
    isError: skills.isError,
    refetch: () => void skills.refetch(),
  };
}
