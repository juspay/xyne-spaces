import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowsClockwiseIcon, CircleDashedIcon, CopyIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import {
  createLoopCommand,
  deleteLoopCommand,
  getLoopTemplates,
  listLoopCommands,
  listSubagents,
  publishLoopCommand,
  updateLoopCommand,
} from "../../lib/api";
import type { LoopCommandBody, LoopCommandRow, LoopTemplateCatalogue, LoopTemplateInfo, SubagentDef } from "../../lib/api";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { SelectField } from "./ui/SelectField";
import { TextField } from "./ui/TextField";
import { useSnackbar } from "./ui/Snackbar";

const NAME_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

interface Draft {
  id: string | null;
  name: string;
  description: string;
  template: LoopTemplateInfo | null;
  instruction: string;
  skills: string[];
  subagents: string[];
  provider: string;
  modelId: string;
  maxDurationMinutes: string;
  maxPasses: string;
  deliverable: "" | "md" | "html";
  judgeQuestion: string;
}

const EMPTY: Draft = { id: null, name: "", description: "", template: null, instruction: "", skills: [], subagents: [], provider: "", modelId: "", maxDurationMinutes: "", maxPasses: "", deliverable: "", judgeQuestion: "" };

function draftFrom(row: LoopCommandRow, templates: LoopTemplateInfo[]): Draft {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    template: templates.find((t) => t.id === row.template) ?? null,
    instruction: row.instruction,
    skills: row.skills,
    subagents: row.subagents,
    provider: row.provider ?? "",
    modelId: row.modelId ?? "",
    maxDurationMinutes: String(row.maxDurationMinutes),
    maxPasses: row.maxPasses ? String(row.maxPasses) : "",
    deliverable: row.deliverable ?? "",
    judgeQuestion: row.judgeQuestion ?? "",
  };
}

function problems(d: Draft, existing: string[]): string[] {
  const out: string[] = [];
  const t = d.template;
  if (!t) return ["Pick a template"];
  if (!d.id && !NAME_RE.test(d.name)) out.push("Name: 3–32 lowercase letters, digits and hyphens, starting with a letter");
  if (!d.id && existing.includes(d.name)) out.push(`/${d.name} already exists`);
  if (d.description.trim().length < 3) out.push("Write a one-line description");
  if (d.instruction.trim().length < 20) out.push("Write the task instruction (at least 20 characters)");
  if (t.question && d.judgeQuestion.trim().length < 10) out.push(`${t.question.label}: write one yes/no question`);
  if (t.deliverable === "required" && !d.deliverable) out.push("Pick a deliverable");
  const mins = Number(d.maxDurationMinutes || t.defaultDurationMin);
  if (!Number.isInteger(mins) || mins < 5 || mins > t.maxDurationMin) out.push(`Duration cap: 5–${t.maxDurationMin} minutes`);
  if (d.maxPasses && (!Number.isInteger(Number(d.maxPasses)) || Number(d.maxPasses) < 1 || Number(d.maxPasses) > 50)) out.push("Max passes: 1–50");
  return out;
}

function body(d: Draft): LoopCommandBody {
  const t = d.template!;
  return {
    ...(d.id ? {} : { name: d.name }),
    description: d.description.trim(),
    template: t.id,
    instruction: d.instruction.trim(),
    skills: d.skills,
    subagents: d.subagents,
    provider: d.provider || null,
    modelId: d.modelId.trim() || null,
    maxDurationMinutes: Number(d.maxDurationMinutes || t.defaultDurationMin),
    maxPasses: d.maxPasses ? Number(d.maxPasses) : null,
    deliverable: d.deliverable || null,
    judgeQuestion: t.question ? d.judgeQuestion.trim() : null,
  };
}

