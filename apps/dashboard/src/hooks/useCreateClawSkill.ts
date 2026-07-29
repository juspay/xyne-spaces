import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { createSkill, replaceSkillFiles } from '../services/claw/clawSkillsService';
import type { PendingSkillFile } from '../services/claw/clawSkillFileUtils';
import type { Skill } from '../services/claw/clawSkillsTypes';

export interface SkillCreateSubmission {
  slug: string;
  name: string;
  description: string;
  content: string;
  files: PendingSkillFile[];
}

/**
 * Creates a skill (`POST /skills`), then — only if files were attached during
 * create — replaces its file bundle (`PUT /skills/:slug/files`). On success,
 * invalidate the skill list and route to the new skill's detail screen.
 */
export const useCreateClawSkill = (): UseMutationResult<Skill, Error, SkillCreateSubmission> => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<Skill, Error, SkillCreateSubmission>({
    mutationFn: async s => {
      if (!userId) throw new Error('Not signed in');
      const skill = await createSkill(
        {
          slug: s.slug,
          ...(s.name ? { name: s.name } : {}),
          ...(s.description ? { description: s.description } : {}),
          content: s.content,
          source: 'user-created',
        },
        userId,
      );

      if (s.files.length > 0) {
        await replaceSkillFiles(
          skill.slug,
          s.files.map(({ relativePath, content, contentType }) => ({
            relativePath,
            content,
            ...(contentType ? { contentType } : {}),
          })),
          userId,
        );
      }

      return skill;
    },
    onSuccess: skill => {
      void queryClient.invalidateQueries({ queryKey: ['claw-skills'] });
      toast.success('Skill created');
      void navigate(`/claw-agents/skills/${skill.slug}`);
    },
  });
};
