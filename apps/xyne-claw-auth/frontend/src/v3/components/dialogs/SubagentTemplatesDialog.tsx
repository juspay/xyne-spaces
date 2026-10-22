import { useEffect, useState } from "react";
import { CircleDashedIcon, LightningIcon } from "@phosphor-icons/react";
import { cloneSubagentTemplate, listSubagentTemplates } from "../../../lib/api";
import type { SubagentDef, SubagentTemplateSummary } from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";

const KEBAB_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;

interface SubagentTemplatesDialogProps {
  open: boolean;
  onClose: () => void;
  onCloned: (created: SubagentDef) => void;
  existingNames: string[];
}

export function SubagentTemplatesDialog({ open, onClose, onCloned, existingNames }: SubagentTemplatesDialogProps) {
  const [templates, setTemplates] = useState<SubagentTemplateSummary[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [cloning, setCloning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    listSubagentTemplates()
      .then((t) => {
        setTemplates(t);
        setNames(Object.fromEntries(t.map((x) => [x.id, x.defaultName])));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load templates"));
  }, [open]);

  const problem = (name: string) =>
    !KEBAB_RE.test(name) ? "Use lowercase letters, digits and hyphens" : existingNames.includes(name) ? `"${name}" is already taken` : null;

  const clone = async (t: SubagentTemplateSummary) => {
    const name = (names[t.id] ?? t.defaultName).trim();
    setCloning(t.id);
    setError(null);
    try {
      onCloned(await cloneSubagentTemplate(t.id, name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setCloning(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Start from a template"
      description="Ready-made fast subagents with their checks and a labelled eval set. Clone one, then adjust it on its Checks tab."
      maxWidth={672}
    >
      <div className="space-y-3" data-id="subagent-templates">
        {!templates && !error && <p className="text-[13px] text-xyne-fg-muted">Loading templates…</p>}
        {templates?.map((t) => {
          const name = names[t.id] ?? t.defaultName;
          const p = problem(name);
          return (
            <div key={t.id} className="space-y-2 rounded-xl border border-xyne-border bg-xyne-surface p-4" data-id="subagent-template">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-1.5 text-[14px] font-medium text-xyne-fg-primary">
                    {t.title}
                    {t.fast && (
                      <span className="flex items-center gap-0.5 rounded-full border border-xyne-border px-1.5 py-0.5 text-[11px] font-normal text-xyne-fg-secondary">
                        <LightningIcon size={11} /> Fast
                      </span>
                    )}
                  </h3>
                  <p className="mt-1 text-[12px] text-xyne-fg-muted">{t.summary}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] text-xyne-fg-secondary">
                <span className="rounded-full bg-xyne-surface-subtle px-2 py-0.5">{t.checks} checks</span>
                <span className="rounded-full bg-xyne-surface-subtle px-2 py-0.5">
                  {t.samples} {t.screenshotSamples ? "screenshot" : "text"} samples
                </span>
                {t.tools.slice(0, 3).map((x) => (
                  <span key={x} className="rounded-full bg-xyne-surface-subtle px-2 py-0.5 font-mono">{x}</span>
                ))}
                {t.tools.length > 3 && <span className="rounded-full bg-xyne-surface-subtle px-2 py-0.5">+{t.tools.length - 3} tools</span>}
              </div>
              {t.requires.length > 0 && <p className="text-[11px] text-xyne-fg-muted">Needs: {t.requires.join(", ")}</p>}
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <input
                    value={name}
                    onChange={(e) => setNames((prev) => ({ ...prev, [t.id]: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-") }))}
                    aria-label={`Name for ${t.title}`}
                    className="w-full rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-3 py-1.5 font-mono text-[12px] text-xyne-fg-primary focus:border-xyne-border-focus focus:outline-none"
                  />
                  {p && <p className="mt-1 text-[11px] text-xyne-error-fg">{p}</p>}
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void clone(t)}
                  disabled={Boolean(p) || cloning !== null}
                  leadingIcon={cloning === t.id ? <CircleDashedIcon size={14} className="animate-spin" /> : undefined}
                >
                  {cloning === t.id ? "Cloning…" : "Clone"}
                </Button>
              </div>
            </div>
          );
        })}
        {error && <p className="text-[12px] text-xyne-error-fg">{error}</p>}
      </div>
    </Dialog>
  );
}
