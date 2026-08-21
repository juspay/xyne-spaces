/**
 * OnyxEvalsPageV3 — EnterpriseRAG-Bench harness UI.
 *
 * Separate section inside Evals (CLAW_ADMIN-only, like the existing Evals
 * page) for the paper-strict eval: the operator uploads the benchmark's
 * questions.jsonl + dsid_mapping.json (parsed fully in the browser — the
 * corpus itself already lives in the eval Vespa; nothing is bundled into any
 * deployment), configures the run, and watches progress/aggregates here.
 *
 * The flow (paper §5): claw-auth queries the eval Vespa directly with each
 * question (top-K), then calls xyne-claw's /eval-onyx judges per question and
 * scores correctness / completeness / Recall@10 / invalid-extra-docs locally.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloudArrowUpIcon,
  PlayIcon,
  StopIcon,
  ArrowClockwiseIcon,
  CheckCircleIcon,
  XCircleIcon,
  ScalesIcon,
  ChartBarIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Dialog } from "./ui/Dialog";
import { PageHeader } from "./ui/PageHeader";
import { useSnackbar } from "./ui/Snackbar";
import {
  startOnyxEvalRun,
  stopOnyxEvalRun,
  resumeOnyxEvalRun,
  listOnyxEvalRuns,
  getOnyxEvalRun,
  getOnyxEvalRunQuestions,
  getOnyxEvalRunQuestion,
  type OnyxAggregate,
  type OnyxDsidEntry,
  type OnyxQuestionDetail,
  type OnyxQuestionRow,
  type OnyxRunDetail,
  type OnyxRunQuestionInput,
  type OnyxRunSummary,
} from "../../lib/api";

const POLL_MS = 3_000;
const STATUS_BADGE: Record<string, { color: "success" | "warning" | "error" | "neutral"; label: string }> = {
  completed: { color: "success", label: "Completed" },
  running: { color: "warning", label: "Running" },
  failed: { color: "error", label: "Failed" },
  stopped: { color: "neutral", label: "Stopped" },
};

function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v.toFixed(1)}%`;
}

// ─── Browser-side dataset parsing ───────────────────────────────────────────

async function parseQuestionsFile(file: File): Promise<OnyxRunQuestionInput[]> {
  const text = await file.text();
  const out: OnyxRunQuestionInput[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const d = JSON.parse(line) as Record<string, unknown>;
    if (typeof d["question_id"] !== "string" || typeof d["question"] !== "string") continue;
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    out.push({
      questionId: d["question_id"],
      questionType: typeof d["question_type"] === "string" ? d["question_type"] : "unknown",
      sourceTypes: arr(d["source_types"]),
      question: d["question"],
      expectedDocIds: arr(d["expected_doc_ids"]),
      goldAnswer: typeof d["gold_answer"] === "string" ? d["gold_answer"] : "",
      answerFacts: arr(d["answer_facts"]),
    });
  }
  return out;
}

/** The full mapping is ~50MB — extract ONLY the entries the posted questions
 *  reference (measured on the paper's 500-row file: a UNION of 722 distinct
 *  gold dsids, per-question range 0–10 — out of ~512k keys total). */
