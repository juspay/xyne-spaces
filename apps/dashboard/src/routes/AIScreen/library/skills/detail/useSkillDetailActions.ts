import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useIsClawAdmin } from '@/hooks/useIsClawAdmin';
import { deleteSkill, replaceSkillFiles, updateSkill } from '@/services/claw/clawSkillsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Skill } from '@/services/claw/clawSkillsTypes';

export interface SkillDetailActions {
  /** Owner, or an admin on a global skill — matches the backend's guard. */
  canEdit: boolean;
  isAdmin: boolean;
  busy: { toggling: boolean; deleting: boolean; uploading: boolean };
  libraryPath: string;
  toggleEnabled: (next: boolean) => Promise<void>;
  saveContent: (content: string) => Promise<void>;
  uploadFiles: (
    files: Array<{ relativePath: string; content: string; contentType?: string }>,
  ) => Promise<void>;
  remove: () => Promise<void>;
}

export function useSkillDetailActions(skill: Skill | undefined): SkillDetailActions {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { data: isAdmin = false } = useIsClawAdmin();

  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const userId = user?.id;
  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
  const canEdit = Boolean(
    skill && userId && (skill.ownerUserId === userId || (isAdmin && skill.scope === 'global')),
  );

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['claw-skills'] });
    if (skill) void queryClient.invalidateQueries({ queryKey: ['claw-skill-files', skill.slug] });
  };

  const toggleEnabled = async (next: boolean): Promise<void> => {
    if (!skill || !userId || toggling) return;
    setToggling(true);
    try {
      await updateSkill(skill.slug, { enabled: next }, userId);
      refresh();
      toast.success(
        next ? `${skill.label || skill.name} enabled` : `${skill.label || skill.name} disabled`,
      );
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not update this skill'));
    } finally {
      setToggling(false);
    }
  };

  const saveContent = async (content: string): Promise<void> => {
    if (!skill || !userId || uploading) return;
    setUploading(true);
    try {
      await updateSkill(skill.slug, { content }, userId);
      refresh();
      toast.success('Instructions updated');
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not update the instructions'));
    } finally {
      setUploading(false);
    }
  };

  const uploadFiles = async (
    files: Array<{ relativePath: string; content: string; contentType?: string }>,
  ): Promise<void> => {
    if (!skill || !userId || uploading) return;
    setUploading(true);
    try {
      await replaceSkillFiles(skill.slug, files, userId);
      refresh();
      toast.success(files.length === 1 ? '1 file uploaded' : `${files.length} files uploaded`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not upload those files'));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!skill || !userId || deleting) return;
    setDeleting(true);
    try {
      await deleteSkill(skill.slug, userId);
      refresh();
      toast.success(`${skill.label || skill.name} deleted`);
      void navigate(`${libraryPath}?tab=skills`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not delete this skill'));
      setDeleting(false);
    }
  };

  return {
    canEdit,
    isAdmin,
    busy: { toggling, deleting, uploading },
    libraryPath,
    toggleEnabled,
    saveContent,
    uploadFiles,
    remove,
  };
}
