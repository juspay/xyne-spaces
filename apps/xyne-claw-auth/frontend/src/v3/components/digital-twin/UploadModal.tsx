import { useState, useRef } from "react";
import { uploadDigitalTwinMd } from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";

interface UploadModalProps {
  userId: string;
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

export function UploadModal({ userId, open, onClose, onUploaded }: UploadModalProps) {
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_BYTES = 200 * 1024; // 200 KB — matches backend limit

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "md" && ext !== "markdown") {
      setErr("Only .md / .markdown files are supported.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setErr(`File too large — maximum is 200 KB (this file is ${(file.size / 1024).toFixed(0)} KB).`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setErr(null);
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setContent(typeof ev.target?.result === "string" ? ev.target.result : "");
    };
    reader.onerror = () => {
      setErr("Failed to read file. Please try again.");
      setFilename("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  }

  async function submit() {
    if (!filename || !content.trim()) return;
    setUploading(true);
    setErr(null);
    try {
      await uploadDigitalTwinMd(userId, filename, content.trim());
      setContent("");
      setFilename("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onUploaded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) onClose();
      }}
      title="Upload Markdown File"
      leftOffset={100}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!filename || !content.trim() || uploading}
            onClick={submit}
          >
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </>
      }
    >
      <p className="text-[12px] text-xyne-fg-secondary">
        Attach a markdown file (e.g. an &ldquo;about me&rdquo;, working preferences, project context).
        The curator extracts candidate memories from it and adds them under the Documents cluster for
        your review.
      </p>

      <div>
        <label className="mb-[4px] block text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
          File
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          onChange={handleFileSelect}
          className="block w-full text-[12px] text-xyne-fg-secondary file:mr-[8px] file:rounded-lg file:border file:border-xyne-border file:bg-xyne-surface-sunken file:px-[10px] file:py-[6px] file:text-[12px] file:text-xyne-fg-primary hover:file:bg-xyne-surface-subtle"
        />
        {filename && <p className="mt-[4px] text-[11px] text-xyne-fg-tertiary">{filename}</p>}
      </div>

      {content && (
        <div>
          <label className="mb-[4px] block text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
            Content preview
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="w-full resize-none rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[11px] font-mono text-xyne-fg-secondary focus:border-xyne-brand focus:outline-none"
          />
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-xyne-border bg-xyne-error-bg p-[10px] text-[11px] text-xyne-error-fg">
          {err}
        </div>
      )}
    </Dialog>
  );
}
