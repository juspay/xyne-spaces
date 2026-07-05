/**
 * Shared helpers for materializing skills to the on-disk layout that
 * pi-coding-agent's `DefaultResourceLoader` expects.
 *
 * Layout written: `<dataDir>/session-skills/<sessionId>/<slug>/SKILL.md`.
 * One directory per skill, filename always uppercase `SKILL.md` — pi's loader
 * keys off that exact name (skills.js:116) and skips lowercase variants.
 *
 * Used by both the top-level agent session (`agent.ts`) and subagent child
 * sessions (`subagent-tools.ts`) so file-based skills behave identically in
 * both — same frontmatter normalization, same resourceLoader plumbing,
 * same skill-trigger / resource-API availability inside the model loop.
 */

import { join, resolve } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { PATHS } from "./config.js";

import { createLogger } from "./logger.js";
const log = createLogger("session-skills");

/**
 * Delete a session-skills scope dir. Skills are materialized per run and per
 * subagent invocation under `session-skills/<scope>/` and are only needed while
 * that run executes — without this they accumulate forever and fill the disk.
 * Best-effort; never throws.
 */
export async function deleteSessionSkills(sessionScope: string): Promise<void> {
  if (!sessionScope) return;
  const skillsDir = resolve(join(PATHS.dataDir, "session-skills", sessionScope));
  await rm(skillsDir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Decide whether `f.content` should be base64-decoded before writeFile.
 *
 * SkillFile rows carry binary blobs (PDFs, images, fonts) as base64-encoded
 * strings in `content`. Until this guard existed, every file was written as
 * UTF-8, so a `template.pdf` skill-file landed on disk as literal base64
 * text — pdf-lib then rejected it as malformed and the agent had no
 * workable template. This silently broke admin-uploaded AcroForm templates
 * for the credit-appraisal-agent (and any future binary skill asset).
 *
 * Decision order:
 *   1. Explicit contentType: anything starting with `text/`, or
 *      `application/json | yaml | xml`, is treated as text. Everything else
 *      (image/*, application/pdf, application/octet-stream, …) is binary.
 *   2. No contentType set: fall back to extension sniffing.
 */
function isBinaryContentType(contentType: string | undefined | null, relativePath: string): boolean {
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.startsWith("text/")) return false;
    if (ct === "application/json" || ct === "application/yaml" || ct === "application/xml") return false;
    return true;
  }
  const dot = relativePath.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = relativePath.slice(dot).toLowerCase();
  const BINARY_EXTS = new Set([
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff",
    ".docx", ".pptx", ".xlsx", ".xlsm",
    ".zip", ".gz", ".tar",
    ".ttf", ".otf", ".woff", ".woff2",
    ".mp3", ".mp4", ".wav", ".webm", ".mov",
    ".bin", ".dat",
  ]);
  return BINARY_EXTS.has(ext);
}

interface SplitContent {
  frontmatterLines: string[];
  body: string;
  hadFrontmatter: boolean;
}

function splitFrontmatter(content: string): SplitContent {
  if (!content.startsWith("---")) {
    return { frontmatterLines: [], body: content, hadFrontmatter: false };
  }
  const closeIdx = content.indexOf("\n---", 3);
  if (closeIdx === -1) {
    return { frontmatterLines: [], body: content, hadFrontmatter: false };
  }
  const inner = content.slice(4, closeIdx);
  const body = content.slice(closeIdx + 4).replace(/^\r?\n/, "");
  return { frontmatterLines: inner.split("\n"), body, hadFrontmatter: true };
}

function findKey(lines: string[], key: string): { idx: number; value: string } | null {
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(re);
    if (m) return { idx: i, value: (m[1] ?? "").trim() };
  }
  return null;
}

/**
 * Build a pi-compatible skill markdown file. Preserves inline frontmatter
 * when the skill body already has one; otherwise injects `name:` (slug) and
 * `description:` (DB column fallback) and YAML-escapes the description.
 *
 * Pi requires:
 *   - `description` (non-empty, ≤1024 chars)
 *   - `name` matching `^[a-z0-9-]+$` (else falls back to parent dir name,
 *     which causes collisions for session-scoped skills sharing one dir)
 */
