export interface PendingSkillFile {
  relativePath: string;
  content: string;
  contentType?: string;
  sizeBytes: number;
}

export interface SkillBundle {
  /** Sibling files (everything except SKILL.md). */
  files: PendingSkillFile[];
  /** SKILL.md body, if the picker included one. */
  mainContent: string | null;
  /** Top-level folder name normalised to kebab-case, or null for flat-file picks. */
  folderSlug: string | null;
}

function isBinaryFile(f: File, relativePath: string): boolean {
  const type = (f.type || "").toLowerCase();
  if (type) {
    if (type.startsWith("text/")) return false;
    if (type === "application/json" || type === "application/yaml" || type === "application/xml") return false;
    if (type.startsWith("image/") || type.startsWith("audio/") || type.startsWith("video/")) return true;
    if (
      type === "application/pdf" ||
      type === "application/zip" ||
      type === "application/octet-stream" ||
      type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) return true;
  }
  const dot = relativePath.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = relativePath.slice(dot).toLowerCase();
  return new Set([
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff",
    ".docx", ".pptx", ".xlsx", ".xlsm",
    ".zip", ".gz", ".tar",
    ".ttf", ".otf", ".woff", ".woff2",
    ".mp3", ".mp4", ".wav", ".webm", ".mov",
    ".bin", ".dat",
  ]).has(ext);
}

async function fileToBase64(f: File): Promise<string> {
  const ab = await f.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function readSkillBundleFromFileList(files: FileList): Promise<SkillBundle> {
  const out: PendingSkillFile[] = [];
  let mainContent: string | null = null;
  let folderSlug: string | null = null;

  for (const f of Array.from(files)) {
    const raw = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = raw.split("/").filter(Boolean);
    if (folderSlug === null && parts.length > 1) {
      folderSlug = parts[0]!
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "") || null;
    }
    const relativePath = parts.length > 1 ? parts.slice(1).join("/") : parts.join("/");

    if (isBinaryFile(f, relativePath)) {
      out.push({ relativePath, content: await fileToBase64(f), contentType: f.type || "application/octet-stream", sizeBytes: f.size });
      continue;
    }
    const text = await f.text();
    if (relativePath === "SKILL.md") { mainContent = text; continue; }
    out.push({ relativePath, content: text, ...(f.type ? { contentType: f.type } : {}), sizeBytes: text.length });
  }

  // Flat single-file pick: a user who downloaded a skill as `my-skill.md` and
  // uploads that file directly (no folder, no SKILL.md) should get its body as
  // the skill content — not silently filed as a sibling with empty content.
  // Only when there's exactly ONE markdown file and no SKILL.md/folder, so
  // folder bundles keep the SKILL.md convention and ambiguous multi-md picks
  // are left for the user to resolve.
  if (mainContent === null && folderSlug === null) {
    const mdFiles = out.filter((f) => /\.(md|markdown)$/i.test(f.relativePath));
    if (mdFiles.length === 1) {
      const main = mdFiles[0]!;
      mainContent = main.content;
      out.splice(out.indexOf(main), 1);
      folderSlug = main.relativePath
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "") || null;
    }
  }

  return { files: out, mainContent, folderSlug };
}

export async function readSkillFilesFromFileList(files: FileList): Promise<PendingSkillFile[]> {
  return (await readSkillBundleFromFileList(files)).files;
}

/** One skill detected in a multi-skill pick. */
export interface NamedSkillBundle {
  slug: string;
  name: string;
  /** From the `.md`'s YAML frontmatter `description:`, if present. */
  description: string;
  mainContent: string;
  files: PendingSkillFile[];
}

function kebab(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
}

function titleFromSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Pull `name`/`description` out of a SKILL.md-style YAML frontmatter block so
 * the create form can pre-fill those fields (otherwise the user sees an empty
 * Description even though the file declares one). Only the two keys we surface
 * are read; the content itself is left untouched (claw's runtime preserves the
 * frontmatter when materializing). Returns undefined values when absent.
 */
function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end === -1) return {};
  const fm = content.slice(4, end);
  const grab = (key: string): string | undefined => {
    const m = fm.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, "m"));
    if (!m) return undefined;
    let v = (m[1] ?? "").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return v || undefined;
  };
  return { ...(grab("name") ? { name: grab("name") } : {}), ...(grab("description") ? { description: grab("description") } : {}) };
}

