import { useCallback, useEffect, useRef, useState } from "react";
import {
  listSkillFiles,
  replaceSkillFiles,
  type SkillFileMeta,
} from "../lib/api";

export interface PendingSkillFile {
  relativePath: string;
  content: string;
  contentType?: string;
  sizeBytes: number;
}

/**
 * Read a browser `FileList` into a list of skill-file uploads. Strips the
 * top-level folder name (so `my-skill/scripts/run.sh` becomes
 * `scripts/run.sh`). Silently skips any file named `SKILL.md` — that path
 * is owned by `Skill.content` and the backend would reject it.
 *
 * Used by the existing-skill panel where SKILL.md already lives in the
 * row's `content` field. For the CREATE flow, use `readSkillBundleFromFileList`
 * which also extracts SKILL.md and the folder-name slug hint.
 */
export async function readSkillFilesFromFileList(files: FileList): Promise<PendingSkillFile[]> {
  const bundle = await readSkillBundleFromFileList(files);
  return bundle.files;
}

export interface SkillBundle {
  /** Sibling files (everything except SKILL.md). */
  files: PendingSkillFile[];
  /** SKILL.md body, if the picker included one. */
  mainContent: string | null;
  /** Top-level folder name the user picked, normalized to kebab-case (or null
   *  when the user picked flat files rather than a directory). Useful as a
   *  slug suggestion for new-skill creation. */
  folderSlug: string | null;
}

/**
 * Same as `readSkillFilesFromFileList` but ALSO extracts the SKILL.md
 * content (instead of skipping it) and the top-level folder name. Used by
 * the create-skill form so the picker fills the slug + content textarea
 * in one shot — user picks the folder, everything's ready to submit.
 */
/**
 * Decide whether a file should be uploaded as UTF-8 text or base64-encoded
 * binary. SkillFile.content is a single TEXT column on the server side, so
 * for binaries the contract is "store as base64, mark contentType so the
 * runtime (xyne-claw/src/session-skills.ts:isBinaryContentType) decodes on
 * write." Without this, dropping a PDF into the folder picker calls
 * `f.text()` which UTF-8-decodes the binary bytes → garbage on disk → tools
 * like fill-pdf-form fail with "not a valid PDF".
 *
 * Decision order:
 *   1. The browser-set `f.type`: anything starting with `text/`, or the
 *      structured-text MIMEs json/yaml/xml, is text.
 *   2. No type set (some browsers leave it blank) → extension sniffing.
 *
 * Default for unknown extensions is text, which is the safer default for
 * developer files (.js, .py, .toml, …) the panel was originally built for.
 * Add a binary extension here when a new file type lands in /skills/* and
 * trips the same bug.
 */
function isBinaryFile(f: File, relativePath: string): boolean {
  const type = (f.type || "").toLowerCase();
  if (type) {
    if (type.startsWith("text/")) return false;
    if (type === "application/json" || type === "application/yaml" || type === "application/xml") return false;
    if (type.startsWith("image/")) return true;
    if (type.startsWith("audio/")) return true;
    if (type.startsWith("video/")) return true;
    if (
      type === "application/pdf" ||
      type === "application/zip" ||
      type === "application/octet-stream" ||
      type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      return true;
    }
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

/** Read a File as base64 — the chunked TextDecoder path keeps memory bounded
 *  for the 5MB bundle limit without OOMing on individual files. */
async function fileToBase64(f: File): Promise<string> {
  const ab = await f.arrayBuffer();
  const bytes = new Uint8Array(ab);
  // Walk in chunks to avoid a giant String.fromCharCode call on huge files.
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
    // Capture the top-level folder once, normalized for slug-validity.
    if (folderSlug === null && parts.length > 1) {
      folderSlug = parts[0]!
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!folderSlug) folderSlug = null;
    }
    const relativePath = parts.length > 1 ? parts.slice(1).join("/") : parts.join("/");

    if (isBinaryFile(f, relativePath)) {
      // SKILL.md is text-only by definition; binary files cannot collide.
      const content = await fileToBase64(f);
      out.push({
        relativePath,
        content,
        contentType: f.type || "application/octet-stream",
        sizeBytes: f.size,
      });
      continue;
    }

    const text = await f.text();
    if (relativePath === "SKILL.md") {
      mainContent = text;
      continue;
    }
    out.push({
      relativePath,
      content: text,
      ...(f.type ? { contentType: f.type } : {}),
      sizeBytes: text.length,
    });
  }
  return { files: out, mainContent, folderSlug };
}

