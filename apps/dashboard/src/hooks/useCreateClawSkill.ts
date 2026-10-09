import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { createSkill, replaceSkillFiles } from '../services/claw/clawSkillsService';
import type { PendingSkillFile } from '../services/claw/clawSkillFileUtils';
import type { Skill } from '../services/claw/clawSkillsTypes';
import { apiInstance } from '../services/clients/apiClient';

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
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
  // Set by an SDLC hub's Hub Knowledge page: link the new skill to that hub and return there.
  const [searchParams] = useSearchParams();
  const sdlcChannelId = searchParams.get('sdlcChannelId');
  const returnTo = searchParams.get('returnTo');

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

      if (sdlcChannelId) {
        try {
          await apiInstance.post(
            `/sdlc/channels/${encodeURIComponent(sdlcChannelId)}/knowledge/skills`,
            { skillId: skill.id },
          );
        } catch {
          toast.error('Skill created, but it could not be linked to the hub.');
        }
      }

      return skill;
    },
    onSuccess: skill => {
      void queryClient.invalidateQueries({ queryKey: ['claw-skills'] });
      void queryClient.invalidateQueries({ queryKey: ['sdlc-hub-knowledge'] });
      toast.success('Skill created');
      if (sdlcChannelId && returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
        void navigate(returnTo);
      } else void navigate(`${libraryPath}/skill/${skill.slug}`);
    },
  });
};
