import { useRef, useState, useEffect, useCallback } from "react";
import {
  SparkleIcon,
  PencilSimpleIcon,
  TrashIcon,
  LockIcon,
  UploadSimpleIcon,
  FolderOpenIcon,
  GlobeIcon,
} from "@phosphor-icons/react";
import { SidePanel } from "../ui/SidePanel";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { useSnackbar } from "../ui/Snackbar";
import {
  updateSkill,
  listSkillFiles,
  replaceSkillFiles,
  submitSkillRequest,
} from "../../../lib/api";
import type { Skill, SkillFileMeta } from "../../../lib/api";
import { readSkillFilesFromFileList } from "../../../lib/skillFileUtils";

/* ── Helpers ─────────────────────────────────────────────────────────── */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-[8px] text-[11px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary">
      {children}
    </h3>
  );
}

/* ── Component ───────────────────────────────────────────────────────── */

interface SkillSlideOverProps {
  skill: Skill | null;
  userId: string;
  isAdmin?: boolean;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: () => void;
  onDeleteRequest: (skill: Skill) => void;
}

export function SkillSlideOver({
  skill,
  userId,
  isAdmin = false,
  onClose,
  onUpdated,
  onDeleted: _onDeleted,
  onDeleteRequest,
}: SkillSlideOverProps) {
  const { show: showSnackbar } = useSnackbar();

  /* Meta editing */
  const [editingMeta, setEditingMeta] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  /* Content editing */
  const [editingContent, setEditingContent] = useState(false);
  const [editContent, setEditContent] = useState("");

  /* Files */
  const [files, setFiles] = useState<SkillFileMeta[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Saving */
  const [saving, setSaving] = useState(false);

  const localEnabled = skill?.enabled ?? false;

  /* Reset state when skill changes */
  useEffect(() => {
    if (skill) {
      setEditName(skill.name);
      setEditDescription(skill.description ?? "");
      setEditContent(skill.content ?? "");
      setEditingMeta(false);
      setEditingContent(false);
    }
  }, [skill?.id]);

  /* Load files whenever skill changes */
  useEffect(() => {
    if (!skill) return;
    setFilesLoading(true);
    listSkillFiles(skill.slug)
      .then(setFiles)
      .catch(() => {})
      .finally(() => setFilesLoading(false));
  }, [skill?.slug]);

  if (!skill) return null;

  const canEdit =
    (skill.ownerUserId === userId || (isAdmin && skill.scope === "global")) &&
    skill.source !== "seeded";
  const isSeeded = skill.source === "seeded";

  const sourceLabel =
    skill.source === "seeded" ? "built-in"
    : skill.source === "user-created" ? "custom"
    : skill.source === "uploaded" ? "uploaded"
    : skill.source;

  const scopeLabel = skill.scope === "global" ? "global" : "personal";

  const handleSaveMeta = useCallback(async () => {
    if (!skill || saving) return;
    setSaving(true);
    try {
      await updateSkill(skill.slug, {
        name: editName,
        description: editDescription,
      });
      setEditingMeta(false);
      showSnackbar({ variant: "success", title: "Skill updated" });
      onUpdated();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      showSnackbar({
        variant: "error",
        title:
          status === 403
            ? "Only the owner can modify this skill"
            : "Failed to update skill",
      });
    } finally {
      setSaving(false);
    }
  }, [skill, saving, editName, editDescription, onUpdated, showSnackbar]);

  const handleSaveContent = useCallback(async () => {
    if (!skill || saving) return;
    setSaving(true);
    try {
      await updateSkill(skill.slug, { content: editContent });
      setEditingContent(false);
      showSnackbar({ variant: "success", title: "Content saved" });
      onUpdated();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      showSnackbar({
        variant: "error",
        title:
          status === 403
            ? "Only the owner can modify this skill"
            : "Failed to update skill",
      });
    } finally {
      setSaving(false);
    }
  }, [skill, saving, editContent, onUpdated, showSnackbar]);

  const handleFilePick = useCallback(
    async (browserFiles: FileList | null, inputEl: HTMLInputElement | null) => {
      if (!browserFiles || browserFiles.length === 0 || !skill) return;
      setFilesLoading(true);
      try {
        const pending = await readSkillFilesFromFileList(browserFiles);
        await replaceSkillFiles(skill.slug, pending.map(({ relativePath, content, contentType }) => ({
          relativePath, content, ...(contentType ? { contentType } : {}),
        })));
        setFiles(await listSkillFiles(skill.slug));
        showSnackbar({ variant: "success", title: "Files uploaded" });
      } catch {
        showSnackbar({ variant: "error", title: "Failed to upload files" });
      } finally {
        setFilesLoading(false);
        if (inputEl) inputEl.value = "";
      }
    },
    [skill, showSnackbar],
  );

  const canPublish =
    canEdit && skill.scope !== "global" && skill.source !== "seeded";
  const [publishing, setPublishing] = useState(false);

  const handlePublish = useCallback(async () => {
    if (!skill || publishing) return;
    setPublishing(true);
    try {
      await submitSkillRequest(skill.slug, userId);
      showSnackbar({
        variant: "success",
        title: "Publish request submitted",
        description:
          "An admin will review and approve before this skill becomes global.",
      });
    } catch (err) {
      const status = (err as { status?: number })?.status;
      showSnackbar({
        variant: "error",
        title:
          status === 403
            ? "You don't have permission to publish this skill"
            : "Failed to submit publish request",
      });
    } finally {
      setPublishing(false);
    }
  }, [skill, publishing, userId, showSnackbar]);

  const footer =
    canPublish || canEdit ? (
      <div className="flex items-center gap-2">
        {canPublish && (
          <Button
            variant="ghost"
            leadingIcon={<GlobeIcon size={14} />}
            onClick={handlePublish}
            disabled={publishing}
          >
            {publishing ? "Submitting…" : "Publish"}
          </Button>
        )}
        {canEdit && (
          <Button
            variant="ghost"
            className="text-xyne-error-fg hover:bg-xyne-error-bg"
            leadingIcon={<TrashIcon size={14} />}
            onClick={() => onDeleteRequest(skill)}
          >
            Delete skill
          </Button>
        )}
      </div>
    ) : undefined;

  return (
    <SidePanel
      onClose={onClose}
      icon={
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-xyne-surface-sunken">
          <SparkleIcon size={20} className="text-xyne-fg-secondary" />
        </div>
      }
      title={skill.name || skill.slug}
      subtitle={`${skill.slug} · ${sourceLabel} · ${scopeLabel}`}
      footer={footer}
      floating
    >
      <div className="flex flex-col gap-[20px]">

        {/* ── Status ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`shrink-0 h-2 w-2 rounded-full ${
                localEnabled ? "bg-xyne-success" : "bg-xyne-warning"
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-xyne-fg-primary">
                {localEnabled ? "Enabled" : "Disabled"}
              </div>
              <div className="text-[11px] text-xyne-fg-tertiary">
                {localEnabled
                  ? "Active and available to agents"
                  : "Agents can't use this skill until re-enabled"}
              </div>
            </div>
          </div>
          {isSeeded && (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-md border border-xyne-border-subtle bg-xyne-surface px-2 py-0.5 text-[11px] font-medium text-xyne-fg-tertiary">
              <LockIcon size={10} weight="fill" />
              Read-only
            </span>
          )}
        </div>

        {/* ── Description ────────────────────────────────────────────── */}
        <div className="rounded-[12px] border border-xyne-border-subtle bg-xyne-surface-subtle p-[14px]">
          <SectionLabel>Description</SectionLabel>
          {canEdit && editingMeta ? (
            <div className="flex flex-col gap-[10px]">
              {/* Name field — clearly labelled to avoid confusion */}
              <div>
                <label className="mb-[4px] block text-[11px] text-xyne-fg-tertiary">
                  Name
                </label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-[8px] border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[13px] font-medium text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
                />
              </div>
              {/* Description field */}
              <div>
                <label className="mb-[4px] block text-[11px] text-xyne-fg-tertiary">
                  Description
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  placeholder="What this skill does and when agents should use it…"
                  className="w-full resize-none rounded-[8px] border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] text-xyne-fg-secondary focus:border-xyne-brand focus:outline-none"
                />
              </div>
              <div className="flex gap-[8px]">
                <Button variant="primary" size="sm" onClick={handleSaveMeta} disabled={saving}>
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditName(skill.name);
                    setEditDescription(skill.description ?? "");
                    setEditingMeta(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div>
              {skill.description ? (
                <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">
                  {skill.description}
                </p>
              ) : (
                <span className="text-[12px] italic text-xyne-fg-muted">
                  No description added
                </span>
              )}
              {canEdit && (
                <button
                  onClick={() => setEditingMeta(true)}
                  className="mt-[8px] flex items-center gap-[4px] text-[11px] text-xyne-fg-tertiary hover:text-xyne-fg-secondary"
                >
                  <PencilSimpleIcon size={12} /> Edit
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Details ────────────────────────────────────────────────── */}
        <div className="rounded-[12px] border border-xyne-border-subtle bg-xyne-surface-subtle p-[14px]">
          <SectionLabel>Details</SectionLabel>
          <div className="divide-y divide-xyne-border-subtle text-[13px]">
            <div className="flex items-center justify-between py-[8px]">
              <span className="text-xyne-fg-tertiary">Created</span>
              <span className="text-xyne-fg-primary">{formatDate(skill.createdAt)}</span>
            </div>
            <div className="flex items-center justify-between py-[8px]">
              <span className="text-xyne-fg-tertiary">Size</span>
              <span className="text-xyne-fg-primary">{formatNumber(skill.content?.length ?? 0)} characters</span>
            </div>
          </div>
        </div>

        {/* ── System prompt (Content) ─────────────────────────────────── */}
        <div className="rounded-[12px] border border-xyne-border-subtle bg-xyne-surface-subtle p-[14px]">
          <div className="flex items-center justify-between mb-[8px]">
            <SectionLabel>System prompt</SectionLabel>
            <span className="text-[11px] text-xyne-fg-tertiary -mt-[8px]">
              {(editingContent ? editContent : skill.content)?.length ?? 0} chars
            </span>
          </div>
          {editingContent ? (
            <div>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="h-[280px] w-full rounded-lg bg-xyne-surface p-[10px] text-[11px] font-mono leading-[1.6] text-xyne-fg-secondary resize-none focus:outline-none border border-xyne-border focus:border-xyne-brand"
              />
              <div className="mt-[10px] flex gap-[8px]">
                <Button variant="primary" size="sm" onClick={handleSaveContent} disabled={saving}>
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditContent(skill.content ?? "");
                    setEditingContent(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="max-h-[220px] overflow-y-auto rounded-lg bg-xyne-surface p-[10px]">
                {skill.content ? (
                  <pre className="whitespace-pre-wrap text-[11px] font-mono leading-[1.6] text-xyne-fg-secondary">
                    {skill.content}
                  </pre>
                ) : (
                  <span className="text-[12px] italic text-xyne-fg-muted">
                    No content — add a system prompt to make this skill useful
                  </span>
                )}
              </div>
              {canEdit && (
                <button
                  onClick={() => setEditingContent(true)}
                  className="mt-[8px] flex items-center gap-[4px] text-[11px] text-xyne-fg-tertiary hover:text-xyne-fg-secondary"
                >
                  <PencilSimpleIcon size={12} /> Edit
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Files ──────────────────────────────────────────────────── */}
        <div className="rounded-[12px] border border-xyne-border-subtle bg-xyne-surface-subtle p-[14px]">
          <SectionLabel>Files</SectionLabel>
          {filesLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <span className="text-[12px] italic text-xyne-fg-muted">No files uploaded</span>
          ) : (
            <div className="flex flex-col mb-[8px]">
              {files.map((f) => (
                <div
                  key={f.relativePath}
                  className="flex items-center justify-between border-b border-xyne-border-subtle py-[6px] text-[12px]"
                >
                  <span className="font-mono text-xyne-fg-secondary">{f.relativePath}</span>
                  <span className="text-[11px] text-xyne-fg-tertiary">{formatFileSize(f.sizeBytes)}</span>
                </div>
              ))}
            </div>
          )}
          {canEdit && (
            <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
              <input
                ref={dirInputRef}
                type="file"
                // @ts-expect-error — webkitdirectory is non-standard but widely supported
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
                onChange={(e) => void handleFilePick(e.target.files, dirInputRef.current)}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void handleFilePick(e.target.files, fileInputRef.current)}
              />
              <button
                type="button"
                onClick={() => dirInputRef.current?.click()}
                className="flex items-center gap-[5px] text-[12px] text-xyne-fg-tertiary hover:text-xyne-fg-primary transition-colors"
              >
                <FolderOpenIcon size={13} /> Upload folder
              </button>
              <span className="text-xyne-fg-muted text-[11px]">·</span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-[5px] text-[12px] text-xyne-fg-tertiary hover:text-xyne-fg-primary transition-colors"
              >
                <UploadSimpleIcon size={13} /> Upload files
              </button>
              <p className="w-full mt-[2px] text-[10px] text-xyne-fg-muted">
                All existing files will be replaced on upload
              </p>
            </div>
          )}
        </div>

      </div>
    </SidePanel>
  );
}
