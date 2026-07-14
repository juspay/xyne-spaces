// Skill types mirrored from xyne-claw-auth/frontend/src/lib/api.ts so the
// dashboard renders the same data returned by the claw-auth backend's
// GET /api/v1/skills endpoint. Keep field names in sync with that source.

export interface Skill {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly content: string;
  /** Provenance: 'seeded' (built-in), 'user-created', 'uploaded', … */
  readonly source: string;
  /** 'global' (shared workspace-wide) or 'personal'. */
  readonly scope: string;
  readonly ownerUserId: string | null;
  /** Resolved owner identity; null for seeded/system skills. */
  readonly owner?: { readonly id: string; readonly name: string; readonly email: string } | null;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Metadata for one file in a directory-style skill bundle (scripts, examples,
 * data, …). `SKILL.md` lives on `Skill.content`, not as a file record.
 */
export interface SkillFileMeta {
  readonly id: string;
  /** Path relative to the skill root, e.g. "scripts/run.sh". */
  readonly relativePath: string;
  readonly contentType: string | null;
  readonly sizeBytes: number;
  readonly createdAt?: string;
}
