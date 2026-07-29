import { useState, useEffect } from "react";
import { updateDigitalTwinSettings } from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";

interface SettingsModalProps {
  userId: string;
  open: boolean;
  initialSuffix: string;
  initialRespondPolicy?: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Server-enforced cap. The textarea is hard-stopped here so the counter
 *  ("X / MAX_SUFFIX_LEN") never gets out of sync with what's actually allowed. */
const MAX_SUFFIX_LEN = 500;

export function SettingsModal({
  userId,
  open,
  initialSuffix,
  initialRespondPolicy,
  onClose,
  onSaved,
}: SettingsModalProps) {
  const normPolicy = (p?: string): "always" | "learned" => (p === "learned" ? "learned" : "always");
  const [suffix, setSuffix] = useState(initialSuffix);
  const [respondPolicy, setRespondPolicy] = useState<"always" | "learned">(normPolicy(initialRespondPolicy));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSuffix(initialSuffix);
    setRespondPolicy(normPolicy(initialRespondPolicy));
  }, [initialSuffix, initialRespondPolicy, open]);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      // Empty string clears the suffix server-side (route normalizes to null).
      await updateDigitalTwinSettings(userId, { responseSuffix: suffix || null, respondPolicy });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const charCount = suffix.length;
  // Compare trimmed values so adding/removing trailing whitespace doesn't
  // count as a meaningful change (matches V1 behavior).
  const dirty = suffix.trim() !== initialSuffix.trim() || respondPolicy !== normPolicy(initialRespondPolicy);

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) onClose();
      }}
      title="Digital Twin Settings"
      leftOffset={100}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={saving || !dirty} onClick={submit}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div>
        <label className="mb-[4px] block text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
          Response suffix
        </label>
        <textarea
          value={suffix}
          onChange={(e) => setSuffix(e.target.value.slice(0, MAX_SUFFIX_LEN))}
          placeholder="— Sent by my Digital Twin · may contain mistakes"
          rows={3}
          maxLength={MAX_SUFFIX_LEN}
          className="w-full resize-none rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
        />
        <div className="mt-[4px] flex justify-between text-[11px]">
          <span className="text-xyne-fg-tertiary">
            {charCount === 0
              ? "Leave blank to disable — replies post as-is"
              : "Appended to every reply your Twin sends on your behalf"}
          </span>
          <span
            className={
              charCount >= MAX_SUFFIX_LEN ? "text-xyne-warning-fg" : "text-xyne-fg-tertiary"
            }
          >
            {charCount} / {MAX_SUFFIX_LEN}
          </span>
        </div>
      </div>

      {/* When to reply — respond/ignore policy */}
      <div className="mt-[16px]">
        <label className="mb-[6px] block text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
          When to reply to a mention
        </label>
        <div className="flex flex-col gap-[6px]">
          <label className={`flex cursor-pointer items-start gap-[8px] rounded-lg border p-[10px] transition ${respondPolicy === "always" ? "border-xyne-fg-primary bg-xyne-surface-sunken" : "border-xyne-border hover:bg-xyne-surface-sunken/60"}`}>
            <input type="radio" name="respond-policy" checked={respondPolicy === "always"} onChange={() => setRespondPolicy("always")} className="mt-[2px]" />
            <span>
              <span className="block text-[12px] font-medium text-xyne-fg-primary">Always reply</span>
              <span className="block text-[11px] text-xyne-fg-tertiary">The Twin drafts a reply to every mention (default).</span>
            </span>
          </label>
          <label className={`flex cursor-pointer items-start gap-[8px] rounded-lg border p-[10px] transition ${respondPolicy === "learned" ? "border-xyne-fg-primary bg-xyne-surface-sunken" : "border-xyne-border hover:bg-xyne-surface-sunken/60"}`}>
            <input type="radio" name="respond-policy" checked={respondPolicy === "learned"} onChange={() => setRespondPolicy("learned")} className="mt-[2px]" />
            <span>
              <span className="block text-[12px] font-medium text-xyne-fg-primary">Learned — respect my patterns</span>
              <span className="block text-[11px] text-xyne-fg-tertiary">Consults your captured respond/ignore patterns and stays silent when you'd likely ignore. Fails open — replies when unsure.</span>
            </span>
          </label>
        </div>
      </div>

      {/* Faithful preview — placeholder block + newlines + suffix, matching
          the exact shape the Twin will compose at send time. */}
      {suffix.trim().length > 0 && (
        <div className="mt-[12px] rounded-lg border border-xyne-border bg-xyne-surface-sunken p-[10px]">
          <div className="mb-[6px] text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
            Preview
          </div>
          <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary">
            <span className="text-xyne-fg-tertiary">[your Twin&apos;s reply]</span>
            {"\n\n"}
            <span className="text-xyne-brand">{suffix.trim()}</span>
          </div>
        </div>
      )}

      {err && (
        <div className="mt-[12px] rounded-lg border border-xyne-border bg-xyne-error-bg p-[10px] text-[11px] text-xyne-error-fg">
          {err}
        </div>
      )}
    </Dialog>
  );
}
