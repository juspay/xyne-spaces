import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
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
export const useCreateClawSkill = (
  /** Set when the form is shown inside a hub: link the skill there and stay on the page. */
  hub?: { channelId: string; onCreated: () => void },
): UseMutationResult<Skill, Error, SkillCreateSubmission> => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';

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

      if (hub) {
        try {
          await apiInstance.post(
            `/sdlc/channels/${encodeURIComponent(hub.channelId)}/knowledge/skills`,
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
      if (hub) hub.onCreated();
      else void navigate(`${libraryPath}/skill/${skill.slug}`);
    },
  });
};
