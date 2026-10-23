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

/** One file with its body. A binary file's `content` is base64, with contentType application/octet-stream. */
export interface SkillFileContent extends SkillFileMeta {
  readonly content: string;
}

/** One sibling file of a skill, with its content (`GET /skills/{slug}/files/{fileId}`). */
export function getSkillFile(slug: string, fileId: string): Promise<SkillFileContent> {
  return clawApiRequest<SkillFileContent>(
    `/skills/${encodeURIComponent(slug)}/files/${encodeURIComponent(fileId)}`,
  );
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

export interface SkillSearchResult {
  source: string;
  skillId: string;
  name: string;
  installs: number;
}

export interface ImportPreviewSkill {
  path: string;
  name: string;
  description: string;
  fileCount: number;
  sizeBytes: number;
  error?: string;
  slugTaken: boolean;
  slugValid: boolean;
  alreadyImported: boolean;
}

export interface ImportPreview {
  owner: string;
  repo: string;
  sha: string;
  skills: ImportPreviewSkill[];
  /** The skill a skills.sh link pointed at. */
  skill?: string;
}

/** skills.sh search via claw-auth. Empty on any failure. */
export function searchSkillSources(q: string, userId: string): Promise<SkillSearchResult[]> {
  return clawApiRequest<SkillSearchResult[]>(`/skills/import/search?q=${encodeURIComponent(q)}`, {
    userId,
  });
}

/** The top skills on skills.sh, via claw-auth (read off its homepage, cached an hour). Empty on any failure. */
export function topSkillSources(userId: string): Promise<SkillSearchResult[]> {
  return clawApiRequest<SkillSearchResult[]>('/skills/import/top', { userId });
}

/** Skills found in a public GitHub repo link, checked against the import limits. */
export function previewSkillImport(url: string, userId: string): Promise<ImportPreview> {
  return clawApiRequest<ImportPreview>('/skills/import/preview', {
    method: 'POST',
    userId,
    body: JSON.stringify({ url }),
  });
}

/** Imports the picked skills at the previewed commit as personal skills. */
export function importSkills(
  payload: { url: string; sha: string; skills: Array<{ path: string; slug: string }> },
  userId: string,
): Promise<{ imported: Skill[]; failed: Array<{ path: string; error: string }> }> {
  return clawApiRequest('/skills/import', {
    method: 'POST',
    userId,
    body: JSON.stringify(payload),
  });
}
