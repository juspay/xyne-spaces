import { useState } from "react";
import { ChartBarIcon, CircleDashedIcon, WarningIcon } from "@phosphor-icons/react";
import { runSubagentEvals } from "../../../lib/api";
import type { EvalStats, SubagentEvalReport } from "../../../lib/api";
import { Button } from "../ui/Button";

const MODEL_RE = /^[a-zA-Z0-9._:/-]{1,100}$/;

function Cell({ s }: { s: EvalStats | undefined }) {
  if (!s) return <span className="text-xyne-fg-muted">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className={s.accuracy >= 90 ? "text-xyne-success-fg" : s.accuracy >= 70 ? "text-xyne-fg-primary" : "text-xyne-error-fg"}>{s.accuracy}%</span>
      <span className="text-xyne-fg-muted"> · {s.unsureRate}% unsure</span>
      {s.confidentWrong > 0 && <span className="text-xyne-error-fg"> · {s.confidentWrong} wrong</span>}
    </span>
  );
}

interface ChecksEvalPanelProps {
  subagentName: string;
  canEdit: boolean;
  sampleCount: number;
  dirty: boolean;
  checksVersion: number | undefined;
  report: SubagentEvalReport | null | undefined;
  onReport: (r: SubagentEvalReport) => void;
}

export function ChecksEvalPanel({ subagentName, canEdit, sampleCount, dirty, checksVersion, report, onReport }: ChecksEvalPanelProps) {
  const [compare, setCompare] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = compare.split(",").map((m) => m.trim()).filter(Boolean);
  const badModel = candidates.find((m) => !MODEL_RE.test(m));

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      onReport(await runSubagentEvals(subagentName, candidates.length > 0 ? { compare: candidates.slice(0, 3) } : {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eval failed");
    } finally {
      setRunning(false);
    }
  };

  const models = report?.report.models ?? [];
  const first = models[0];
  const rows = first?.checks.filter((c) => !c.id.includes("/")) ?? [];
  const regressions = report?.regressions.flatMap((r) => r.regressions.map((g) => ({ model: r.model, ...g }))) ?? [];
  const stale = report && checksVersion !== undefined && report.checksVersion !== checksVersion;

  return (
    <section className="space-y-3 rounded-xl border border-xyne-border bg-xyne-surface p-4" data-id="checks-eval">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-xyne-fg-primary">
            <ChartBarIcon size={14} /> Evals
          </h3>
          <p className="text-[12px] text-xyne-fg-muted">
            Score every check on the saved samples. Add a model to compare it with the current one before switching.
          </p>
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={compare}
            onChange={(e) => setCompare(e.target.value)}
            placeholder="Compare with model, e.g. xor-omni-next (optional)"
            className="min-w-[260px] flex-1 rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-3 py-1.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none"
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => void run()}
            disabled={running || sampleCount === 0 || dirty || Boolean(badModel)}
            leadingIcon={running ? <CircleDashedIcon size={14} className="animate-spin" /> : undefined}
          >
            {running ? "Running…" : "Run evals"}
          </Button>
        </div>
      )}
      {sampleCount === 0 && <p className="text-[12px] text-xyne-fg-muted">Save a few samples from Try it first. They are the eval set.</p>}
      {dirty && sampleCount > 0 && <p className="text-[12px] text-xyne-fg-muted">Save your changes first. Evals run on the saved checks and samples.</p>}
      {badModel && <p className="text-[12px] text-xyne-error-fg">“{badModel}” is not a valid model id.</p>}
      {error && <p className="text-[12px] text-xyne-error-fg">{error}</p>}

      {first && report && (
        <div className="space-y-2" data-id="checks-eval-report">
          {stale && <p className="text-[12px] text-amber-700 dark:text-amber-300">These results are from an older version of the checks. Run evals again.</p>}
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-xyne-fg-muted">
                <th className="py-1 font-medium">Check</th>
                {models.map((m) => (
                  <th key={m.model} className="py-1 font-medium">
                    {m.model} <span className="font-normal">({m.meanMs} ms)</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-xyne-border font-medium">
                <td className="py-1.5 pr-2 text-xyne-fg-primary">All checks</td>
                {models.map((m) => (
                  <td key={m.model} className="py-1.5 pr-2"><Cell s={m.overall} /></td>
                ))}
              </tr>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-xyne-border">
                  <td className="py-1.5 pr-2 text-xyne-fg-secondary">{c.variantOf ? "↳ " : ""}{c.question}</td>
                  {models.map((m) => (
                    <td key={m.model} className="py-1.5 pr-2"><Cell s={m.checks.find((x) => x.id === c.id)} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {regressions.length > 0 && (
            <div className="rounded-lg border border-xyne-border-error p-2 text-[12px] text-xyne-error-fg" data-id="checks-eval-regressions">
              <p className="flex items-center gap-1.5 font-medium"><WarningIcon size={14} /> Worse on {[...new Set(regressions.map((r) => r.model))].join(", ")}</p>
              <ul className="mt-1 list-disc pl-5">
                {regressions.map((r) => (
                  <li key={`${r.model}-${r.id}`}>
                    {r.question}: {r.from}% → {r.to}%{r.confidentWrongTo > r.confidentWrongFrom ? `, confident-wrong ${r.confidentWrongFrom} → ${r.confidentWrongTo}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-xyne-fg-muted">
            {report.report.samples} samples · {new Date(report.report.ranAt).toLocaleString()} · % = confident and right. Wrong = confident and wrong, the dangerous kind.
          </p>
        </div>
      )}
    </section>
  );
}
