import { clawApiRequest } from './clawRequest';
import type { Skill, SkillFileMeta } from './clawSkillsTypes';

/**
 * All skills the given user can see (their own + global). `userId` is the
 * internal Spaces user id (useAuth().user.id), which the backend uses to scope
 * personal skills. Mirrors claw-auth's listSkills.
 */
export function listSkills(userId: string): Promise<Skill[]> {
  return clawApiRequest<Skill[]>(`/skills?userId=${encodeURIComponent(userId)}`);
}

export interface CreateSkillPayload {
  slug: string;
  name?: string;
  description?: string;
  content: string;
  source?: string;
}

/** Creates a personal skill (`POST /skills`). Mirrors claw-auth's createSkill. */
export function createSkill(payload: CreateSkillPayload, userId: string): Promise<Skill> {
  return clawApiRequest<Skill>('/skills', {
    method: 'POST',
    userId,
    body: JSON.stringify(payload),
  });
}

/**
 * The file bundle for a directory-style skill (metadata only — file contents are
 * not fetched here). Mirrors claw-auth's listSkillFiles.
 */
export function listSkillFiles(slug: string): Promise<SkillFileMeta[]> {
  return clawApiRequest<SkillFileMeta[]>(`/skills/${encodeURIComponent(slug)}/files`);
}

/**
 * Patches a skill (`PUT /skills/{slug}`). Send only changed fields. Requires
 * edit permission server-side (throws {@link ClawApiError} 403 otherwise).
 */
export function updateSkill(
  slug: string,
  payload: { name?: string; description?: string; content?: string; enabled?: boolean },
  userId: string,
): Promise<Skill> {
  return clawApiRequest<Skill>(`/skills/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    userId,
    body: JSON.stringify(payload),
  });
}

/** Deletes a skill (owner / admin-on-global only). */
export function deleteSkill(slug: string, userId: string): Promise<void> {
  return clawApiRequest<void>(`/skills/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    userId,
  });
}

/**
 * Replaces the entire file bundle for a skill (`PUT /skills/{slug}/files`). All
 * existing files are replaced. `SKILL.md` is not sent here — it lives on the
 * skill's `content`.
 */
export function replaceSkillFiles(
  slug: string,
  files: Array<{ relativePath: string; content: string; contentType?: string }>,
  userId: string,
): Promise<void> {
  return clawApiRequest<void>(`/skills/${encodeURIComponent(slug)}/files`, {
    method: 'PUT',
    userId,
    body: JSON.stringify({ files }),
  });
}

/** Requests that a personal skill be promoted to global (routed to an admin). */
export function submitSkillRequest(slug: string, userId: string): Promise<void> {
  return clawApiRequest<void>(`/skills/${encodeURIComponent(slug)}/request`, {
    method: 'POST',
    userId,
  });
}

/**
 * Whether the given user is a claw admin. Resolves to `false` on any error so a
 * failed check degrades to the least-privileged state.
 */
export async function checkIsClawAdmin(userId: string): Promise<boolean> {
  try {
    const data = await clawApiRequest<{ isAdmin: boolean }>(
      `/admin/roles/check/${encodeURIComponent(userId)}`,
      { userId },
    );
    return data.isAdmin;
  } catch {
    return false;
  }
}
