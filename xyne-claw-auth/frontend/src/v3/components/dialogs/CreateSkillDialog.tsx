import { useRef, useState } from "react";
import { FolderOpenIcon, FilesIcon } from "@phosphor-icons/react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { createSkill, replaceSkillFiles } from "../../../lib/api";
import { readMultipleSkillBundles, type PendingSkillFile, type NamedSkillBundle } from "../../../lib/skillFileUtils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function CreateSkillDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  /**
   * Tracks whether the user has manually edited the slug field. While
   * false (the user is still typing the name and hasn't touched slug),
   * we re-derive slug from name on every keystroke. The previous
   * implementation guarded on `!slug`, which only ever fired on the
   * first character — afterwards slug was non-empty, the condition
   * went false, and the slug was frozen at the single first letter.
   */
  const [slugDirty, setSlugDirty] = useState(false);
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingSkillFile[]>([]);
  // Set when the pick contains more than one skill (folder-of-folders and/or
  // several loose .md files). In batch mode the single-skill form is hidden and
  // we create one skill per bundle on submit.
  const [batch, setBatch] = useState<NamedSkillBundle[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setName(""); setSlug(""); setSlugDirty(false);
    setDescription(""); setContent(""); setPendingFiles([]);
    setBatch(null); setSkipped([]);
    setSubmitting(false); setError(null);
    if (dirInputRef.current) dirInputRef.current.value = "";
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFilePick(browserFiles: FileList | null) {
    if (!browserFiles || browserFiles.length === 0) return;
    setError(null);
    const { bundles, skipped: skippedPaths } = await readMultipleSkillBundles(browserFiles);
    setSkipped(skippedPaths);
    if (bundles.length === 0) {
      setError("No skill files found. Pick one or more .md files, or a folder containing SKILL.md.");
      return;
    }
    if (bundles.length === 1) {
      // Single skill → keep the editable form, pre-filled from the file
      // (including name/description lifted out of its frontmatter).
      setBatch(null);
      const b = bundles[0]!;
      setContent(b.mainContent);
      if (!slugDirty) { setSlug(b.slug); if (!name) setName(b.name); }
      if (b.description && !description) setDescription(b.description);
      setPendingFiles(b.files);
      return;
    }
    // Multiple skills → batch mode.
    setBatch(bundles);
    setPendingFiles([]);
  }

  async function createOne(b: { slug: string; name?: string; description?: string; content: string; files: PendingSkillFile[] }) {
    await createSkill({
      slug: b.slug,
      name: b.name || undefined,
      description: b.description || undefined,
      content: b.content,
      source: "user-created",
    });
    if (b.files.length > 0) {
      await replaceSkillFiles(b.slug, b.files.map(({ relativePath, content: c, contentType }) => ({
        relativePath, content: c, ...(contentType ? { contentType } : {}),
      })));
    }
  }

  async function handleSubmit() {
    setError(null);

    // Batch mode: create one skill per detected bundle; report per-skill failures.
    if (batch) {
      setSubmitting(true);
      const failures: string[] = [];
      for (const b of batch) {
        try {
          await createOne({ slug: b.slug, name: b.name, description: b.description, content: b.mainContent, files: b.files });
        } catch (err) {
          failures.push(`${b.slug}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (failures.length > 0) {
        setError(`Created ${batch.length - failures.length}/${batch.length}. Failed:\n${failures.join("\n")}`);
        setSubmitting(false);
        return;
      }
      onCreated?.();
      onOpenChange(false);
      reset();
      return;
    }

    if (!slug || !content) { setError("Slug and content are required"); return; }
    setSubmitting(true);
    try {
      await createOne({ slug, name, description, content, files: pendingFiles });
      onCreated?.();
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create skill");
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}
      title="Create new skill"
      description="Skills are reusable instruction snippets that agents can attach."
      maxWidth={560}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Creating…" : batch ? `Create ${batch.length} skills` : "Create skill"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[10px]">
      {batch ? (
        /* Multi-skill batch: one skill per detected bundle. */
        <div className="flex flex-col gap-[6px]">
          <span className="text-[12px] font-medium text-xyne-fg-secondary">
            {batch.length} skills detected — each will be created separately
          </span>
          <div className="flex flex-col gap-[4px] max-h-[220px] overflow-auto rounded-[8px] border border-xyne-border p-[8px]">
            {batch.map((b) => (
              <div key={b.slug} className="flex items-center justify-between text-[12px]">
                <span className="font-mono text-xyne-fg-primary">{b.slug}</span>
                <span className="text-xyne-fg-tertiary">
                  {b.mainContent.length.toLocaleString()} chars
                  {b.files.length > 0 ? ` · ${b.files.length} file${b.files.length !== 1 ? "s" : ""}` : ""}
                </span>
              </div>
            ))}
          </div>
          <button type="button" onClick={reset} className="self-start text-[11px] text-xyne-fg-muted hover:text-xyne-fg-primary">
            Clear selection
          </button>
        </div>
      ) : (
      <>
      {/* Name + Slug side by side */}
      <div className="grid grid-cols-2 gap-[12px]">
        <TextField
          label="Name"
          placeholder="e.g. SQL Query Helper"
          value={name}
          onChange={(e) => {
            const next = e.target.value;
            setName(next);
            if (!slugDirty) setSlug(slugify(next));
          }}
        />
        <TextField
          label="Slug"
          placeholder="sql-query-helper"
          value={slug}
          onChange={(e) => {
            setSlug(slugify(e.target.value));
            setSlugDirty(true);
          }}
        />
      </div>
      <TextField
        label="Description"
        placeholder="One-line description of what this skill does"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <TextField
        label="Content"
        multiline
        rows={4}
        placeholder="Instructions / example queries / context that the agent should know…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      </>
      )}
      {/* ── File / folder upload ───────────────────────────────── */}
      <div className="flex flex-col gap-[6px]">
        <span className="text-[12px] font-medium text-xyne-fg-secondary">Upload skill files</span>
        <span className="text-[11px] leading-snug text-xyne-fg-tertiary">
          Drop one <code>.md</code> to fill the form, several <code>.md</code> files to create one skill each,
          or a folder of <code>SKILL.md</code> sub-folders (with their sibling files).
        </span>
        <div className="flex items-center gap-[8px]">
          <input
            ref={dirInputRef}
            type="file"
            // @ts-expect-error — webkitdirectory is non-standard but widely supported
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={(e) => void handleFilePick(e.target.files)}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleFilePick(e.target.files)}
          />
          <button
            type="button"
            onClick={() => dirInputRef.current?.click()}
            className="flex items-center gap-[5px] text-[12px] px-[10px] py-[5px] rounded-[8px] border border-xyne-border text-xyne-fg-secondary hover:bg-xyne-surface-sunken transition-colors"
          >
            <FolderOpenIcon size={13} /> Upload folder
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-[5px] text-[12px] px-[10px] py-[5px] rounded-[8px] border border-xyne-border text-xyne-fg-secondary hover:bg-xyne-surface-sunken transition-colors"
          >
            <FilesIcon size={13} /> Upload files
          </button>
        </div>
        {pendingFiles.length > 0 && (
          <div className="flex items-center justify-between text-[11px] text-xyne-fg-tertiary bg-xyne-surface-sunken rounded-[6px] px-[10px] py-[5px]">
            <span>{pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""} ready to attach</span>
            <button type="button" onClick={() => setPendingFiles([])} className="text-xyne-fg-muted hover:text-xyne-fg-primary">
              Clear
            </button>
          </div>
        )}
      </div>

      {skipped.length > 0 && (
        <p className="text-[11px] text-xyne-fg-tertiary">
          Skipped {skipped.length} non-skill file{skipped.length !== 1 ? "s" : ""} (not a .md or SKILL.md sibling): {skipped.slice(0, 5).join(", ")}{skipped.length > 5 ? "…" : ""}
        </p>
      )}
      {error && <p className="whitespace-pre-line text-[12px] text-xyne-error-fg">{error}</p>}
      </div>
    </Dialog>
  );
}