/** Build a bundle, preferring the file's frontmatter name/slug/description over the filename. */
function makeBundle(fallbackSlugBase: string, content: string, files: PendingSkillFile[]): NamedSkillBundle {
  const fm = parseSkillFrontmatter(content);
  // Frontmatter `name` is the pi slug (must be ^[a-z0-9-]+$); prefer it.
  const slug = (fm.name && kebab(fm.name)) || kebab(fallbackSlugBase) || "skill";
  return {
    slug,
    name: titleFromSlug(slug),
    description: fm.description ?? "",
    mainContent: content,
    files,
  };
}

interface RawEntry {
  fullPath: string;
  baseName: string;
  content: string;
  contentType?: string;
  sizeBytes: number;
}

/**
 * Parse a pick that may contain MANY skills into one bundle each. Two shapes,
 * supported together:
 *   • Folder-of-folders — each subfolder containing a `SKILL.md` becomes a skill
 *     (slug = subfolder name), carrying that subfolder's other files as siblings.
 *     Files are assigned to the LONGEST matching skill-dir, so nested folders
 *     resolve correctly.
 *   • Loose `.md` files — any markdown file not under a SKILL.md folder becomes a
 *     skill on its own (slug = filename), no siblings.
 * Anything that's neither a SKILL.md sibling nor a markdown file is reported in
 * `skipped` rather than silently dropped.
 */
export async function readMultipleSkillBundles(
  files: FileList,
): Promise<{ bundles: NamedSkillBundle[]; skipped: string[] }> {
  const entries: RawEntry[] = [];
  for (const f of Array.from(files)) {
    const fullPath = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)
      .split("/").filter(Boolean).join("/");
    const baseName = fullPath.split("/").pop() ?? fullPath;
    const binary = isBinaryFile(f, fullPath);
    entries.push({
      fullPath,
      baseName,
      content: binary ? await fileToBase64(f) : await f.text(),
      ...(f.type ? { contentType: f.type } : {}),
      sizeBytes: f.size,
    });
  }

  const bundles: NamedSkillBundle[] = [];
  const claimed = new Set<RawEntry>();

  // 1) Folder skills, rooted at each SKILL.md's directory.
  const skillRoots = entries
    .filter((e) => e.baseName === "SKILL.md")
    .map((md) => ({ md, dir: md.fullPath.includes("/") ? md.fullPath.slice(0, md.fullPath.lastIndexOf("/")) : "" }));

  for (const root of skillRoots) {
    claimed.add(root.md);
    const prefix = root.dir === "" ? "" : root.dir + "/";
    const siblings: PendingSkillFile[] = [];
    for (const e of entries) {
      if (claimed.has(e) || e.baseName === "SKILL.md") continue;
      if (prefix === "" || !e.fullPath.startsWith(prefix)) continue;
      // Only claim if THIS root is the longest matching SKILL.md dir (nesting-safe).
      const deeper = skillRoots.some((r) => r !== root && r.dir.length > root.dir.length && e.fullPath.startsWith(r.dir + "/"));
      if (deeper) continue;
      claimed.add(e);
      siblings.push({
        relativePath: e.fullPath.slice(prefix.length),
        content: e.content,
        ...(e.contentType ? { contentType: e.contentType } : {}),
        sizeBytes: e.sizeBytes,
      });
    }
    const segs = root.dir.split("/").filter(Boolean);
    const base = segs.length ? segs[segs.length - 1]! : (root.md.fullPath.split("/")[0] ?? "skill");
    bundles.push(makeBundle(base, root.md.content, siblings));
  }

  // 2) Loose markdown files (not part of any SKILL.md folder) → one skill each.
  for (const e of entries) {
    if (claimed.has(e)) continue;
    if (!/\.(md|markdown)$/i.test(e.baseName)) continue;
    claimed.add(e);
    bundles.push(makeBundle(e.baseName.replace(/\.[^.]+$/, ""), e.content, []));
  }

  const skipped = entries.filter((e) => !claimed.has(e)).map((e) => e.fullPath);
  return { bundles, skipped };
}
