import { useRef, useState } from "react";
import { FolderOpenIcon, FilesIcon } from "@phosphor-icons/react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { createSkill, replaceSkillFiles } from "../../../lib/api";
import { readSkillBundleFromFileList, type PendingSkillFile } from "../../../lib/skillFileUtils";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setName(""); setSlug(""); setSlugDirty(false);
    setDescription(""); setContent(""); setPendingFiles([]);
    setSubmitting(false); setError(null);
    if (dirInputRef.current) dirInputRef.current.value = "";
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFilePick(browserFiles: FileList | null) {
    if (!browserFiles || browserFiles.length === 0) return;
    setError(null);
    const bundle = await readSkillBundleFromFileList(browserFiles);
    if (bundle.mainContent !== null) setContent(bundle.mainContent);
    if (bundle.folderSlug && !slugDirty) {
      setSlug(bundle.folderSlug);
      if (!name) setName(bundle.folderSlug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
    }
    setPendingFiles(bundle.files);
  }

  async function handleSubmit() {
    setError(null);
    if (!slug || !content) { setError("Slug and content are required"); return; }
    setSubmitting(true);
    try {
      await createSkill({
        slug,
        name: name || undefined,
        description: description || undefined,
        content,
        source: "user-created",
      });
      if (pendingFiles.length > 0) {
        await replaceSkillFiles(slug, pendingFiles.map(({ relativePath, content: c, contentType }) => ({
          relativePath, content: c, ...(contentType ? { contentType } : {}),
        })));
      }
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
            {submitting ? "Creating…" : "Create skill"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[10px]">
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
      {/* ── File / folder upload ───────────────────────────────── */}
      <div className="flex flex-col gap-[6px]">
        <span className="text-[12px] font-medium text-xyne-fg-secondary">Attach files (optional)</span>
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

      {error && <p className="text-[12px] text-xyne-error-fg">{error}</p>}
      </div>
    </Dialog>
  );
}