export function buildSkillFile(slug: string, name: string, description: string, rawContent: string): string {
  const split = splitFrontmatter(rawContent);
  const lines = [...split.frontmatterLines];

  if (!findKey(lines, "name")) {
    lines.unshift(`name: ${slug}`);
  }

  const desc = findKey(lines, "description");
  const fallbackDesc = description?.trim() || name || slug;
  const escapeYaml = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (!desc) {
    lines.push(`description: "${escapeYaml(fallbackDesc)}"`);
  } else if (!/^["'].*["']$/.test(desc.value) && /:\s/.test(desc.value)) {
    lines[desc.idx] = `description: "${escapeYaml(desc.value)}"`;
  }

  const frontmatter = `---\n${lines.join("\n")}\n---`;
  return `${frontmatter}\n\n${split.body}`;
}

/**
 * Defensive normalization for skill-file relative paths. Returns the
 * normalized POSIX path or null if the input is unsafe (absolute, contains
 * '..', empty). claw-auth normalizes this at upload time; this is just a
 * belt-and-suspenders check for any /run caller that bypasses claw-auth.
 */
function normalizeRelativePath(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^([a-zA-Z]:[\\/])|^[\\/]/.test(trimmed)) return null;
  const segs = trimmed.replace(/\\/g, "/").split("/").filter((s) => s.length > 0 && s !== ".");
  if (segs.length === 0) return null;
  if (segs.some((s) => s === "..")) return null;
  return segs.join("/");
}

/** Normalize a skill name/slug to pi's required `^[a-z0-9-]+$` shape. */
function toPiSlug(rawSlug: string): string {
  return rawSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface SkillFileInput {
  /** POSIX path relative to the skill directory (e.g. "scripts/run.sh"). */
  relativePath: string;
  /** UTF-8 (or base64-encoded for binaries) text content. */
  content: string;
  /** Optional MIME hint — currently unused at the runtime layer. */
  contentType?: string | undefined;
}

export interface SkillInput {
  slug?: string | undefined;
  name: string;
  description?: string | undefined;
  content: string;
  /** Extra files that ship inside the skill directory alongside SKILL.md. */
  files?: SkillFileInput[] | undefined;
}

/**
 * Materialize a set of skills onto disk at the session-scoped path.
 * Returns the absolute skills directory (suitable for
 * `additionalSkillPaths`) or `null` when nothing was written.
 *
 * `sessionScope` is a free-form string used as the sub-directory. Pass the
 * parent's sessionId for the top-level agent; pass a child-unique scope
 * (e.g. `${parentSessionId}-${childToolCallId}`) for subagent invocations
 * so concurrent subagent calls under the same parent don't stomp on each
 * other's skill files.
 */
export async function writeSessionSkills(
  sessionScope: string,
  skills: ReadonlyArray<SkillInput>,
): Promise<string | null> {
  if (!sessionScope || !skills?.length) return null;

  // PATHS.dataDir can be relative — pi resolves `additionalSkillPaths`
  // against the session cwd, not process.cwd(), so absolute is mandatory.
  const skillsDir = resolve(join(PATHS.dataDir, "session-skills", sessionScope));
  await mkdir(skillsDir, { recursive: true });

  for (const skill of skills) {
    const rawSlug = skill.slug || skill.name.replace(/\.md$/i, "");
    const slug = toPiSlug(rawSlug);
    const skillSubdir = join(skillsDir, slug);
    await mkdir(skillSubdir, { recursive: true });
    const fullPath = join(skillSubdir, "SKILL.md");
    const fileContent = buildSkillFile(slug, skill.name, skill.description ?? "", skill.content);
    await writeFile(fullPath, fileContent, "utf8");

    // Materialize sibling files. relativePath is already normalized at
    // upload time on the claw-auth side (see SkillFile.normalizeSkillRelativePath),
    // but re-check defensively here so a hand-rolled /run caller can't
    // smuggle in absolute paths or '..' traversal.
    if (skill.files && skill.files.length > 0) {
      for (const f of skill.files) {
        const safePath = normalizeRelativePath(f.relativePath);
        if (!safePath) {
          log.warn(`[skill] Skipping skill file with unsafe relativePath: ${f.relativePath}`);
          continue;
        }
        const filePath = join(skillSubdir, safePath);
        await mkdir(join(filePath, ".."), { recursive: true });
        if (isBinaryContentType(f.contentType, safePath)) {
          const buf = Buffer.from(f.content, "base64");
          await writeFile(filePath, buf);
        } else {
          await writeFile(filePath, f.content, "utf8");
        }
      }
    }
  }

  return skillsDir;
}