function Chips({ options, selected, onToggle }: { options: Array<{ id: string; label: string; title?: string }>; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.title}
          onClick={() => onToggle(o.id)}
          className={`rounded-full border px-2.5 py-1 text-[12px] transition ${selected.includes(o.id) ? "border-xyne-brand bg-xyne-surface-subtle text-xyne-fg-primary" : "border-xyne-border text-xyne-fg-secondary hover:border-xyne-border-strong"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function LoopCommandsPage() {
  const { show: showSnackbar } = useSnackbar();
  const [catalogue, setCatalogue] = useState<LoopTemplateCatalogue | null>(null);
  const [rows, setRows] = useState<LoopCommandRow[] | null>(null);
  const [subagents, setSubagents] = useState<SubagentDef[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<LoopCommandRow | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, r, s] = await Promise.all([getLoopTemplates(), listLoopCommands(), listSubagents().catch(() => [] as SubagentDef[])]);
      setCatalogue(c);
      setRows(r);
      setSubagents(s.filter((x) => x.enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load loop commands");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const existingNames = useMemo(() => (rows ?? []).map((r) => r.name), [rows]);
  const u = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const toggle = (key: "skills" | "subagents", id: string) =>
    setDraft((d) => (d ? { ...d, [key]: d[key].includes(id) ? d[key].filter((x) => x !== id) : [...d[key], id] } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const row = draft.id ? await updateLoopCommand(draft.id, body(draft)) : await createLoopCommand(body(draft));
      setDraft(null);
      setSaved(row);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const publish = async (row: LoopCommandRow, published: boolean) => {
    try {
      await publishLoopCommand(row.id, published);
      showSnackbar({ variant: "success", title: published ? `/${row.name} is now available to your org` : `/${row.name} is a draft again` });
      await load();
    } catch (err) {
      showSnackbar({ variant: "error", title: "Could not change visibility", description: err instanceof Error ? err.message : undefined });
    }
  };

  const remove = async (row: LoopCommandRow) => {
    try {
      await deleteLoopCommand(row.id);
      await load();
    } catch (err) {
      showSnackbar({ variant: "error", title: "Delete failed", description: err instanceof Error ? err.message : undefined });
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    showSnackbar({ variant: "success", title: "Copied" });
  };

  const t = draft?.template ?? null;
  const issues = draft ? problems(draft, existingNames) : [];
  const tryLine = (row: LoopCommandRow) => `/${row.name} ${Math.min(30, row.maxDurationMinutes)}m <what to focus on>`;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-xyne-surface" data-id="loop-commands">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-xyne-border px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-[16px] font-semibold text-xyne-fg-primary">
            <ArrowsClockwiseIcon size={18} /> Loop commands
          </h1>
          <p className="text-[12px] text-xyne-fg-muted">
            Build your own slash command from a loop template. It runs pass after pass in a thread, like /experiment, until its finish rule is met.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => { setError(null); setDraft({ ...EMPTY }); }} leadingIcon={<PlusIcon size={14} />}>
          New loop command
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {error && !draft && <p className="text-[13px] text-xyne-error-fg">{error}</p>}
        {saved && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-xyne-border bg-xyne-surface-subtle p-3 text-[13px]" data-id="loop-try">
            <div>
              <p className="font-medium text-xyne-fg-primary">Try {saved.command} in a thread</p>
              <p className="text-[12px] text-xyne-fg-muted">
                Mention your agent and type the command. {saved.published ? "Anyone in your org can run it." : "It is a draft, so only you can run it until you publish it."}
              </p>
              <code className="mt-1 inline-block rounded bg-xyne-surface px-2 py-1 font-mono text-[12px] text-xyne-fg-primary">{tryLine(saved)}</code>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => copy(tryLine(saved))} leadingIcon={<CopyIcon size={14} />}>Copy</Button>
              {!saved.published && <Button size="sm" variant="primary" onClick={() => void publish(saved, true).then(() => setSaved({ ...saved, published: true }))}>Publish to org</Button>}
            </div>
          </div>
        )}

        <section className="overflow-hidden rounded-xl border border-xyne-border">
          <table className="w-full text-[13px]" data-id="loop-list">
            <thead className="bg-xyne-surface-subtle text-left text-[12px] text-xyne-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Command</th>
                <th className="px-3 py-2 font-medium">Loop</th>
                <th className="px-3 py-2 font-medium">Limits</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={5} className="px-3 py-6 text-center text-xyne-fg-muted">Loading…</td></tr>}
              {rows?.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-xyne-fg-muted">No loop commands yet. Start one from a template.</td></tr>
              )}
              {rows?.map((r) => (
                <tr key={r.id} className="border-t border-xyne-border" data-id="loop-row">
                  <td className="px-3 py-2">
                    <span className="font-mono font-medium text-xyne-fg-primary">{r.command}</span>
                    <div className="text-[12px] text-xyne-fg-muted">{r.description}</div>
                  </td>
                  <td className="px-3 py-2 text-xyne-fg-secondary">{catalogue?.templates.find((x) => x.id === r.template)?.title ?? r.template}</td>
                  <td className="px-3 py-2 text-[12px] text-xyne-fg-secondary">
                    ≤ {r.maxDurationMinutes}m{r.maxPasses ? ` · ≤ ${r.maxPasses} passes` : ""}{r.deliverable ? ` · .${r.deliverable}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${r.published ? "bg-xyne-success-fg/10 text-xyne-success-fg" : "bg-xyne-surface-subtle text-xyne-fg-muted"}`}>
                      {r.published ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.mine && catalogue && (
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => { setError(null); setDraft(draftFrom(r, catalogue.templates)); }}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => void publish(r, !r.published)}>{r.published ? "Unpublish" : "Publish"}</Button>
                        <button type="button" aria-label={`Delete ${r.command}`} onClick={() => void remove(r)} className="px-1 text-xyne-fg-muted hover:text-xyne-error-fg">
                          <TrashIcon size={15} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <Dialog
        open={draft !== null}
        onOpenChange={(o) => { if (!o) setDraft(null); }}
        title={draft?.id ? `Edit /${draft.name}` : t ? `New loop command · ${t.title}` : "New loop command · pick a template"}
        description={t ? t.summary : "Each template is a loop shape. You fill in the task; the template decides when it stops."}
        maxWidth={720}
        footer={
          draft && (
            <div className="flex w-full items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => (t && !draft.id ? u({ template: null }) : setDraft(null))}>{t && !draft.id ? "Back" : "Cancel"}</Button>
              {t && (
                <Button variant="primary" size="sm" disabled={saving || issues.length > 0} onClick={() => void save()} leadingIcon={saving ? <CircleDashedIcon size={14} className="animate-spin" /> : undefined}>
                  {draft.id ? "Save changes" : "Save as draft"}
                </Button>
              )}
            </div>
          )
        }
      >
        {draft && !t && catalogue && (
          <div className="grid gap-2 sm:grid-cols-2" data-id="loop-templates">
            {catalogue.templates.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => u({ template: x, maxDurationMinutes: String(x.defaultDurationMin), deliverable: x.deliverable === "required" ? "md" : "" })}
                className="rounded-xl border border-xyne-border bg-xyne-surface p-3 text-left transition hover:border-xyne-border-strong"
                data-id="loop-template"
              >
                <p className="text-[13px] font-medium text-xyne-fg-primary">{x.title}</p>
                <p className="mt-1 text-[12px] text-xyne-fg-muted">{x.summary}</p>
                <p className="mt-2 text-[11px] italic text-xyne-fg-secondary">e.g. {x.example}</p>
              </button>
            ))}
          </div>
        )}

        {draft && t && catalogue && (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1" data-id="loop-form">
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Command name"
                hint={draft.id ? "Name can't change after creation" : "Typed as /name in a thread"}
                value={draft.name}
                disabled={Boolean(draft.id)}
                placeholder="perf-hunt"
                onChange={(e) => u({ name: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/--+/g, "-") })}
              />
              <TextField label="Description" hint="One line, shown in /help" value={draft.description} placeholder="Hunt performance regressions" onChange={(e) => u({ description: e.target.value })} />
            </div>
            <TextField
              label="Task instruction"
              hint="What every pass should do. The template adds the loop and exit rules for you."
              multiline
              rows={6}
              value={draft.instruction}
              placeholder={t.example}
              onChange={(e) => u({ instruction: e.target.value })}
            />
            {t.question && (
              <TextField
                label={t.question.label}
                hint={t.question.retryWhen ? "After each pass xor asks this; 'yes' sends it back for another pass." : "After each pass xor asks this; 'no' sends it back for another pass."}
                value={draft.judgeQuestion}
                placeholder={t.question.placeholder}
                onChange={(e) => u({ judgeQuestion: e.target.value })}
              />
            )}
            <div className="grid grid-cols-3 gap-3">
              <TextField label="Duration cap (minutes)" hint={`5–${t.maxDurationMin}; the run can't be longer`} value={draft.maxDurationMinutes} onChange={(e) => u({ maxDurationMinutes: e.target.value.replace(/\D/g, "") })} />
              <TextField label="Max passes" hint={t.exit === "judge" ? "Retries before the report (default 6)" : "Optional"} value={draft.maxPasses} onChange={(e) => u({ maxPasses: e.target.value.replace(/\D/g, "") })} />
              {t.deliverable !== "none" && (
                <SelectField
                  label={t.deliverable === "required" ? "Deliverable" : "Deliverable (optional)"}
                  value={draft.deliverable || "none"}
                  options={[...(t.deliverable === "required" ? [] : [{ value: "none", label: "None" }]), { value: "md", label: "Markdown report" }, { value: "html", label: "HTML document" }]}
                  onValueChange={(v) => u({ deliverable: v === "md" || v === "html" ? v : "" })}
                />
              )}
            </div>
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-xyne-fg-secondary">Skill bundles</p>
              <Chips options={catalogue.skillBundles.map((b) => ({ id: b.id, label: b.label, title: b.summary }))} selected={draft.skills} onToggle={(id) => toggle("skills", id)} />
            </div>
            {subagents.length > 0 && (
              <div>
                <p className="mb-1.5 text-[12px] font-medium text-xyne-fg-secondary">Subagents to delegate to <span className="font-normal text-xyne-fg-muted">(must be enabled on the agent you run it with)</span></p>
                <Chips options={subagents.map((s) => ({ id: s.name, label: s.name, title: s.description }))} selected={draft.subagents} onToggle={(id) => toggle("subagents", id)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label="Model"
                value={draft.provider || "agent"}
                options={[{ value: "agent", label: "Agent's default" }, ...catalogue.providers.map((p) => ({ value: p, label: p }))]}
                onValueChange={(v) => u({ provider: v && v !== "agent" ? v : "" })}
              />
              {draft.provider && <TextField label="Model id (optional)" value={draft.modelId} placeholder="e.g. open-fast" onChange={(e) => u({ modelId: e.target.value })} />}
            </div>
            {(issues.length > 0 || error) && (
              <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-xyne-error-fg" data-id="loop-issues">
                {issues.map((i) => <li key={i}>{i}</li>)}
                {error && <li>{error}</li>}
              </ul>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
