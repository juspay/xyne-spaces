import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { listSkills, listSkillFiles } from '../services/claw/clawSkillsService';
import type { Skill, SkillFileMeta } from '../services/claw/clawSkillsTypes';
import { useIsClawAdmin } from './useIsClawAdmin';

/**
 * Fetches the skill catalog (the user's own + global skills) from the claw-auth
 * backend, mirroring what the claw-auth frontend's Skills page shows. Gated on
 * the user id the same way as useClawAuthAgents / useClawMcp.
 */
export const useClawSkills = (
  options: {
    /** Poll while the page expects skills to appear, e.g. while an agent is writing one. */
    refetchInterval?: number | false;
    /** `always` refetches on tab focus even while the cached list is fresh. */
    refetchOnWindowFocus?: boolean | 'always';
  } = {},
): UseQueryResult<Skill[], Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['claw-skills', user?.id],
    queryFn: () => listSkills(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

/**
 * Fetches the file bundle for a single directory-style skill, gated on the skill
 * slug. Used by the skill detail screen's Files section.
 */
export const useClawSkillFiles = (
  slug: string | undefined,
): UseQueryResult<SkillFileMeta[], Error> =>
  useQuery({
    queryKey: ['claw-skill-files', slug],
    queryFn: () => listSkillFiles(slug!),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });

/**
 * Whether the current user is a claw admin — gates editing of global skills they
 * don't own (see the skill detail screen's `canEdit`). Gated on the user id like
 * the other claw hooks; defaults to `false` while loading / on error.
 */
export const useClawAdminStatus = useIsClawAdmin;