async function extractNeededMapping(file: File, neededDsids: Set<string>): Promise<Record<string, OnyxDsidEntry[]>> {
  const raw = JSON.parse(await file.text()) as Record<string, Record<string, string>>;
  const out: Record<string, OnyxDsidEntry[]> = {};
  for (const dsid of neededDsids) {
    const inner = raw[dsid];
    if (inner) out[dsid] = Object.entries(inner).map(([sourceType, syntheticId]) => ({ sourceType, syntheticId }));
  }
  return out;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function OnyxEvalsPageV3({ userId }: { userId: string }) {
  const { show: showSnackbar } = useSnackbar();

  // Upload state
  const [questions, setQuestions] = useState<OnyxRunQuestionInput[] | null>(null);
  const [questionsName, setQuestionsName] = useState<string>("");
  const [mapping, setMapping] = useState<Record<string, OnyxDsidEntry[]> | null>(null);
  const [mappingName, setMappingName] = useState<string>("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const questionsInputRef = useRef<HTMLInputElement>(null);
  const mappingInputRef = useRef<HTMLInputElement>(null);

  // Config state
  const [topK, setTopK] = useState(10);
  /** Sub-set of the parsed rows the run uses — defaults to ALL parsed rows. */
  const [maxQuestions, setMaxQuestions] = useState(0);
  const [rankProfile, setRankProfile] = useState("default_native");
  const [concurrency, setConcurrency] = useState(2);
  const [threeJudge, setThreeJudge] = useState(true);
  const [model, setModel] = useState("");
  const [starting, setStarting] = useState(false);

  // Runs state
  const [runs, setRuns] = useState<OnyxRunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<OnyxRunDetail | null>(null);

  // Questions table state
  const [qPage, setQPage] = useState(0);
  const [qType, setQType] = useState("");
  const [qRows, setQRows] = useState<{ total: number; questions: OnyxQuestionRow[] } | null>(null);
  const [detail, setDetail] = useState<OnyxQuestionDetail | null>(null);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await listOnyxEvalRuns(30, userId));
    } catch {
      /* network blip — next poll fixes it */
    }
  }, [userId]);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  // Poll while any listed run is active — keeps the table + counters honest.
  const hasActive = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => { void refreshRuns(); }, POLL_MS);
    return () => clearInterval(t);
  }, [hasActive, refreshRuns]);

  // Selected run detail: poll while it's running, refresh once when done.
  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const detail = await getOnyxEvalRun(selectedId, userId);
        if (!cancelled) setSelected(detail);
      } catch {
        /* row may have been deleted server-side */
      }
    };
    void load();
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [selectedId, userId]);

  // Questions table refreshes together with the run detail.
  useEffect(() => {
    if (!selectedId) { setQRows(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const rows = await getOnyxEvalRunQuestions(selectedId, { page: qPage, pageSize: 50, ...(qType ? { type: qType } : {}) }, userId);
        if (!cancelled) setQRows(rows);
      } catch {
        /* transient */
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, qPage, qType, userId, selected?.processed]);

  const onPickQuestions = async (file: File) => {
    setUploadError(null);
    try {
      const parsed = await parseQuestionsFile(file);
      if (parsed.length === 0) throw new Error("no valid lines — expected the benchmark's questions.jsonl");
      setQuestions(parsed);
      setMaxQuestions(parsed.length); // default: run the whole parsed set
      setQuestionsName(file.name);
      // Mapping picks up the gold ids referenced by THIS question set.
      if (mappingInputRef.current?.files?.[0]) {
        const mappingFile = mappingInputRef.current.files[0];
        setMapping(await extractNeededMapping(mappingFile, new Set(parsed.flatMap((q) => q.expectedDocIds))));
        setMappingName(mappingFile.name);
      }
    } catch (err) {
      setQuestions(null);
      setUploadError(err instanceof Error ? err.message : "failed to parse questions file");
    }
  };

  const onPickMapping = async (file: File) => {
    setUploadError(null);
    try {
      if (!questions) {
        setUploadError("Pick questions.jsonl first — the mapping is reduced to the gold ids the questions reference.");
        return;
      }
      setMapping(await extractNeededMapping(file, new Set(questions.flatMap((q) => q.expectedDocIds))));
      setMappingName(file.name);
    } catch (err) {
      setMapping(null);
      setUploadError(err instanceof Error ? err.message : "failed to parse mapping file");
    }
  };

  const missing = useMemo(() => {
    if (!questions || !mapping) return 0;
    const ids = new Set(questions.flatMap((q) => q.expectedDocIds));
    return [...ids].filter((d) => !mapping[d]).length;
  }, [questions, mapping]);

  const onStart = async () => {
    if (!questions) {
      showSnackbar({ title: "Upload questions.jsonl first", variant: "error" });
      return;
    }
    setStarting(true);
    try {
      const count = Math.min(Math.max(maxQuestions || questions.length, 1), questions.length);
      const questionsSliced = questions.slice(0, count);
      // ALSO cut the mapping to what the sliced question set actually needs —
      // the default is all-parsed rows, so slicing changes the referenced set.
      const needed = new Set(questionsSliced.flatMap((q) => q.expectedDocIds));
      const mappingSliced = { ...mapping };
      for (const k of Object.keys(mappingSliced)) if (!needed.has(k)) delete mappingSliced[k];
      const { runId } = await startOnyxEvalRun({
        questions: questionsSliced,
        dsidMapping: mappingSliced,
        topK,
        rankProfile: rankProfile.trim(),
        concurrency,
        threeJudgeCorrection: threeJudge,
        ...(model.trim() ? { model: model.trim() } : {}),
      }, userId);
      showSnackbar({ title: `Run started (${questionsSliced.length} questions)`, variant: "success" });
      setSelectedId(runId);
      await refreshRuns();
    } catch (err) {
      showSnackbar({ title: "Failed to start run", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setStarting(false);
    }
  };

  const onStop = async (runId: string) => {
    try {
      await stopOnyxEvalRun(runId, userId);
      showSnackbar({ title: "Stop requested", variant: "success" });
      await refreshRuns();
    } catch (err) {
      showSnackbar({ title: "Stop failed", description: err instanceof Error ? err.message : undefined, variant: "error" });
    }
  };

  const onResume = async (runId: string) => {
    try {
      await resumeOnyxEvalRun(runId, userId);
      showSnackbar({ title: "Run resumed", variant: "success" });
      await refreshRuns();
    } catch (err) {
      showSnackbar({ title: "Resume failed", description: err instanceof Error ? err.message : undefined, variant: "error" });
    }
  };

  const agg: OnyxAggregate | null = selected?.aggregate ?? null;
  const qTypes = useMemo(
    () => [...new Set((qRows?.questions ?? []).map((q) => q.questionType))].sort(),
    [qRows],
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Onyx Evals"
        description="EnterpriseRAG-Bench over the eval Vespa — paper §5.1 metrics + §5.3 3-judge gold-set correction. Judges run on xyne-claw (/eval-onyx), retrieval is direct to the eval cluster."
        icon={<ScalesIcon size={22} />}
        actions={
          <Button
            variant="secondary"
            size="md"
            leadingIcon={<ArrowClockwiseIcon size={14} />}
            onClick={() => { void resumeOnyxEvalRun(undefined, userId).then((r) => { showSnackbar({ title: `Resumed ${r.runId.slice(0, 8)}`, variant: "success" }); setSelectedId(r.runId); void refreshRuns(); }).catch((err) => showSnackbar({ title: "Nothing to resume", description: err instanceof Error ? err.message : undefined, variant: "error" })); }}
          >
            Resume latest
          </Button>
        }
      />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* ── Upload + config card ─────────────────────────────────── */}
        <div className="rounded-xl border border-xyne-border-subtle bg-xyne-surface p-4">
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex flex-col gap-2">
              <div className="text-[13px] font-semibold text-xyne-fg-primary">Benchmark inputs</div>
              <div className="flex items-center gap-2">
                <input
                  ref={questionsInputRef}
                  type="file"
                  accept=".jsonl,application/x-ndjson"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickQuestions(f); e.target.value = ""; }}
                />
                <Button
                  variant="secondary" size="sm" leadingIcon={<CloudArrowUpIcon size={14} />}
                  onClick={() => questionsInputRef.current?.click()}
                >
                  questions.jsonl
                </Button>
                {questionsName && <span className="text-xs text-xyne-fg-muted">{questionsName} · {questions?.length ?? 0} questions</span>}
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={mappingInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickMapping(f); e.target.value = ""; }}
                />
                <Button
                  variant="secondary" size="sm" leadingIcon={<CloudArrowUpIcon size={14} />}
                  onClick={() => mappingInputRef.current?.click()}
                >
                  dsid_mapping.json
                </Button>
                {mappingName && <span className="text-xs text-xyne-fg-muted">{mappingName} · {Object.keys(mapping ?? {}).length} gold entries</span>}
                {missing > 0 && <span className="text-xs text-xyne-error">{missing} gold ids unmapped</span>}
              </div>
              {uploadError && <div className="text-xs text-xyne-error">{uploadError}</div>}
              <div className="max-w-md text-xs text-xyne-fg-muted">
                Files are parsed in your browser: only the mapping entries the questions actually need are
                posted with the run. The corpus already lives in the eval Vespa — nothing is bundled anywhere.
              </div>
            </div>

            <div className="flex flex-1 flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-xyne-fg-muted">
                Rank profile
                <input
                  className="h-8 rounded-md border border-xyne-border bg-xyne-surface px-2 text-[13px] text-xyne-fg-primary"
                  value={rankProfile}
                  onChange={(e) => setRankProfile(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-xyne-fg-muted">
                topK
                <input
                  className="h-8 w-20 rounded-md border border-xyne-border bg-xyne-surface px-2 text-[13px] text-xyne-fg-primary"
                  type="number" min={1} max={25}
                  value={topK}
                  onChange={(e) => setTopK(Math.min(Math.max(Number(e.target.value) || 20, 1), 25))}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-xyne-fg-muted">
                Concurrency
                <input
                  className="h-8 w-20 rounded-md border border-xyne-border bg-xyne-surface px-2 text-[13px] text-xyne-fg-primary"
                  type="number" min={1} max={4}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Math.min(Math.max(Number(e.target.value) || 2, 1), 4))}
                />
              </label>
              {questions && (
                <label className="flex flex-col gap-1 text-xs text-xyne-fg-muted">
                  Max questions <span className="text-xyne-fg-faint">(of {questions.length} parsed)</span>
                  <input
                    className="h-8 w-24 rounded-md border border-xyne-border bg-xyne-surface px-2 text-[13px] text-xyne-fg-primary"
                    type="number" min={1} max={questions.length}
                    value={maxQuestions}
                    onChange={(e) => setMaxQuestions(Math.min(Math.max(Number(e.target.value) || questions.length, 1), questions.length))}
                  />
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs text-xyne-fg-muted">
                Judge model (blank = claw default)
                <input
                  className="h-8 rounded-md border border-xyne-border bg-xyne-surface px-2 text-[13px] text-xyne-fg-primary"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="litellm model name"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-xyne-fg-muted">
                <input type="checkbox" checked={threeJudge} onChange={(e) => setThreeJudge(e.target.checked)} />
                3-judge gold-set correction (§5.3)
              </label>
              <Button
                variant="primary" size="md" leadingIcon={<PlayIcon size={14} />}
                disabled={!questions || starting}
                onClick={() => { void onStart(); }}
              >
                {starting ? "Starting…" : "Run benchmark"}
              </Button>
            </div>
          </div>
        </div>

        {/* ── Runs table ───────────────────────────────────────────── */}
        <div className="rounded-xl border border-xyne-border-subtle bg-xyne-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[13px] font-semibold text-xyne-fg-primary">Runs</div>
            <div className="text-xs text-xyne-fg-muted">Leaderboard = avg(completeness if correct else 0)</div>
          </div>
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-xyne-border-subtle text-xyne-fg-muted">
                <th className="py-1.5 pr-3">Run</th>
                <th className="py-1.5 pr-3">Status</th>
                <th className="py-1.5 pr-3">Progress</th>
                <th className="py-1.5 pr-3">Leaderboard</th>
                <th className="py-1.5 pr-3">Corrections</th>
                <th className="py-1.5 pr-3">Started</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr><td colSpan={7} className="py-4 text-center text-xyne-fg-muted">No runs yet — upload the benchmark inputs and start one.</td></tr>
              )}
              {runs.map((r) => {
                const badge = STATUS_BADGE[r.status] ?? { color: "neutral" as const, label: r.status };
                const isSel = r.id === selectedId;
                return (
                  <tr
                    key={r.id}
                    className={`cursor-pointer border-b border-xyne-border-subtle last:border-0 hover:bg-xyne-surface-subtle ${isSel ? "bg-xyne-surface-subtle" : ""}`}
                    onClick={() => { setSelectedId(isSel ? null : r.id); setQPage(0); setQType(""); }}
                  >
                    <td className="py-1.5 pr-3 font-mono text-[11px]">{r.id.slice(0, 8)}</td>
                    <td className="py-1.5 pr-3"><Badge label={badge.label} variant={badge.color} size="sm" /></td>
                    <td className="py-1.5 pr-3">{r.processed}/{r.totalQuestions}</td>
                    <td className="py-1.5 pr-3 font-semibold">{r.aggregate ? r.aggregate.leaderboardScore.toFixed(1) : "—"}</td>
                    <td className="py-1.5 pr-3">{r.corrections}</td>
                    <td className="py-1.5 pr-3 text-xyne-fg-muted">{new Date(r.startedAt).toLocaleString()}</td>
                    <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        {r.status === "running" && (
                          <Button variant="ghost" size="sm" onClick={() => { void onStop(r.id); }} leadingIcon={<StopIcon size={12} />}>Stop</Button>
                        )}
                        {(r.status === "failed" || r.status === "stopped") && (
                          <Button variant="ghost" size="sm" onClick={() => { void onResume(r.id); }} leadingIcon={<ArrowClockwiseIcon size={12} />}>Resume</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Selected run detail ─────────────────────────────────── */}
        {selected && (
          <div className="rounded-xl border border-xyne-border-subtle bg-xyne-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <ChartBarIcon size={16} className="text-xyne-fg-muted" />
              <span className="text-[13px] font-semibold text-xyne-fg-primary">
                Run <span className="font-mono text-[11px]">{selected.id.slice(0, 8)}</span> — paper §5.1 aggregate
              </span>
              {selected.status === "running" && <Badge label={`${selected.processed}/${selected.totalQuestions}`} variant="warning" size="sm" />}
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <AggCard label="Leaderboard score" value={agg ? agg.leaderboardScore.toFixed(1) : "—"} strong />
              <AggCard label="Correctness" value={fmtPct(agg?.correctnessPercent)} />
              <AggCard label="Completeness" value={fmtPct(agg?.completenessPercent)} />
              <AggCard label="Doc Recall@10" value={fmtPct(agg?.documentRecallPercent)} />
              <AggCard label="Invalid extra docs (avg)" value={agg ? agg.invalidExtraDocsAvg.toFixed(2) : "—"} />
            </div>

            <div className="mb-2 flex items-center gap-2">
              <span className="text-[13px] font-semibold text-xyne-fg-primary">Questions</span>
              <select
                className="h-7 rounded-md border border-xyne-border bg-xyne-surface px-2 text-[12px]"
                value={qType}
                onChange={(e) => { setQType(e.target.value); setQPage(0); }}
              >
                <option value="">All types</option>
                {qTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="text-xs text-xyne-fg-muted">{qRows ? `${qRows.total} rows` : ""}</span>
            </div>

            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-xyne-border-subtle text-xyne-fg-muted">
                  <th className="py-1.5 pr-3">#</th>
                  <th className="py-1.5 pr-3">Type</th>
                  <th className="py-1.5 pr-3">Question</th>
                  <th className="py-1.5 pr-3">Correct</th>
                  <th className="py-1.5 pr-3">Compl.</th>
                  <th className="py-1.5 pr-3">Recall</th>
                  <th className="py-1.5 pr-3">Extra</th>
                  <th className="py-1.5 pr-3">Δ gold</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {(qRows?.questions ?? []).map((q) => (
                  <tr
                    key={q.questionId}
                    className="cursor-pointer border-b border-xyne-border-subtle last:border-0 hover:bg-xyne-surface-subtle"
                    onClick={() => { void getOnyxEvalRunQuestion(selected.id, q.questionId, userId).then(setDetail).catch(() => {}); }}
                  >
                    <td className="py-1.5 pr-3 font-mono text-[11px]">{q.questionId.replace("qst_", "")}</td>
                    <td className="py-1.5 pr-3">{q.questionType}</td>
                    <td className="max-w-[320px] truncate py-1.5 pr-3 text-xyne-fg-primary" title={q.question}>{q.question}</td>
                    <td className="py-1.5 pr-3">
                      {q.error
                        ? <Badge label="error" variant="error" size="sm" />
                        : q.correctness === 1 ? <CheckCircleIcon size={14} className="text-[#22a06b]" />
                        : <XCircleIcon size={14} className="text-xyne-error" />}
                    </td>
                    <td className="py-1.5 pr-3">{q.completeness === null ? "—" : `${Math.round(q.completeness * 100)}%`}</td>
                    <td className="py-1.5 pr-3">{q.documentRecall === null ? "—" : `${Math.round(q.documentRecall * 100)}%`}</td>
                    <td className="py-1.5 pr-3">{q.invalidExtra ?? "—"}</td>
                    <td className="py-1.5 pr-3">{q.corrected ? <Badge label="corrected" variant="warning" size="sm" /> : ""}</td>
                    <td className="py-1.5">
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => { void getOnyxEvalRunQuestion(selected.id, q.questionId, userId).then(setDetail).catch(() => {}); }}
                      >
                        Expand
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={qPage === 0} onClick={() => setQPage((p) => p - 1)}>Prev</Button>
              <span className="text-xs text-xyne-fg-muted">Page {qPage + 1}</span>
              <Button variant="ghost" size="sm" disabled={(qRows?.questions.length ?? 0) < 50} onClick={() => setQPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Question detail dialog ─────────────────────────────────── */}
      {detail && (
        <Dialog open onOpenChange={(open) => { if (!open) setDetail(null); }} title={`${detail.questionId} · ${detail.questionType}`}>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto text-[12px]">
            {detail.error && <div className="rounded-md bg-xyne-surface-subtle p-2 text-xyne-error">error: {detail.error}</div>}
            <div>
              <div className="mb-0.5 font-semibold text-xyne-fg-muted">Question</div>
              <div className="text-xyne-fg-primary">{detail.question}</div>
            </div>
            <div>
              <div className="mb-0.5 font-semibold text-xyne-fg-muted">Judged answer (citations stripped)</div>
              <div className="whitespace-pre-wrap rounded-md bg-xyne-surface-subtle p-2 text-xyne-fg-primary">{detail.answerText ?? "—"}</div>
            </div>
            <div className="flex gap-6">
              <div><span className="font-semibold text-xyne-fg-muted">Correctness: </span>{detail.correctness ?? "—"}</div>
              <div><span className="font-semibold text-xyne-fg-muted">Completeness: </span>{detail.completeness === null ? "—" : `${Math.round(detail.completeness * 100)}%`}</div>
              <div><span className="font-semibold text-xyne-fg-muted">Recall: </span>{detail.documentRecall === null ? "—" : `${Math.round(detail.documentRecall * 100)}%`}</div>
            </div>
            {detail.correctnessReasoning && <div className="text-xyne-fg-muted">Judge: {detail.correctnessReasoning}</div>}
            {detail.rawAnswer && detail.rawAnswer !== detail.answerText && (
              <div>
                <div className="mb-0.5 font-semibold text-xyne-fg-muted">Raw answer (verbatim)</div>
                <div className="whitespace-pre-wrap rounded-md bg-xyne-surface-subtle p-2 font-mono text-[11px] text-xyne-fg-primary">{detail.rawAnswer}</div>
              </div>
            )}
            {detail.citedDocIds.length > 0 && (
              <div className="text-xyne-fg-primary">
                <span className="font-semibold text-xyne-fg-muted">Cited doc ids:</span> <span className="font-mono">{detail.citedDocIds.join(", ")}</span>
              </div>
            )}
            {detail.validDocIds.length > 0 && (
              <div className="text-xyne-fg-primary">
                <span className="font-semibold text-xyne-fg-muted">Valid extras (beyond required):</span> <span className="font-mono">{detail.validDocIds.join(", ")}</span>
              </div>
            )}
            {detail.goldAnswer && (
              <div>
                <div className="mb-0.5 font-semibold text-xyne-fg-muted">Gold answer (effective)</div>
                <div className="whitespace-pre-wrap rounded-md bg-xyne-surface-subtle p-2 text-xyne-fg-primary">{detail.goldAnswer}</div>
              </div>
            )}
            {Object.keys(detail.dsidToSynthetic).length > 0 && (
              <div>
                <div className="mb-0.5 font-semibold text-xyne-fg-muted">dsid → synthetic</div>
                <div className="max-h-36 space-y-0.5 overflow-y-auto rounded-md bg-xyne-surface-subtle p-2">
                  {Object.entries(detail.dsidToSynthetic).map(([dsid, s]) => (
                    <div key={dsid} className="font-mono text-[11px]">
                      <span className="text-xyne-fg-muted">{dsid}</span> → <span>{s.docId ?? "(no synthetic)"}</span>
                      {s.sourceType && <span className="ml-2 text-xyne-fg-muted">[{s.sourceType}]</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detail.answerFacts.length > 0 && (
              <div>
                <div className="mb-0.5 font-semibold text-xyne-fg-muted">Answer facts (supported ✓)</div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {detail.answerFacts.map((f, i) => (
                    <li key={i} className={detail.factSupported[i] ? "text-[#22a06b]" : "text-xyne-error"}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {(detail.goldDocIdsOriginal.length > 0 || detail.goldDocIdsCorrected.length > 0) && (
              <div className="text-xyne-fg-primary">
                <span className="font-semibold text-xyne-fg-muted">Gold:</span> {detail.goldDocIdsOriginal.join(", ") || "—"}
                {detail.goldDocIdsCorrected.length > 0 && (
                  <> → <span className="text-[#22a06b]">{detail.goldDocIdsCorrected.join(", ")}</span></>
                )}
              </div>
            )}
            {detail.goldVotes && (
              <div>
                <div className="mb-0.5 font-semibold text-xyne-fg-muted">3-judge votes</div>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-xyne-surface-subtle p-2">
                  {Object.entries(detail.goldVotes).map(([id, g]) => (
                    <div key={id} className="font-mono text-[11px]">
                      {id}: <b>{g.label}</b> [{g.votes.map((v) => v.label.slice(0, 3)).join("/")}]
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detail.retrieved.length > 0 && (
              <div>
                <div className="mb-0.5 font-semibold text-xyne-fg-muted">Retrieved ({detail.retrieved.length})</div>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md bg-xyne-surface-subtle p-2">
                  {detail.retrieved.map((d) => (
                    <div key={d.docId} className="text-[11px]">
                      <span className="font-mono text-xyne-fg-muted">{d.rank}.</span> {d.title}
                      <span className="ml-2 font-mono text-xyne-fg-muted">{d.docId}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Button
                variant="secondary" size="sm" leadingIcon={<DownloadSimpleIcon size={12} />}
                onClick={() => {
                  const blob = new Blob([JSON.stringify(detail, null, 2)], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${detail.questionId}.json`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                Export row
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function AggCard({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle p-3">
      <div className="text-[11px] text-xyne-fg-muted">{label}</div>
      <div className={`mt-0.5 ${strong ? "text-xl" : "text-lg"} font-semibold text-xyne-fg-primary`}>{value}</div>
    </div>
  );
}