interface Props {
  slug: string;
  canEdit: boolean;
}

/**
 * Sibling-file management for a Skill. Pi's resource loader treats a skill
 * as a directory: SKILL.md (from Skill.content) plus any number of helper
 * files (scripts, examples, data) inside the same dir. This panel lets the
 * user upload a directory (or a multi-file selection) to populate those
 * helpers.
 *
 * UX: replace-all semantics. Each upload is a full snapshot — the panel
 * gathers everything the user picked into one PUT call and the server
 * atomically swaps the SkillFile set for this skill.
 */
export function SkillFilesPanel({ slug, canEdit }: Props) {
  const [files, setFiles] = useState<SkillFileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSkillFile[] | null>(null);

  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setFiles(await listSkillFiles(slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void reload(); }, [reload]);

  const handleSelected = async (browserFiles: FileList | null) => {
    if (!browserFiles || browserFiles.length === 0) return;
    setError(null);
    setPending(await readSkillFilesFromFileList(browserFiles));
  };

  const upload = async () => {
    if (!pending) return;
    setUploading(true);
    setError(null);
    try {
      await replaceSkillFiles(slug, pending.map(({ relativePath, content, contentType }) => ({
        relativePath, content, ...(contentType ? { contentType } : {}),
      })));
      setPending(null);
      await reload();
      // Reset the file inputs so picking the same folder again triggers `change`.
      if (dirInputRef.current) dirInputRef.current.value = "";
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const clear = async () => {
    if (!confirm("Remove all files from this skill? SKILL.md (main content) is unaffected.")) return;
    setUploading(true);
    setError(null);
    try {
      await replaceSkillFiles(slug, []);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mt-4 rounded border border-zinc-800 bg-zinc-950 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Skill Files</h4>
        <span className="text-[10px] text-zinc-600">SKILL.md is managed via the main content above.</span>
      </div>

      {loading ? (
        <p className="text-xs text-zinc-600">Loading files…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-zinc-600">No additional files. Upload a directory to ship helper scripts, examples, or data alongside SKILL.md.</p>
      ) : (
        <ul className="mb-3 divide-y divide-zinc-800 rounded border border-zinc-800">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
              <span className="truncate font-mono text-zinc-300">{f.relativePath}</span>
              <span className="shrink-0 text-zinc-600">{f.sizeBytes} B{f.contentType ? ` · ${f.contentType}` : ""}</span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={dirInputRef}
              type="file"
              // @ts-expect-error — webkitdirectory is non-standard but widely supported.
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => handleSelected(e.target.files)}
              className="hidden"
              id={`skill-dir-${slug}`}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => handleSelected(e.target.files)}
              className="hidden"
              id={`skill-files-${slug}`}
            />
            <label
              htmlFor={`skill-dir-${slug}`}
              className="cursor-pointer rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Choose folder
            </label>
            <label
              htmlFor={`skill-files-${slug}`}
              className="cursor-pointer rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Choose files
            </label>
            {files.length > 0 && (
              <button
                onClick={clear}
                disabled={uploading}
                className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950 disabled:opacity-40"
              >
                Clear all
              </button>
            )}
          </div>

          {pending && pending.length > 0 && (
            <div className="mt-3 rounded border border-purple-700 bg-zinc-950 p-2">
              <p className="mb-1 text-xs text-purple-300">
                Ready to upload {pending.length} file{pending.length === 1 ? "" : "s"} ({pending.reduce((s, f) => s + f.sizeBytes, 0)} bytes total).
                Existing files will be replaced.
              </p>
              <ul className="mb-2 max-h-32 overflow-y-auto text-[11px] text-zinc-400">
                {pending.map((f) => (
                  <li key={f.relativePath} className="font-mono">{f.relativePath} <span className="text-zinc-600">({f.sizeBytes} B)</span></li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button
                  onClick={upload}
                  disabled={uploading}
                  className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "Upload"}
                </button>
                <button
                  onClick={() => setPending(null)}
                  disabled={uploading}
                  className="rounded px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
