import { useEffect, useMemo, useRef, useState } from "react";
import { CircleDashedIcon, ImageIcon, PlusIcon, TrashIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { tryChecks } from "../../../lib/api";
import type { CheckAnswer, CheckTryResult, CheckValue, SubagentCheck, SubagentCheckType, SubagentSample } from "../../../lib/api";
import { Button } from "../ui/Button";
import { SelectField } from "../ui/SelectField";

const MAX_CHECKS = 12;
const MAX_SAMPLES = 50;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;

const TYPE_OPTIONS: Array<{ value: SubagentCheckType; label: string }> = [
  { value: "yesno", label: "Yes / No" },
  { value: "choice", label: "Pick one" },
  { value: "score", label: "Score (low → high)" },
  { value: "value", label: "Extract a value" },
];

const DTYPE_OPTIONS = [
  { value: "string", label: "Text" },
  { value: "int", label: "Whole number" },
  { value: "float", label: "Decimal number" },
];

interface DraftCheck {
  key: string;
  id: string;
  question: string;
  type: SubagentCheckType;
  optionsText: string;
  dtype: "string" | "int" | "float";
  extra: Pick<SubagentCheck, "pattern" | "expect" | "threshold">;
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

function toDraft(c: SubagentCheck, i: number): DraftCheck {
  const optionsText = Array.isArray(c.options)
    ? c.options.join("\n")
    : c.options
      ? Object.entries(c.options).map(([k, v]) => (k === slug(v) ? v : `${k}: ${v}`)).join("\n")
      : "";
  const extra = {
    ...(c.pattern !== undefined ? { pattern: c.pattern } : {}),
    ...(c.expect !== undefined ? { expect: c.expect } : {}),
    ...(c.threshold !== undefined ? { threshold: c.threshold } : {}),
  };
  return { key: `${i}-${c.id}`, id: c.id, question: c.question, type: c.type, optionsText, dtype: c.dtype ?? "string", extra };
}

function parseChoice(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const m = /^([a-zA-Z0-9_-]{1,40})\s*:\s*(.+)$/.exec(line);
    const key = m ? m[1]! : slug(line);
    if (key && !(key in out)) out[key] = m ? m[2]!.trim() : line;
  }
  return out;
}

function draftProblem(d: DraftCheck, ids: string[]): string | null {
  if (!d.question.trim()) return "Write the question";
  if (!ID_RE.test(d.id)) return "Id: letters, digits, - and _ only";
  if (ids.filter((x) => x === d.id).length > 1) return "Two checks share this id";
  if (d.type === "choice" && Object.keys(parseChoice(d.optionsText)).length < 2) return "Add at least 2 options, one per line";
  if (d.type === "score" && d.optionsText.split("\n").filter((l) => l.trim()).length < 2) return "Add at least 2 levels, lowest first";
  return null;
}

function fromDraft(d: DraftCheck): SubagentCheck {
  const { pattern, ...rest } = d.extra;
  const base = { id: d.id, question: d.question.trim(), type: d.type, ...rest, ...(d.type === "value" && pattern !== undefined ? { pattern } : {}) };
  if (d.type === "choice") return { ...base, options: parseChoice(d.optionsText) };
  if (d.type === "score") return { ...base, options: d.optionsText.split("\n").map((l) => l.trim()).filter(Boolean) };
  if (d.type === "value") return { ...base, dtype: d.dtype };
  return base;
}

function nextId(drafts: DraftCheck[]): string {
  let n = drafts.length + 1;
  while (drafts.some((d) => d.id === `check_${n}`)) n++;
  return `check_${n}`;
}

const fmt = (v: CheckValue) => (v === null ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

interface ChecksEditorProps {
  checks: SubagentCheck[];
  onChange: (checks: SubagentCheck[], valid: boolean) => void;
  samples: SubagentSample[];
  onSamplesChange: (samples: SubagentSample[]) => void;
  canEdit: boolean;
  context?: string;
}

export function ChecksEditor({ checks, onChange, samples, onSamplesChange, canEdit, context }: ChecksEditorProps) {
  const [drafts, setDrafts] = useState<DraftCheck[]>(() => checks.map(toDraft));
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ name: string; url: string } | null>(null);
  const [trying, setTrying] = useState(false);
  const [result, setResult] = useState<{ checks: SubagentCheck[]; res: CheckTryResult; text: string; image?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastSent = useRef<string | null>(null);

  const ids = drafts.map((d) => d.id);
  const problems = drafts.map((d) => draftProblem(d, ids));
  const valid = problems.every((p) => p === null);
  const built = useMemo(() => drafts.map(fromDraft), [drafts]);

  useEffect(() => {
    const key = `${valid}:${JSON.stringify(built)}`;
    if (lastSent.current === null) {
      lastSent.current = key;
      return;
    }
    if (key === lastSent.current) return;
    lastSent.current = key;
    onChange(built, valid);
  }, [built, valid]);

  const patch = (key: string, p: Partial<DraftCheck>) => setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const add = () =>
    setDrafts((prev) => [...prev, { key: `${Date.now()}`, id: nextId(prev), question: "", type: "yesno", optionsText: "", dtype: "string", extra: {} }]);
  const remove = (key: string) => setDrafts((prev) => prev.filter((d) => d.key !== key));

  const pickImage = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError("Use a PNG, JPEG or WebP screenshot");
    if (file.size > MAX_IMAGE_BYTES) return setError("Screenshots must be under 8 MB");
    setImage({ name: file.name, url: await readAsDataUrl(file) });
  };

  const runTry = async () => {
    setTrying(true);
    setError(null);
    try {
      const res = await tryChecks({
        checks: built,
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(image ? { image: image.url } : {}),
        ...(context?.trim() ? { context: context.trim() } : {}),
      });
      setResult({ checks: built, res, text: text.trim(), ...(image ? { image: image.url } : {}) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try failed");
    } finally {
      setTrying(false);
    }
  };

  const saveSample = () => {
    if (!result || (!result.text && !result.image)) return;
    const expected: Record<string, CheckValue> = {};
    for (const c of result.checks) {
      const a = result.res.answers[c.id];
      if (a && a.value !== null && !a.unsure) expected[c.id] = a.value;
    }
    onSamplesChange([...samples, { input: result.text, ...(result.image ? { image: result.image } : {}), expected }].slice(0, MAX_SAMPLES));
  };

  const unsure = result ? result.checks.filter((c) => result.res.answers[c.id]?.unsure) : [];
  const confident = result ? result.checks.length - unsure.length : 0;

  return (
    <div className="space-y-6" data-id="checks-editor">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[13px] font-medium text-xyne-fg-primary">Checks ({drafts.length}/{MAX_CHECKS})</h3>
            <p className="text-[12px] text-xyne-fg-muted">
              Questions this subagent asks about every item, answered by xor in parallel with a confidence score.
            </p>
          </div>
          {canEdit && (
            <Button size="sm" onClick={add} disabled={drafts.length >= MAX_CHECKS} leadingIcon={<PlusIcon size={14} />}>
              Add check
            </Button>
          )}
        </div>

        {drafts.length === 0 && (
          <p className="rounded-xl border border-dashed border-xyne-border p-4 text-[13px] text-xyne-fg-muted">
            No checks yet. Example: “Is this log line a real failure?” (Yes / No) or “Which part failed?” (Pick one: database, network, auth).
          </p>
        )}

        {drafts.map((d, i) => (
          <div key={d.key} className="space-y-2 rounded-xl border border-xyne-border bg-xyne-surface p-3" data-id="check-card">
            <div className="flex items-start gap-2">
              <input
                value={d.question}
                disabled={!canEdit}
                onChange={(e) => patch(d.key, { question: e.target.value })}
                placeholder="Ask one plain question, e.g. Is this a real failure?"
                className="flex-1 rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-3 py-1.5 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none"
              />
              <div className="w-44">
                <SelectField
                  value={d.type}
                  disabled={!canEdit}
                  options={TYPE_OPTIONS}
                  onValueChange={(v) => v && patch(d.key, { type: v as SubagentCheckType })}
                />
              </div>
              {canEdit && (
                <button type="button" onClick={() => remove(d.key)} aria-label="Remove check" className="mt-1.5 text-xyne-fg-muted hover:text-xyne-error-fg">
                  <TrashIcon size={16} />
                </button>
              )}
            </div>
            {(d.type === "choice" || d.type === "score") && (
              <textarea
                value={d.optionsText}
                disabled={!canEdit}
                rows={3}
                onChange={(e) => patch(d.key, { optionsText: e.target.value })}
                placeholder={d.type === "choice" ? "One option per line, e.g.\ndb: database error\nnetwork: timeout or DNS\nauth: expired token" : "One level per line, lowest first, e.g.\nlow\nmedium\nhigh"}
                className="w-full rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-3 py-1.5 font-mono text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none"
              />
            )}
            {d.type === "value" && (
              <div className="w-48">
                <SelectField
                  value={d.dtype}
                  disabled={!canEdit}
                  options={DTYPE_OPTIONS}
                  onValueChange={(v) => v && patch(d.key, { dtype: v as DraftCheck["dtype"] })}
                />
              </div>
            )}
            <div className="flex items-center gap-2 text-[11px] text-xyne-fg-muted">
              <span>id</span>
              <input
                value={d.id}
                disabled={!canEdit}
                onChange={(e) => patch(d.key, { id: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") })}
                className="w-36 rounded border border-xyne-border bg-xyne-surface px-1.5 py-0.5 font-mono text-[11px] text-xyne-fg-secondary focus:outline-none"
              />
              {problems[i] && <span className="text-xyne-error-fg">{problems[i]}</span>}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-xl border border-xyne-border bg-xyne-surface-sunken/40 p-4" data-id="checks-try">
        <div>
          <h3 className="text-[13px] font-medium text-xyne-fg-primary">Try it</h3>
          <p className="text-[12px] text-xyne-fg-muted">Paste a real example or add a screenshot and see how xor answers each check.</p>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="e.g. 2026-10-21T10:02:11Z ERROR [claw] prisma: connection refused to postgres:5432"
          className="w-full rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-3 py-2 font-mono text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pickImage(e.target.files?.[0])} />
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} leadingIcon={<ImageIcon size={14} />}>
            {image ? "Change screenshot" : "Add screenshot"}
          </Button>
          {image && (
            <span className="flex items-center gap-1 rounded-full border border-xyne-border px-2 py-0.5 text-[12px] text-xyne-fg-secondary">
              {image.name}
              <button type="button" aria-label="Remove screenshot" onClick={() => setImage(null)}>
                <XIcon size={12} />
              </button>
            </span>
          )}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="primary"
            onClick={() => void runTry()}
            disabled={trying || drafts.length === 0 || !valid || (!text.trim() && !image)}
            leadingIcon={trying ? <CircleDashedIcon size={14} className="animate-spin" /> : undefined}
          >
            {trying ? "Asking xor…" : "Try"}
          </Button>
        </div>
        {drafts.length > 0 && !valid && <p className="text-[12px] text-xyne-fg-muted">Fix the checks above to try them.</p>}
        {error && <p className="text-[12px] text-xyne-error-fg">{error}</p>}

        {result && (
          <div className="space-y-2" data-id="checks-try-result">
            {result.res.unavailable ? (
              <p className="flex items-center gap-1.5 rounded-lg border border-xyne-border-error p-2 text-[12px] text-xyne-error-fg">
                <WarningIcon size={14} /> xor did not answer. Try again in a moment.
              </p>
            ) : (
              <>
                {unsure.length > 0 && (
                  <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/60 bg-amber-50 p-2 text-[12px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" data-id="checks-low-confidence">
                    <WarningIcon size={14} className="mt-0.5 shrink-0" />
                    Low confidence on {unsure.map((c) => c.id).join(", ")}. The subagent will report these as unsure. Make the question more specific, or give clearer options.
                  </p>
                )}
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-xyne-fg-muted">
                      <th className="py-1 font-medium">Check</th>
                      <th className="py-1 font-medium">Answer</th>
                      <th className="py-1 font-medium">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.checks.map((c) => {
                      const a: CheckAnswer | undefined = result.res.answers[c.id];
                      const pct = a?.confidence !== null && a?.confidence !== undefined ? Math.round(a.confidence * 100) : null;
                      return (
                        <tr key={c.id} className="border-t border-xyne-border">
                          <td className="py-1.5 pr-2 text-xyne-fg-secondary">{c.question}</td>
                          <td className="py-1.5 pr-2 font-medium text-xyne-fg-primary">{a ? fmt(a.value) : "—"}</td>
                          <td className="py-1.5">
                            {pct === null ? (
                              <span className="text-xyne-fg-muted">—</span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-xyne-surface-subtle">
                                  <span className={`block h-full ${a?.unsure ? "bg-amber-500" : "bg-xyne-success-fg"}`} style={{ width: `${pct}%` }} />
                                </span>
                                <span className={a?.unsure ? "text-amber-700 dark:text-amber-300" : "text-xyne-fg-secondary"}>{pct}%</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex items-center justify-between text-[11px] text-xyne-fg-muted">
                  <span>{result.res.ms} ms</span>
                  {canEdit && (
                    <Button size="sm" onClick={saveSample} disabled={(!result.text && !result.image) || confident === 0 || samples.length >= MAX_SAMPLES}>
                      {unsure.length > 0
                          ? `Save as sample (${confident} confident answer${confident === 1 ? "" : "s"}, unsure ones left out)`
                          : "Save as sample"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2" data-id="checks-samples">
        <h3 className="text-[13px] font-medium text-xyne-fg-primary">Samples ({samples.length})</h3>
        <p className="text-[12px] text-xyne-fg-muted">Saved examples with the answers you expect. They become this subagent's test set.</p>
        {samples.map((s, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg border border-xyne-border bg-xyne-surface p-2 text-[12px]">
            {s.image && <img src={s.image} alt="" className="h-10 w-16 shrink-0 rounded border border-xyne-border object-cover object-top" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xyne-fg-secondary">{s.input || s.label || "Screenshot"}</p>
              <p className="mt-0.5 text-xyne-fg-muted">
                {Object.entries(s.expected).map(([k, v]) => `${k}: ${fmt(v)}`).join(" · ") || "no expected answers"}
              </p>
            </div>
            {canEdit && (
              <button type="button" aria-label="Remove sample" onClick={() => onSamplesChange(samples.filter((_, j) => j !== i))} className="text-xyne-fg-muted hover:text-xyne-error-fg">
                <TrashIcon size={14} />
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
