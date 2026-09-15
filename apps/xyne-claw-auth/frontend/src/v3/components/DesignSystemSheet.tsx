import { useEffect, useMemo, useState } from "react";
import {
  FloppyDiskIcon,
  MagicWandIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  ApiError,
  getAgentDetail,
  updateAgentDesignSystem,
} from "../../lib/api";
import type { Agent } from "../../lib/types";

const MAX_DESIGN_SYSTEM_CHARS = 32_000;

const DESIGN_SYSTEM_TEMPLATE = `# Design System

## Palette
- Primary: #2563eb
- Accent: #f97316
- Surface: #ffffff
- Surface muted: #f8fafc
- Text: #0f172a
- Text muted: #64748b
- Border: #e2e8f0

## Typography
- Font family: Inter, system-ui, sans-serif
- Display: 40px / 1.05, 700 weight
- Heading: 24px / 1.2, 650 weight
- Body: 15px / 1.55, 400 weight
- Label: 12px / 1.2, 600 weight, uppercase only for metadata

## Spacing & Radii
- Space scale: 4, 8, 12, 16, 24, 32, 48, 64
- Page padding: 24 desktop, 16 mobile
- Card radius: 8px
- Button radius: 6px
- Hairline borders: 1px solid Border

## Components
- Buttons use Primary for the main action and neutral outlines for secondary actions.
- Cards are flat, compact, and never nested inside other cards.
- Forms use visible labels, 40px controls, and clear focus rings.
- Tables prioritize scanability with muted dividers and right-aligned numbers.

## Voice & Content Rules
- Tone is concise, specific, and operational.
- Prefer concrete labels over marketing language.
- Empty states should state what happened and the next action.
- Avoid emoji, decorative gradients, and vague claims.`;

function designSystemFromAgent(agent: Agent | null): string {
  const raw = agent?.config?.["designSystem"];
  return typeof raw === "string" ? raw : "";
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface DesignSystemSheetProps {
  open: boolean;
  agentSlug: string;
  agentName: string;
  onClose: () => void;
}

export function DesignSystemSheet({
  open,
  agentSlug,
  agentName,
  onClose,
}: DesignSystemSheetProps) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaved(false);
    setReadOnly(false);
    getAgentDetail(agentSlug)
      .then((nextAgent) => {
        if (cancelled) return;
        setAgent(nextAgent);
        setValue(designSystemFromAgent(nextAgent));
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) setReadOnly(true);
        setError(errorMessage(err, "Unable to load this agent's design system."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentSlug, open]);

  const charCount = value.length;
  const tooLong = charCount > MAX_DESIGN_SYSTEM_CHARS;
  const canSave = !loading && !saving && !readOnly && !tooLong && agent !== null;
  const countLabel = useMemo(
    () => `${charCount.toLocaleString()} / ${MAX_DESIGN_SYSTEM_CHARS.toLocaleString()}`,
    [charCount],
  );

  if (!open) return null;

  const insertTemplate = () => {
    setValue((current) => current.trim() ? `${current.trimEnd()}\n\n${DESIGN_SYSTEM_TEMPLATE}` : DESIGN_SYSTEM_TEMPLATE);
    setSaved(false);
  };

  const save = async () => {
    if (!agent || !canSave) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const trimmed = value.trim();
      const updated = await updateAgentDesignSystem(agent.slug, trimmed || null);
      setAgent(updated);
      setValue(designSystemFromAgent(updated));
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setReadOnly(true);
        setError("You can view this design system, but only the agent owner, a contributor, or an admin can edit it.");
      } else {
        setError(errorMessage(err, "Unable to save this design system."));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" role="dialog" aria-modal="true" aria-label="Design system">
      <button
        type="button"
        aria-label="Close design system"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-[min(720px,96vw)] flex-col border-l border-xyne-border bg-xyne-surface shadow-2xl">
        <header className="flex shrink-0 items-start justify-between border-b border-xyne-border-subtle px-5 py-4">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-xyne-fg-primary">Design system</p>
            <p className="mt-1 truncate text-[12px] text-xyne-fg-muted">{agentName}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-xyne-fg-muted hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
          >
            <XIcon size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
          <p className="text-[12px] leading-5 text-xyne-fg-secondary">
            Store the markdown brand contract that should guide every Design Studio run for this agent: color tokens, type scale, spacing, component rules, and content voice.
          </p>
          {(readOnly || error) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900">
              {error ?? "Read-only view. Only the agent owner, a contributor, or an admin can edit this design system."}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={readOnly || loading || saving}
              onClick={insertTemplate}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-xyne-border-subtle px-2.5 text-[12px] font-medium text-xyne-fg-secondary hover:border-xyne-border-strong hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MagicWandIcon size={14} /> Insert template
            </button>
            <span className={tooLong ? "text-[12px] font-medium text-red-600" : "text-[12px] text-xyne-fg-muted"}>
              {countLabel}
            </span>
          </div>
          <textarea
            value={loading ? "Loading design system..." : value}
            onChange={(event) => {
              setValue(event.target.value);
              setSaved(false);
            }}
            readOnly={readOnly || loading}
            spellCheck
            className="min-h-0 flex-1 resize-none rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle p-3 font-mono text-[12px] leading-5 text-xyne-fg-primary outline-none focus:border-xyne-brand focus:ring-2 focus:ring-xyne-brand/15 disabled:opacity-60"
            placeholder="# Design System&#10;&#10;Define palette, typography, spacing, component rules, and voice."
          />
          {tooLong && (
            <p className="text-[12px] text-red-600">
              Design systems over 32,000 characters are ignored at runtime. Shorten this before saving.
            </p>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-xyne-border-subtle px-5 py-4">
          <span className="text-[12px] text-xyne-fg-muted">
            {saved ? "Saved" : readOnly ? "Read-only" : "Markdown contract"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-md border border-xyne-border-subtle px-3 text-[12px] font-medium text-xyne-fg-secondary hover:border-xyne-border-strong hover:text-xyne-fg-primary"
            >
              Close
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => { void save(); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-xyne-fg-primary px-3 text-[12px] font-medium text-xyne-fg-inverse hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FloppyDiskIcon size={14} /> {saving ? "Saving" : "Save"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
