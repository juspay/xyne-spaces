/**
 * EvalsPageV3 — evaluate an agent against stored conversations.
 *
 * One navigation panel (an expandable folder tree; folders open to reveal their
 * conversations inline) + a detail pane. Each folder row has an Import action
 * (future automated ingestion) and a + action (manual import, now).
 *
 * Running an eval replays the selected conversations (or a whole folder) against
 * the chosen agent. The engine lives in the browser: per conversation it calls
 * sendChatMessage() once per turn with a shared `eval-<runId>-<convId>` claw
 * conversationId, streams reasoning/text/tool events in, and persists each turn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FolderIcon,
  FolderOpenIcon,
  CaretDownIcon,
  CaretRightIcon,
  PlusIcon,
  TrashIcon,
  PencilSimpleIcon,
  PlayIcon,
  SpinnerGapIcon,
  CheckCircleIcon,
  XCircleIcon,
  WrenchIcon,
  DownloadSimpleIcon,
  ChatCircleDotsIcon,
  FolderPlusIcon,
  DotsThreeVerticalIcon,
  CheckSquareIcon,
  SquareIcon,
  ScalesIcon,
  ChartBarIcon,
  InfoIcon,
  ArrowUpRightIcon,
  CloudArrowDownIcon,
} from "@phosphor-icons/react";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Dialog } from "./ui/Dialog";
import { SelectField } from "./ui/SelectField";
import {
  listAgents,
  listEvalFolders,
  createEvalFolder,
  deleteEvalFolder,
  listEvalConversations,
  importEvalConversations,
  getEvalConversation,
  deleteEvalConversation,
  getLatestGenerationForFolder,
  parseEvalConversations,
  judgeEvalRun,
  listEvalModels,
  getGeneration,
  importEvalFromSpaces,
  importEvalFromSpacesChannel,
  listEvalSpacesChannels,
  getEvalImportJob,
  cancelEvalImportJob,
  startBackgroundGeneration,
  listEvalGenModels,
  type EvalGenModels,
  getGenerationJob,
  cancelGenerationJob,
  listGenerationsForFolder,
  listEvalJudges,
  createEvalJudge,
  updateEvalJudge,
  deleteEvalJudge,
  getEvalJudgeJob,
  cancelEvalJudgeJob,
  type EvalJudgeProgress,
  type EvalJudge,
  type EvalTurnJudgeScore,
  type GenerationMeta,
  type SpacesChannelOption,
  type EvalImportProgress,
  type GenerationProgress,
  type EvalFolder,
  type EvalConversationListItem,
  type EvalConversation,
  type EvalTurn,
  type EvalGeneration,
  type ToolInvocation,
} from "../../lib/api";
import type { Agent } from "../../lib/types";
import { useBackgroundJob } from "../hooks/useBackgroundJob";

type TurnStatus = "idle" | "running" | "completed" | "failed";

interface LiveTurn {
  answer: string;
  reasoning: string;
  tools: ToolInvocation[];
  status: TurnStatus;
  /** LLM semantic-match score 0-100; null until judged. Reflects the legacy
   *  single judge OR (after remapping) the judge picked in the dropdown. */
  matchScore: number | null;
  judgeReasoning: string;
  /** True when this judge attempted the turn but the call failed (e.g. rate-limited)
   *  — distinct from "never scored". */
  judgeFailed?: boolean;
  /** All judges' scores for this turn — used to remap the view per selected judge. */
  judgeScores: EvalTurnJudgeScore[];
}

/** The score/reasoning to show for a turn given the selected judge view key —
 *  "<judgeId>" (that judge, any model) or "<judgeId>::<model>" (that exact
 *  judge×model pair). Falls back to the legacy matchScore for turns with no
 *  per-judge data. `failed` = the judge attempted this turn but couldn't
 *  produce a score (LLM call failed). */
function scoreForJudge(
  t: { matchScore: number | null; judgeReasoning?: string; judgeScores?: EvalTurnJudgeScore[] },
  judgeKey: string,
  defaultModel = "",
): { score: number | null; reasoning: string; failed: boolean } {
  // Rows stored as "default" (pre-resolution) are the same grader as the
  // resolved default model — match them interchangeably.
  const sameModel = (a: string, b: string) =>
    a === b || (a === "default" && b === defaultModel) || (b === "default" && a === defaultModel);
  if (judgeKey) {
    const [judgeId, model] = judgeKey.split("::") as [string, string | undefined];
    const js = t.judgeScores?.find((j) => j.judgeId === judgeId && (!model || sameModel(j.model, model)));
    // failed: structured status when present, score===null as legacy fallback.
    if (js) return { score: js.score, reasoning: js.reasoning ?? "", failed: js.status ? js.status === "error" : js.score === null };
    // An explicit judge×model pair with no verdict on this turn = not scored yet.
    // Don't leak the legacy/previous score — that made the report show stale
    // metrics while a fresh pass was still running.
    if (model) return { score: null, reasoning: "", failed: false };
    if (t.judgeScores && t.judgeScores.length > 0) return { score: null, reasoning: "", failed: false };
  }
  // Legacy path: a null score with a "judge_unavailable" rationale means it failed.
  const failed = t.matchScore === null && (t.judgeReasoning ?? "") === "judge_unavailable";
  return { score: t.matchScore, reasoning: t.judgeReasoning ?? "", failed };
}

/** Prefilled rubric for a brand-new judge — a sensible starting point users edit. */
const DEFAULT_RUBRIC_HINT = `You are grading how well a GENERATED answer semantically matches an EXPECTED (ground-truth) answer.

Score 0-100 based on meaning, not wording:
- 90-100: same meaning and intent; differences are only stylistic.
- 70-89: mostly correct; minor information missing or different emphasis.
- 40-69: partially correct; misses or misstates important parts.
- 1-39: largely wrong, off-topic, or contradicts the expected answer.
- 0: empty, refuses, or completely unrelated.

Reward correct meaning even if phrasing or length differ.`;

const FOLDER_PAGE = 100;
const rKey = (convId: string, turnIdx: number): string => `${convId}::${turnIdx}`;
// SelectField treats a falsy value as "nothing selected", so model pickers whose
// "Default" option is the empty string need a non-empty sentinel to stay
// displayed + re-selectable. Mapped back to "" at the call boundary.
const DEFAULT_OPT = "__default__";
const toSel = (v: string) => v || DEFAULT_OPT;
const fromSel = (v: string | null) => (v && v !== DEFAULT_OPT ? v : "");

/** Tailwind classes for a 0-100 score chip: green ≥80, amber 50-79, red <50. */
function scoreChipClass(score: number): string {
  if (score >= 80) return "bg-xyne-success/15 text-xyne-success";
  if (score >= 50) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-xyne-error/15 text-xyne-error";
}

/** A clean one-line title for a turn's query: prefer the first sentence-like
 *  line (≥4 words) so a leading greeting / bare transaction id doesn't become
 *  the title; whitespace collapsed. Falls back to the raw message. */
function turnTitle(message: string): string {
  const lines = message.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const sentence = lines.find((l) => l.split(/\s+/).length >= 4) ?? lines[0] ?? message;
  return sentence.replace(/\s+/g, " ").trim();
}

/** Render eval answer text as markdown — headings, bold, tables, lists, code —
 *  instead of raw `##` / `**` / `| … |`. Compact prose tuned for the side-by-side
 *  columns. `tone` picks the body text color (expected = muted, generated = full). */
function EvalMarkdown({ children, tone = "primary" }: { children: string; tone?: "primary" | "secondary" }) {
  return (
    <div
      className={
        "prose prose-sm max-w-none min-w-0 break-words [overflow-wrap:anywhere] dark:prose-invert text-[12.5px] leading-relaxed " +
        "prose-strong:font-medium prose-headings:font-medium " +
        "prose-p:my-1 prose-headings:my-2 prose-headings:text-[13px] " +
        "prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-pre:text-[11px] " +
        "prose-code:text-[11.5px] prose-code:before:content-none prose-code:after:content-none " +
        "prose-table:my-2 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-table:text-[11.5px] " +
        (tone === "secondary"
          ? "prose-p:text-xyne-fg-secondary prose-li:text-xyne-fg-secondary"
          : "prose-p:text-xyne-fg-primary prose-li:text-xyne-fg-primary")
      }
    >
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}

/** Roll up a set of LiveTurns into an overview: avg + good/weak/fail counts. */
function summarizeTurns(turns: LiveTurn[]): {
  avg: number | null;
  good: number;
  weak: number;
  fail: number;
  count: number;
} {
  const judged = turns.filter((t) => typeof t.matchScore === "number") as Array<LiveTurn & { matchScore: number }>;
  // A turn the judge couldn't score IS a fail — it counts as 0 in the average,
  // so one lucky 95 can't headline a pass where everything else errored.
  const errored = turns.filter((t) => typeof t.matchScore !== "number" && t.judgeFailed).length;
  let good = 0;
  let weak = 0;
  let fail = errored;
  for (const t of judged) {
    if (t.matchScore >= 80) good++;
    else if (t.matchScore >= 50) weak++;
    else fail++;
  }
  const total = judged.length + errored;
  const avg = total ? Math.round(judged.reduce((s, t) => s + t.matchScore, 0) / total) : null;
  return { avg, good, weak, fail, count: total };
}


function convStatusFrom(results: Record<string, LiveTurn>, convId: string): TurnStatus {
  const prefix = `${convId}::`;
  const mine = Object.entries(results).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  if (mine.length === 0) return "idle";
  if (mine.some((t) => t.status === "failed")) return "failed";
  // The judge attempted a turn but couldn't score it (e.g. rate-limited) — that
  // conversation is NOT a clean green tick under the selected judge's view.
  if (mine.some((t) => t.judgeFailed)) return "failed";
  if (mine.some((t) => t.status === "running")) return "running";
  return "completed";
}

const PLACEHOLDER = `Paste message/response pairs:

{
  "1": { "message": "hi", "response": "a friendly greeting" },
  "2": { "message": "what can you do?", "response": "an overview" }
}

— for many at once, JSONL (one conversation per line):
[{ "message": "hi", "response": "..." }]
[{ "message": "help", "response": "..." }]`;

interface FolderState {
  items: EvalConversationListItem[];
  total: number;
}

export function EvalsPageV3({ userId }: { userId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const restoredRef = useRef(false);
  const [folders, setFolders] = useState<EvalFolder[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [folderConvs, setFolderConvs] = useState<Record<string, FolderState>>({});

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openConvId, setOpenConvId] = useState<string | null>(null);
  const [openConv, setOpenConv] = useState<EvalConversation | null>(null);
  // When set, the detail pane shows the project (folder) report instead of a
  // conversation. Mutually exclusive with openConvId.
  const [reportFolderId, setReportFolderId] = useState<string | null>(null);
  // When set, the detail pane shows the run-comparison view for a folder.
  const [compareFolderId, setCompareFolderId] = useState<string | null>(null);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentSlug, setAgentSlug] = useState("");
  // Generation model for the run: "" = default, "prov:<provider>" = a provider
  // the user configured in claw, "spaces:<model>" = platform LiteLLM model.
  const [genChoice, setGenChoice] = useState("");
  const [genModels, setGenModels] = useState<EvalGenModels | null>(null);

  const [results, setResults] = useState<Record<string, LiveTurn>>({});

  // Latest run id per folder — lets us trigger on-demand judging for a folder
  // (whole run) or one of its conversations.
  const [runIdByFolder, setRunIdByFolder] = useState<Record<string, string>>({});

  // Judge: model list + global config (loaded lazily on first judge), and the
  // trigger dialog state.
  const [models, setModels] = useState<string[]>([]);
  // What an empty/"default" model resolves to (e.g. "kimi-latest") — shown in
  // brackets next to "Default" so it's never a mystery or a duplicate entry.
  const [defaultModelName, setDefaultModelName] = useState("");
  const loadModels = useCallback(async () => {
    const r = await listEvalModels();
    setModels(r.models);
    setDefaultModelName(r.defaultModel);
  }, []);
  // The user's connected Copilot provider (if any) — surfaces their configured
  // model as "gpt-4o (copilot)" in the extraction/judge model dropdowns.
  const copilotProv = genModels?.providers.find((pr) => pr.provider === "copilot") ?? null;
  const copilotOptionLabel = copilotProv ? `${copilotProv.model ?? "gpt-4o"} (copilot)` : null;
  const [judgeDialog, setJudgeDialog] = useState<
    { runId: string; folderId: string; conversationIds?: string[]; label: string } | null
  >(null);
  const [judging, setJudging] = useState(false);
  const [judgeOnlyUnscored, setJudgeOnlyUnscored] = useState(false);
  // Named judges (rubrics).
  const [judges, setJudges] = useState<EvalJudge[]>([]);
  // What this scoring pass runs: (judge, model) entries. The same judge can be
  // added several times with different models — each entry scores independently.
  const [judgeEntries, setJudgeEntries] = useState<Array<{ judgeId: string; model: string }>>([]);
  // Add-row state + the duplicate-entry message.
  const [addJudgeId, setAddJudgeId] = useState("");
  const [addJudgeModel, setAddJudgeModel] = useState("");
  const [judgeAddMsg, setJudgeAddMsg] = useState<string | null>(null);
  // The judge×model whose scores drive the view (turn chips + report).
  // Encoded "<judgeId>" (any model) or "<judgeId>::<model>". "" = legacy/default.
  const [activeJudgeId, setActiveJudgeId] = useState<string>("");

  // Judges screen (full-pane manager) + the row being edited.
  const [showJudges, setShowJudges] = useState(false);
  const [judgeEdit, setJudgeEdit] = useState<{ id: string | null; name: string; prompt: string; model: string } | null>(null);
  const [judgeSaving, setJudgeSaving] = useState(false);


  // Import-from-Spaces dialog.
  // channelFirst = opened via the top "Fetch from Spaces" button: pick a channel,
  // the backend find-or-creates that channel's folder. folderId is null until resolved.
  const [spacesImport, setSpacesImport] = useState<{ folderId: string | null; channelFirst?: boolean } | null>(null);
  const [importKind, setImportKind] = useState<"channel" | "email-channel">("email-channel");
  const [importTargetId, setImportTargetId] = useState("");
  const [importModel, setImportModel] = useState("");
  const [importRange, setImportRange] = useState("30d");
  const [importingSpaces, setImportingSpaces] = useState(false);
  const [spacesChannels, setSpacesChannels] = useState<SpacesChannelOption[] | null>(null);
  const [spacesAuthOk, setSpacesAuthOk] = useState(true);
  // Background jobs (import / run / scoring) are driven by useBackgroundJob —
  // the hooks are created further down (their callbacks need later-declared
  // helpers); earlier callbacks reach `start` through these trampoline refs.
  const startRunRef = useRef<(m: { jobId: string; runId: string; folderId?: string }) => void>(() => {});
  const startJudgeRef = useRef<
    (m: { jobId: string; runId: string; folderId: string; convScope?: string[]; primaryJudgeId: string }) => void
  >(() => {});
  // The judge×model key of an in-flight scoring pass (keeps it selectable in
  // the view dropdown before its first scores land).
  const [inflightJudgeKey, setInflightJudgeKey] = useState<string | null>(null);

  /** Merge a run's persisted turn results (answer/reasoning/tools + judge
   *  verdict) into the live results map without clobbering newer in-flight
   *  state. */
  const mergeRunResults = useCallback((run: EvalGeneration) => {
    setResults((prev) => {
      const next = { ...prev };
      for (const tr of run.turnResults ?? []) {
        const key = rKey(tr.conversationId, tr.turnIndex);
        const cur = next[key];
        next[key] = {
          answer: tr.clawAnswer ?? cur?.answer ?? "",
          reasoning: tr.reasoning ?? cur?.reasoning ?? "",
          tools: tr.toolInvocations ?? cur?.tools ?? [],
          status: tr.status === "completed" ? "completed" : tr.status === "failed" ? "failed" : "running",
          matchScore: tr.matchScore ?? null,
          judgeReasoning: tr.judgeReasoning ?? "",
          judgeScores: tr.judgeScores ?? cur?.judgeScores ?? [],
        };
      }
      return next;
    });
  }, []);

  // True only while a run-start request is in flight (double-submit guard).
  const [submittingRun, setSubmittingRun] = useState(false);
  // Folders with an in-flight generation run — gates each folder's Run button
  // individually so one folder's run doesn't lock the others.
  const [runningFolders, setRunningFolders] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // A run the user has triggered but not yet confirmed an agent for.
  const [pendingRun, setPendingRun] = useState<{ scope: { conversationIds?: string[]; folderId?: string }; label: string } | null>(null);

  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState("");

  const [importDialog, setImportDialog] = useState(false);
  const [importFolderId, setImportFolderId] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const importPreview = useMemo(
    () => (importText.trim() ? parseEvalConversations(importText) : null),
    [importText],
  );

  const foldersById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  // View-dropdown options: ONLY the judge×model pairs that actually scored the
  // loaded results (e.g. "Semantic Match · kimi-latest") — judges that never ran
  // on this eval don't appear. Values use the scoreForJudge key encoding.
  const judgeOptions = useMemo(() => {
    // Scope to the LATEST scoring pass: find the most recently written passId
    // and only show its graders — older test passes don't clutter the dropdown.
    // (Compare graders by adding several judge×model entries in ONE pass.)
    let latestPass: string | null = null;
    let latestAt = "";
    for (const k in results) {
      for (const js of results[k]?.judgeScores ?? []) {
        if (js.passId && (js.updatedAt ?? "") >= latestAt) {
          latestAt = js.updatedAt ?? "";
          latestPass = js.passId;
        }
      }
    }
    const seen = new Map<string, string>(); // key -> label
    for (const k in results) {
      for (const js of results[k]?.judgeScores ?? []) {
        if (latestPass && js.passId !== latestPass) continue;
        // Normalize legacy "default" rows to the resolved model so "default"
        // and the explicitly-picked same model are ONE entry, not two.
        const model = js.model === "default" && defaultModelName ? defaultModelName : js.model;
        const key = `${js.judgeId}::${model}`;
        if (!seen.has(key)) {
          const label = model === "default" ? `${js.judgeName} · default${defaultModelName ? ` (${defaultModelName})` : ""}` : `${js.judgeName} · ${model}`;
          seen.set(key, label);
        }
      }
    }
    // An in-flight scoring pass has no rows yet for a heartbeat — keep its pair
    // selectable so the view doesn't snap away while it warms up.
    if (inflightJudgeKey && inflightJudgeKey.includes("::") && !seen.has(inflightJudgeKey)) {
      const [jid, model] = inflightJudgeKey.split("::") as [string, string];
      const name = judges.find((j) => j.id === jid)?.name ?? jid;
      seen.set(inflightJudgeKey, `${name} · ${model}`);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [results, inflightJudgeKey, judges, defaultModelName]);

  // Keep the view key valid: when scores load and the bare judge id gains
  // judge::model options, snap to the first matching (or first) option.
  useEffect(() => {
    if (judgeOptions.length === 0) return;
    setActiveJudgeId((cur) => {
      if (cur && judgeOptions.some((o) => o.value === cur)) return cur;
      const sameJudge = cur ? judgeOptions.find((o) => o.value.startsWith(`${cur.split("::")[0]}::`)) : undefined;
      return (sameJudge ?? judgeOptions[0])!.value;
    });
  }, [judgeOptions]);

  // Results remapped so every turn's matchScore/reasoning reflects the judge
  // chosen in the dropdown. All downstream rendering reads these.
  const displayResults = useMemo(() => {
    if (!activeJudgeId) return results;
    const out: Record<string, LiveTurn> = {};
    for (const k in results) {
      const t = results[k]!;
      const { score, reasoning, failed } = scoreForJudge(t, activeJudgeId, defaultModelName);
      out[k] = { ...t, matchScore: score, judgeReasoning: reasoning, judgeFailed: failed };
    }
    return out;
  }, [results, activeJudgeId, defaultModelName]);

  // Does the open conversation have any judge scores at all? Gates the judge
  // dropdown in its header — a never-scored conversation shouldn't surface
  // graders that belong to other folders' runs.
  const openConvHasJudgeScores = useMemo(() => {
    if (!openConv) return false;
    const prefix = `${openConv.id}::`;
    for (const k in results) {
      if (k.startsWith(prefix) && (results[k]?.judgeScores?.length ?? 0) > 0) return true;
    }
    return false;
  }, [openConv, results]);

  // Per-conversation overview for the detail header.
  const openConvSummary = useMemo(() => {
    if (!openConv) return null;
    const turns = ((openConv.turns as EvalTurn[]) ?? [])
      .map((_t, ti) => displayResults[rKey(openConv.id, ti)])
      .filter((t): t is LiveTurn => !!t);
    return summarizeTurns(turns);
  }, [openConv, displayResults]);

  // ── Loaders ──
  const loadFolders = useCallback(async () => {
    try {
      setFolders(await listEvalFolders());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load folders");
    }
  }, []);

  const loadFolderConvs = useCallback(async (folderId: string) => {
    try {
      const { total, items } = await listEvalConversations(folderId, { take: FOLDER_PAGE });
      setFolderConvs((prev) => ({ ...prev, [folderId]: { items, total } }));
      // Overlay the latest run's results for this folder (merge — don't clobber).
      const run = await getLatestGenerationForFolder(folderId).catch(() => null);
      if (run) {
        setRunIdByFolder((prev) => ({ ...prev, [folderId]: run.id }));
        if (run.turnResults?.length) mergeRunResults(run);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    }
  }, []);

  const loadMoreConvs = useCallback(async (folderId: string) => {
    const cur = folderConvs[folderId];
    try {
      const { total, items } = await listEvalConversations(folderId, {
        skip: cur?.items.length ?? 0,
        take: FOLDER_PAGE,
      });
      setFolderConvs((prev) => ({
        ...prev,
        [folderId]: { total, items: [...(prev[folderId]?.items ?? []), ...items] },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    }
  }, [folderConvs]);

  useEffect(() => {
    void loadFolders();
    listAgents(userId)
      .then((a) => {
        setAgents(a);
        const first = a[0];
        if (first) setAgentSlug((cur) => cur || first.slug);
      })
      .catch(() => {});
  }, [loadFolders, userId]);

  useEffect(() => {
    if (!openConvId) {
      setOpenConv(null);
      return;
    }
    let cancelled = false;
    getEvalConversation(openConvId)
      .then((c) => {
        if (cancelled || !c) return;
        setOpenConv(c);
        // Deep-link / refresh: make sure this conv's folder (and its run scores)
        // are loaded so the turn scores show even when we didn't navigate here.
        if (c.folderId && !folderConvs[c.folderId]) void loadFolderConvs(c.folderId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openConvId]);

  const toggleFolder = useCallback(
    (id: string) => {
      setExpanded((s) => {
        const n = new Set(s);
        if (n.has(id)) {
          n.delete(id);
        } else {
          n.add(id);
          if (!folderConvs[id]) void loadFolderConvs(id);
        }
        return n;
      });
    },
    [folderConvs, loadFolderConvs],
  );

  const openNewFolder = useCallback(() => {
    setFolderName("");
    setFolderDialog(true);
  }, []);

  const handleCreateFolder = useCallback(async () => {
    if (!folderName.trim()) return;
    try {
      await createEvalFolder({ name: folderName.trim() }, userId);
      setFolderDialog(false);
      setFolderName("");
      await loadFolders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
  }, [folderName, userId, loadFolders]);

  const handleDeleteFolder = useCallback(
    async (id: string) => {
      if (!confirm("Delete this folder and its conversations?")) return;
      try {
        await deleteEvalFolder(id, userId);
        await loadFolders();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete folder");
      }
    },
    [userId, loadFolders],
  );

  const openImport = useCallback((folderId: string) => {
    setImportFolderId(folderId);
    setImportText("");
    setImportDialog(true);
  }, []);

  const handleImport = useCallback(async () => {
    if (!importFolderId) return;
    const parsed = parseEvalConversations(importText);
    if ("error" in parsed) return setError(`Import: ${parsed.error}`);
    setImporting(true);
    setError(null);
    try {
      await importEvalConversations(importFolderId, parsed.conversations, userId);
      setImportDialog(false);
      setImportText("");
      await loadFolders();
      await loadFolderConvs(importFolderId);
      setExpanded((s) => new Set(s).add(importFolderId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import");
    } finally {
      setImporting(false);
    }
  }, [importFolderId, importText, userId, loadFolders, loadFolderConvs]);

  const onFileChosen = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result ?? ""));
    reader.readAsText(file);
  }, []);

  const handleDeleteConv = useCallback(
    async (id: string, folderId: string) => {
      try {
        await deleteEvalConversation(id, userId);
        if (openConvId === id) setOpenConvId(null);
        setChecked((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
        await loadFolderConvs(folderId);
        await loadFolders();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete conversation");
      }
    },
    [userId, openConvId, loadFolderConvs, loadFolders],
  );

  const toggleCheck = useCallback((id: string, on: boolean) => {
    setChecked((s) => {
      const n = new Set(s);
      on ? n.add(id) : n.delete(id);
      return n;
    });
  }, []);

  // Enqueue a resilient background run (replays server-side) and start polling.
  const runOver = useCallback(
    async (scope: { conversationIds?: string[]; folderId?: string }) => {
      if (submittingRun || !agentSlug) return;
      // One run at a time, full stop — a second folder's run would either fight
      // the first for the same provider account (stream terminations) or sit in
      // a queue that surprises the user. Block instead.
      if (runningFolders.size > 0) {
        setInfo("A run is already in progress — wait for it to finish (or cancel it) before starting another.");
        return;
      }
      setError(null);
      setSubmittingRun(true);
      // Clear the previous run's results for these conversations immediately —
      // stale ticks/scores shouldn't linger while the new run streams in.
      const targetIds =
        scope.conversationIds ?? (scope.folderId ? (folderConvs[scope.folderId]?.items ?? []).map((c) => c.id) : []);
      if (targetIds.length > 0) {
        setResults((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            if (targetIds.some((id) => k.startsWith(`${id}::`))) delete next[k];
          }
          return next;
        });
      }
      try {
        // genChoice encodings: "" = default resolution; "prov:<provider>" = a
        // provider the user configured in claw (its model from gen-models);
        // "spaces:<model>" = platform LiteLLM pinned to that model.
        let gen: { genProvider?: string; genModel?: string } = {};
        if (genChoice.startsWith("prov:")) {
          const p = genChoice.slice(5);
          const m = genModels?.providers.find((x) => x.provider === p)?.model;
          gen = { genProvider: p, ...(m ? { genModel: m } : {}) };
        } else if (genChoice.startsWith("spaces:")) {
          gen = { genProvider: "spaces", genModel: genChoice.slice(7) };
        }
        const { runId, jobId } = await startBackgroundGeneration({ agentSlug, ...scope, ...gen }, userId);
        const fid = scope.folderId ?? openConv?.folderId;
        if (fid) {
          setRunIdByFolder((prev) => ({ ...prev, [fid]: runId }));
        }
        if (fid) setRunningFolders((cur) => new Set(cur).add(fid));
        startRunRef.current({ jobId, runId, ...(fid ? { folderId: fid } : {}) });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Run failed");
      } finally {
        setSubmittingRun(false);
      }
    },
    [submittingRun, runningFolders, agentSlug, userId, openConv, genChoice, genModels, folderConvs],
  );

  const openRun = useCallback(
    (scope: { conversationIds?: string[]; folderId?: string }, label: string) => {
      if (submittingRun) return;
      setPendingRun({ scope, label });
      // Lazily load the user's configured providers + platform models for the picker.
      if (!genModels) void listEvalGenModels(userId).then(setGenModels).catch(() => setGenModels({ providers: [], litellm: [] }));
    },
    [submittingRun, genModels, userId],
  );

  // ── Semantic judge ──
  /** Open the judge dialog for a folder (whole run) or one conversation. Lazily
   *  loads the model list + global defaults, and prefills the prompt with the
   *  per-folder override if one is set, else the global default. */
  const openJudge = useCallback(
    async (opts: { folderId: string; conversationId?: string; label: string }) => {
      const runId = runIdByFolder[opts.folderId];
      if (!runId) {
        setInfo("Run this eval first — there are no generated answers to score yet.");
        return;
      }
      let js = judges;
      if (js.length === 0) {
        try {
          js = await listEvalJudges();
          setJudges(js);
        } catch {
          js = [];
        }
      }
      // Pre-fill with the active judge (model from the view key), else the Default.
      const [activeId, activeModel] = activeJudgeId.split("::") as [string, string | undefined];
      const def = js.find((j) => j.id === activeId) ?? js.find((j) => j.isDefault) ?? js[0];
      setJudgeEntries(def ? [{ judgeId: def.id, model: activeModel && def.id === activeId ? activeModel : "" }] : []);
      setAddJudgeId(def?.id ?? js[0]?.id ?? "");
      setAddJudgeModel("");
      setJudgeAddMsg(null);
      if (models.length === 0) void loadModels().catch(() => {});
      if (!genModels) void listEvalGenModels(userId).then(setGenModels).catch(() => setGenModels({ providers: [], litellm: [] }));
      setJudgeDialog({
        runId,
        folderId: opts.folderId,
        ...(opts.conversationId ? { conversationIds: [opts.conversationId] } : {}),
        label: opts.label,
      });
    },
    [runIdByFolder, judges, activeJudgeId, models.length],
  );

  const runJudge = useCallback(async () => {
    if (!judgeDialog || judging || judgeEntries.length === 0) return;
    setJudging(true);
    setError(null);
    const entries = judgeEntries;
    const runId = judgeDialog.runId;
    const folderId = judgeDialog.folderId;
    const convScope = judgeDialog.conversationIds;
    try {
      const { jobId } = await judgeEvalRun(
        runId,
        {
          judges: entries.map((e) => ({ judgeId: e.judgeId, ...(e.model ? { model: e.model } : {}) })),
          ...(convScope ? { conversationIds: convScope } : {}),
          ...(judgeOnlyUnscored ? { onlyUnscored: true } : {}),
        },
        userId,
      );
      // Point the view dropdown at the first entry we're scoring. The key always
      // carries the model ("default" when none picked — matching what the worker
      // stores), so the view never falls back to a previous pass's scores.
      const first = entries[0]!;
      const storedModel =
        first.model === "prov:copilot"
          ? `copilot/${copilotProv?.model ?? "gpt-4o"}`
          : first.model || defaultModelName || "default";
      const firstKey = `${first.judgeId}::${storedModel}`;
      setActiveJudgeId(firstKey);
      setInflightJudgeKey(firstKey);
      startJudgeRef.current({ jobId, runId, folderId, ...(convScope ? { convScope } : {}), primaryJudgeId: firstKey });
      setJudgeDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scoring failed");
    } finally {
      setJudging(false);
    }
  }, [judgeDialog, judging, judgeEntries, judgeOnlyUnscored, userId, defaultModelName, copilotProv]);

  // ── Background scoring job (generic poller — see useBackgroundJob) ──
  const judgeJob = useBackgroundJob<
    { jobId: string; runId: string; folderId: string; convScope?: string[]; primaryJudgeId: string },
    EvalJudgeProgress
  >({
    storageKey: "xyne-eval-judge",
    fetchStatus: (id) => getEvalJudgeJob(id, userId),
    cancelJob: (id) => cancelEvalJudgeJob(id, userId),
    isDone: (st) => st.progress?.phase === "done" || st.progress?.phase === "cancelled",
    onRestore: (meta) => setInflightJudgeKey(meta.primaryJudgeId ?? null),
    onFinish: () => setInflightJudgeKey(null),
    // Live: pull the scores written so far so the report/turns fill in as it runs.
    onTick: async (meta) => {
      const run = await getGeneration(meta.runId).catch(() => null);
      if (run) mergeRunResults(run);
    },
    onDone: (meta, st) => {
      if (meta.primaryJudgeId) setActiveJudgeId((cur) => cur || meta.primaryJudgeId);
      const p = st.progress;
      setInfo(
        st.state === "failed"
          ? `Scoring failed: ${st.failedReason ?? "unknown error"}`
          : `Scoring ${p?.phase === "cancelled" ? "cancelled" : "done"} — ${p?.judged ?? 0} judged${
              p?.failed ? `, ${p.failed} failed` : ""
            }${p && p.judgeCount > 1 ? ` · ${p.judgeCount} judges` : ""}.`,
      );
    },
  });
  startJudgeRef.current = judgeJob.start;

  // Load the judges list once (and pick the Default as the active view judge),
  // plus the model list so "default (kimi-latest)" labels resolve everywhere.
  useEffect(() => {
    void loadModels().catch(() => {});
    void (async () => {
      try {
        const js = await listEvalJudges();
        setJudges(js);
        setActiveJudgeId((cur) => cur || js.find((j) => j.isDefault)?.id || js[0]?.id || "");
      } catch {
        /* judges load lazily on demand too */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Model options for the per-judge model picker (loaded when the manager opens).
  useEffect(() => {
    if (showJudges && models.length === 0) void loadModels().catch(() => {});
  }, [showJudges, models.length]);

  // ── Judges manager (create / edit / delete) ──
  const saveJudge = useCallback(async () => {
    if (!judgeEdit || judgeSaving || !judgeEdit.name.trim() || !judgeEdit.prompt.trim()) return;
    setJudgeSaving(true);
    try {
      if (judgeEdit.id) {
        await updateEvalJudge(judgeEdit.id, { name: judgeEdit.name, prompt: judgeEdit.prompt, model: judgeEdit.model }, userId);
      } else {
        await createEvalJudge({ name: judgeEdit.name, prompt: judgeEdit.prompt, model: judgeEdit.model }, userId);
      }
      setJudges(await listEvalJudges());
      setJudgeEdit(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save judge");
    } finally {
      setJudgeSaving(false);
    }
  }, [judgeEdit, judgeSaving, userId]);

  const removeJudge = useCallback(
    async (id: string) => {
      try {
        await deleteEvalJudge(id, userId);
        const js = await listEvalJudges();
        setJudges(js);
        setActiveJudgeId((cur) => (cur.split("::")[0] === id ? js.find((j) => j.isDefault)?.id || js[0]?.id || "" : cur));
        setJudgeEntries((list) => list.filter((e) => e.judgeId !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete judge");
      }
    },
    [userId],
  );

  // The detail pane shows exactly one of: conversation, report, or compare.
  const selectConversation = useCallback((id: string) => {
    setShowJudges(false);
    setReportFolderId(null);
    setCompareFolderId(null);
    setOpenConvId(id);
  }, []);

  // Open a project's report; ensure its conversations (and their scores) are loaded.
  const openReport = useCallback(
    (folderId: string) => {
      setShowJudges(false);
      setOpenConvId(null);
      setCompareFolderId(null);
      setReportFolderId(folderId);
      if (!folderConvs[folderId]) void loadFolderConvs(folderId);
    },
    [folderConvs, loadFolderConvs],
  );

  const openCompare = useCallback(
    (folderId: string) => {
      setShowJudges(false);
      setOpenConvId(null);
      setReportFolderId(null);
      setCompareFolderId(folderId);
      if (!folderConvs[folderId]) void loadFolderConvs(folderId);
    },
    [folderConvs, loadFolderConvs],
  );

  // ── URL ↔ view sync (so refresh / shareable links restore the page) ──
  // Restore the view from the URL once on mount.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const judge = searchParams.get("judge");
    if (judge) setActiveJudgeId(judge);
    if (searchParams.get("judges") === "1") setShowJudges(true);
    else if (searchParams.get("compare")) openCompare(searchParams.get("compare")!);
    else if (searchParams.get("report")) openReport(searchParams.get("report")!);
    else if (searchParams.get("conv")) setOpenConvId(searchParams.get("conv"));
    // Restore which sidebar folders were expanded (+ load their conversations).
    try {
      const ids = JSON.parse(localStorage.getItem("xyne-eval-expanded") || "[]") as string[];
      if (Array.isArray(ids) && ids.length) {
        setExpanded(new Set(ids));
        ids.forEach((fid) => void loadFolderConvs(fid));
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist sidebar folder expansion across refresh.
  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      localStorage.setItem("xyne-eval-expanded", JSON.stringify([...expanded]));
    } catch {
      /* ignore */
    }
  }, [expanded]);

  // Reflect the current view back into the URL (replace — no history spam).
  useEffect(() => {
    if (!restoredRef.current) return;
    const next = new URLSearchParams();
    if (showJudges) next.set("judges", "1");
    else if (compareFolderId) next.set("compare", compareFolderId);
    else if (reportFolderId) next.set("report", reportFolderId);
    else if (openConvId) next.set("conv", openConvId);
    if (activeJudgeId) next.set("judge", activeJudgeId);
    setSearchParams(next, { replace: true });
  }, [showJudges, compareFolderId, reportFolderId, openConvId, activeJudgeId, setSearchParams]);

  // ── Import from Spaces ──
  const openSpacesImport = useCallback(
    async (folderId: string) => {
      setImportTargetId("");
      setSpacesChannels(null);
      setSpacesAuthOk(true);
      setSpacesImport({ folderId });
      // Load models + the user's Spaces channels for the pickers.
      void (async () => {
        if (!genModels) void listEvalGenModels(userId).then(setGenModels).catch(() => setGenModels({ providers: [], litellm: [] }));
        if (models.length === 0) {
          try {
            await loadModels();
          } catch {
            /* falls back to default */
          }
        }
        try {
          const { channels, spacesAuth } = await listEvalSpacesChannels(userId);
          setSpacesChannels(channels);
          setSpacesAuthOk(spacesAuth);
        } catch {
          setSpacesChannels([]);
        }
      })();
    },
    [models.length, userId],
  );

  // Channel-first: open the fetch dialog not tied to any folder — the backend
  // resolves (find-or-creates) the channel's own folder on submit.
  const openChannelFetch = useCallback(() => {
    setImportTargetId("");
    setSpacesChannels(null);
    setSpacesAuthOk(true);
    setSpacesImport({ folderId: null, channelFirst: true });
    void (async () => {
      if (!genModels) void listEvalGenModels(userId).then(setGenModels).catch(() => setGenModels({ providers: [], litellm: [] }));
      if (models.length === 0) {
        try {
          await loadModels();
        } catch {
          /* falls back to default */
        }
      }
      try {
        const { channels, spacesAuth } = await listEvalSpacesChannels(userId);
        setSpacesChannels(channels);
        setSpacesAuthOk(spacesAuth);
      } catch {
        setSpacesChannels([]);
      }
    })();
  }, [models.length, userId]);

  const runSpacesImport = useCallback(async () => {
    if (!spacesImport || importingSpaces || !importTargetId.trim()) return;
    setImportingSpaces(true);
    setError(null);
    const { folderId } = spacesImport;
    const id = importTargetId.trim();

    // Channel-first: the folder is owned by the channel (find-or-created server-side).
    if (spacesImport.channelFirst) {
      try {
        const r = await importEvalFromSpacesChannel(
          {
            kind: importKind,
            channelId: id,
            range: importRange,
            ...(importModel ? { model: importModel } : {}),
          },
          userId,
        );
        setSpacesImport(null);
        await loadFolders().catch(() => {});
        setExpanded((s) => new Set(s).add(r.folderId));
        setInfo(`Fetching into folder “${r.folderName}”…`);
        importJob.start({ jobId: r.jobId, folderId: r.folderId });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
      } finally {
        setImportingSpaces(false);
      }
      return;
    }

    if (!folderId) {
      setImportingSpaces(false);
      return;
    }
    try {
      const { jobId } = await importEvalFromSpaces(
        folderId,
        {
          kind: importKind,
          channelId: id,
          range: importRange,
          ...(importModel ? { model: importModel } : {}),
        },
        userId,
      );
      setSpacesImport(null);
      importJob.start({ jobId, folderId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingSpaces(false);
    }
  }, [spacesImport, importingSpaces, importTargetId, importKind, importModel, importRange, userId, loadFolders]);

  // Auto-dismiss the info toast after a few seconds (errors stay until closed).
  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(null), 6000);
    return () => clearTimeout(t);
  }, [info]);

  // ── Background import + run jobs (generic poller — see useBackgroundJob) ──
  // Tracks created+updated counts between import ticks so the folder refreshes
  // live as conversations land, not only when the whole fetch finishes.
  const importSeenRef = useRef(0);
  const importJob = useBackgroundJob<{ jobId: string; folderId: string }, EvalImportProgress>({
    storageKey: "xyne-eval-import",
    fetchStatus: (id) => getEvalImportJob(id, userId),
    cancelJob: (id) => cancelEvalImportJob(id, userId),
    isDone: (st) => st.progress?.phase === "done" || st.progress?.phase === "cancelled",
    // Live: whenever the worker has created/updated conversations since the
    // last tick, refresh the folder so they appear in the tree immediately.
    onTick: async (meta, st) => {
      const landed = (st.progress?.conversationsCreated ?? 0) + (st.progress?.conversationsUpdated ?? 0);
      if (landed > importSeenRef.current) {
        importSeenRef.current = landed;
        await Promise.all([loadFolderConvs(meta.folderId).catch(() => {}), loadFolders().catch(() => {})]);
      }
    },
    onDone: async (meta, st) => {
      importSeenRef.current = 0;
      const p = st.progress;
      setInfo(
        st.state === "failed"
          ? `Import failed: ${st.failedReason ?? "unknown error"}`
          : `Import ${p?.phase === "cancelled" ? "cancelled" : "done"}: scanned ${p?.conversationsScanned ?? 0}, ` +
              `${p?.pairsFound ?? 0} pair(s) → ${p?.conversationsCreated ?? 0} new` +
              `${p?.conversationsUpdated ? `, ${p.conversationsUpdated} updated` : ""}` +
              `${p?.duplicatesSkipped ? `, ${p.duplicatesSkipped} skipped` : ""}${p?.capped ? " (capped)" : ""}.`,
      );
      // Refresh the folder's conversations AND the folder list — the tree's
      // conversation counts (which gate the Run icon) come from the latter.
      await Promise.all([loadFolderConvs(meta.folderId).catch(() => {}), loadFolders().catch(() => {})]);
    },
  });

  const runJob = useBackgroundJob<{ jobId: string; runId: string; folderId?: string }, GenerationProgress>({
    storageKey: "xyne-eval-generation",
    fetchStatus: (id) => getGenerationJob(id, userId),
    cancelJob: (id) => cancelGenerationJob(id, userId),
    isDone: (st) => st.progress?.phase === "done" || st.progress?.phase === "cancelled" || st.progress?.phase === "failed",
    onRestore: (meta) => {
      if (meta.folderId) setRunningFolders((cur) => new Set(cur).add(meta.folderId!));
    },
    // Live: each generated answer appears in the open conversation as soon as
    // the worker persists it, instead of all-at-once when the run ends.
    onTick: async (meta) => {
      const run = await getGeneration(meta.runId).catch(() => null);
      if (run) mergeRunResults(run);
    },
    onDone: async (_meta, st) => {
      const p = st.progress;
      setInfo(
        st.state === "failed" || p?.phase === "failed"
          ? `Run failed: ${st.failedReason ?? "see logs"}`
          : `Run ${p?.phase === "cancelled" ? "cancelled" : "done"}: ${p?.conversationsDone ?? 0}/${p?.conversationsTotal ?? 0} conversations, ` +
              `${p?.turnsDone ?? 0} turns${p?.turnsFailed ? `, ${p.turnsFailed} failed` : ""}.`,
      );
      // Refresh every loaded folder so results + run-ids overlay.
      await Promise.all(Object.keys(folderConvs).map((fid) => loadFolderConvs(fid).catch(() => {})));
      if (_meta.folderId) {
        setRunningFolders((cur) => {
          const n = new Set(cur);
          n.delete(_meta.folderId!);
          return n;
        });
      }
    },
  });
  startRunRef.current = runJob.start;

  const ctx: TreeCtx = {
    foldersById,
    expanded,
    folderConvs,
    checked,
    // The judge-remapped view, so sidebar ticks reflect the selected judge's
    // outcome (a judge failure shows ✕, not a stale green tick).
    results: displayResults,
    openConvId,
    toggleFolder,
    onSelectConv: selectConversation,
    onToggleCheck: toggleCheck,
    onRunFolder: (id) => openRun({ folderId: id }, `folder “${foldersById.get(id)?.name ?? ""}”`),
    onRunOne: (id) => openRun({ conversationIds: [id] }, "this conversation"),
    onAddConversations: openImport,
    onDeleteFolder: handleDeleteFolder,
    onDeleteConv: handleDeleteConv,
    onLoadMore: loadMoreConvs,
    runIdByFolder,
    onJudgeFolder: (id) => void openJudge({ folderId: id, label: `folder “${foldersById.get(id)?.name ?? ""}”` }),
    onOpenReport: openReport,
    onImportFromSpaces: (id) => void openSpacesImport(id),
    onCompareRuns: openCompare,
    reportFolderId,
    runningFolders,
    submittingRun,
    // While a scoring job runs, conversations it covers show a spinner instead
    // of the stale "done" tick from a previous judge.
    scoringFolderId: judgeJob.active?.folderId ?? null,
    scoringConvIds: judgeJob.active?.convScope ? new Set(judgeJob.active.convScope) : null,
  };

  return (
    <div className="flex h-full w-full flex-row overflow-hidden">
      {/* ── One navigation panel ── */}
      <section className="flex w-[340px] shrink-0 flex-col border-r border-xyne-border-subtle">
        <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-xyne-border-subtle px-3">
          <span className="text-[13px] font-semibold text-xyne-fg-primary">Evals</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => openChannelFetch()}
              title="Fetch from Spaces — pick a channel; it gets its own folder"
              className="rounded p-1 text-xyne-fg-tertiary hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
            >
              <CloudArrowDownIcon size={15} />
            </button>
            <button
              onClick={() => {
                setShowJudges(true);
                setJudgeEdit(null);
              }}
              title="Judges — create & manage scoring judges"
              className="rounded p-1 text-xyne-fg-tertiary hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
            >
              <ScalesIcon size={15} />
            </button>
            <button
              onClick={() => openNewFolder()}
              title="New folder"
              className="rounded p-1 text-xyne-fg-tertiary hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
            >
              <FolderPlusIcon size={15} />
            </button>
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto py-1">
          {folders.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-xyne-fg-tertiary">
              No folders yet.
              <br />
              Click <span className="font-medium">New folder</span> to start.
            </div>
          ) : (
            folders.map((f) => <FolderNode key={f.id} folderId={f.id} ctx={ctx} />)
          )}
        </div>

        {/* Run-selected bar */}
        {checked.size > 0 && (
          <div className="border-t border-xyne-border-subtle p-2">
            <Button
              variant="primary"
              size="sm"
              disabled={submittingRun}
              leadingIcon={submittingRun ? <SpinnerGapIcon size={12} className="animate-spin" /> : <PlayIcon size={12} />}
              onClick={() => openRun({ conversationIds: [...checked] }, `${checked.size} selected conversation${checked.size === 1 ? "" : "s"}`)}
              className="w-full"
            >
              Run {checked.size} selected
            </Button>
          </div>
        )}
      </section>

      {/* ── Detail ── */}
      <section className="relative flex flex-1 flex-col overflow-hidden">
        {/* Bottom-right job banners — every background job (run / import /
            scoring) reports here consistently; they stack when several run. */}
        {(runJob.actives.length > 0 || importJob.active || judgeJob.active) && (
          <div className="absolute bottom-4 right-4 z-40 flex w-64 flex-col gap-2">
            {runJob.actives.map((job) => (
              <div key={job.jobId} className="rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2 shadow-lg">
                <div className="flex items-center justify-between">
                  <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-xyne-fg-secondary">
                    <SpinnerGapIcon size={13} className={`shrink-0 text-xyne-brand ${job.state === "waiting" || job.state === "delayed" ? "opacity-50" : "animate-spin"}`} />
                    <span className="truncate">
                      {job.state === "waiting" || job.state === "delayed" ? "Queued" : "Generating"}
                      {job.folderId ? ` · ${foldersById.get(job.folderId)?.name ?? ""}` : ""}…
                    </span>
                  </span>
                  <button
                    onClick={() => void runJob.cancel(job.jobId)}
                    disabled={runJob.cancelling.has(job.jobId)}
                    className="shrink-0 text-[11px] text-xyne-fg-tertiary hover:text-xyne-error disabled:cursor-default disabled:opacity-60 disabled:hover:text-xyne-fg-tertiary"
                  >
                    {runJob.cancelling.has(job.jobId) ? "Cancelling…" : "Cancel"}
                  </button>
                </div>
                <div className="mt-1 text-[10.5px] text-xyne-fg-tertiary">
                  {job.progress?.conversationsDone ?? 0}/{job.progress?.conversationsTotal ?? 0} conv ·{" "}
                  {job.progress?.turnsDone ?? 0}/{job.progress?.turnsTotal ?? 0} turns
                  {job.progress?.turnsFailed ? ` · ${job.progress.turnsFailed} failed` : ""}
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-xyne-surface-sunken">
                  <div
                    className="h-full rounded-full bg-xyne-brand transition-all"
                    style={{
                      width: `${job.progress?.turnsTotal ? (job.progress.turnsDone / job.progress.turnsTotal) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            {importJob.active && (
              <div className="rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2 shadow-lg">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-xyne-fg-secondary">
                    <CloudArrowDownIcon size={13} className="animate-pulse text-xyne-brand" />
                    Importing from Spaces…
                  </span>
                  <button
                    onClick={() => void importJob.cancel()}
                    disabled={importJob.cancelling.size > 0}
                    className="text-[11px] text-xyne-fg-tertiary hover:text-xyne-error disabled:cursor-default disabled:opacity-60"
                  >
                    {importJob.cancelling.size > 0 ? "Cancelling…" : "Cancel"}
                  </button>
                </div>
                <div className="mt-1 text-[10.5px] text-xyne-fg-tertiary">
                  scanned {importJob.active.progress?.conversationsScanned ?? 0} · found {importJob.active.progress?.pairsFound ?? 0} ·
                  created {importJob.active.progress?.conversationsCreated ?? 0}
                  {importJob.active.progress?.conversationsUpdated ? ` · updated ${importJob.active.progress.conversationsUpdated}` : ""}
                  {importJob.active.progress?.capped ? " · capped" : ""}
                </div>
              </div>
            )}
            {judgeJob.active && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  const fid = judgeJob.active?.folderId;
                  if (fid) openReport(fid);
                }}
                className="cursor-pointer rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2 shadow-lg transition-colors hover:border-xyne-border-focus"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-xyne-fg-secondary">
                    <ScalesIcon size={13} className="animate-pulse text-xyne-brand" />
                    Scoring{judgeJob.active.progress && judgeJob.active.progress.judgeCount > 1 ? ` · ${judgeJob.active.progress.judgeCount} judges` : ""}…
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void judgeJob.cancel();
                    }}
                    disabled={judgeJob.cancelling.size > 0}
                    className="text-[11px] text-xyne-fg-tertiary hover:text-xyne-error disabled:cursor-default disabled:opacity-60"
                  >
                    {judgeJob.cancelling.size > 0 ? "Cancelling…" : "Cancel"}
                  </button>
                </div>
                <div className="mt-1 text-[10.5px] text-xyne-fg-tertiary">
                  {judgeJob.active.progress?.done ?? 0}/{judgeJob.active.progress?.total ?? 0} scored
                  {judgeJob.active.progress?.failed ? ` · ${judgeJob.active.progress.failed} failed` : ""} · view report →
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-xyne-surface-sunken">
                  <div
                    className="h-full rounded-full bg-xyne-brand transition-all"
                    style={{ width: `${judgeJob.active.progress?.total ? (judgeJob.active.progress.done / judgeJob.active.progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        {/* Floating toast — error (sticky) + info (auto-dismisses) */}
        {(error || info) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex flex-col items-center gap-2 px-4">
            {error && (
              <div className="pointer-events-auto flex max-w-lg items-center gap-2.5 rounded-lg border border-xyne-error/40 bg-xyne-surface px-3.5 py-2.5 text-[12.5px] text-xyne-error shadow-lg">
                <XCircleIcon size={15} weight="fill" className="shrink-0" />
                <span className="min-w-0">{error}</span>
                <button onClick={() => setError(null)} className="ml-1 shrink-0 opacity-60 hover:opacity-100">✕</button>
              </div>
            )}
            {info && (
              <div className="pointer-events-auto flex max-w-lg items-center gap-2.5 rounded-lg border border-xyne-border bg-xyne-surface px-3.5 py-2.5 text-[12.5px] text-xyne-fg-secondary shadow-lg">
                <CheckCircleIcon size={15} weight="fill" className="shrink-0 text-xyne-success" />
                <span className="min-w-0">{info}</span>
                <button onClick={() => setInfo(null)} className="ml-1 shrink-0 text-xyne-fg-tertiary hover:text-xyne-fg-primary">✕</button>
              </div>
            )}
          </div>
        )}
        {showJudges ? (
          <>
            <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-xyne-border-subtle px-5">
              <div className="flex min-w-0 items-center gap-2">
                <ScalesIcon size={15} weight="fill" className="shrink-0 text-xyne-brand" />
                <h2 className="truncate text-[14px] font-semibold text-xyne-fg-primary">Judges</h2>
                <span className="text-[11px] text-xyne-fg-tertiary">· grading rubrics</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!judgeEdit && (
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<PlusIcon size={13} />}
                    onClick={() => setJudgeEdit({ id: null, name: "", prompt: DEFAULT_RUBRIC_HINT, model: "" })}
                  >
                    New judge
                  </Button>
                )}
                <button
                  onClick={() => {
                    setShowJudges(false);
                    setJudgeEdit(null);
                  }}
                  title="Close"
                  className="text-xyne-fg-tertiary hover:text-xyne-fg-primary"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <div className="mx-auto max-w-2xl">
                {judgeEdit ? (
                  <div className="flex flex-col gap-3">
                    <div className="text-[12px] text-xyne-fg-tertiary">
                      A judge is a grading rubric — the criteria for scoring answers 0-100 against the expected answer.
                      The model that runs it is picked at scoring time, so the same judge works with any model.
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-[12px] font-medium text-xyne-fg-secondary">Name</span>
                      <input
                        value={judgeEdit.name}
                        onChange={(e) => setJudgeEdit((j) => (j ? { ...j, name: e.target.value } : j))}
                        placeholder="e.g. Strict factual"
                        autoFocus
                        className="h-9 rounded-lg border border-xyne-border bg-xyne-surface px-3 text-[13px] text-xyne-fg-primary outline-none focus:border-xyne-border-focus"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[12px] font-medium text-xyne-fg-secondary">Grading rubric</span>
                      <textarea
                        value={judgeEdit.prompt}
                        onChange={(e) => setJudgeEdit((j) => (j ? { ...j, prompt: e.target.value } : j))}
                        spellCheck={false}
                        className="h-72 resize-none rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 py-2 text-[12px] leading-relaxed text-xyne-fg-primary outline-none focus:border-xyne-border-focus"
                      />
                    </label>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" disabled={judgeSaving} onClick={() => setJudgeEdit(null)}>
                        Back
                      </Button>
                      <Button
                        variant="primary"
                        disabled={judgeSaving || !judgeEdit.name.trim() || !judgeEdit.prompt.trim()}
                        leadingIcon={judgeSaving ? <SpinnerGapIcon size={13} className="animate-spin" /> : undefined}
                        onClick={() => void saveJudge()}
                      >
                        {judgeEdit.id ? "Save" : "Create"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {judges.map((j) => (
                      <div
                        key={j.id}
                        className="flex items-start justify-between rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-4 py-3"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-xyne-fg-primary">
                            {j.name}
                            {j.isDefault && <span className="ml-2 text-[10px] font-normal text-xyne-fg-tertiary">default</span>}
                          </div>
                          <div className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-xyne-fg-tertiary">{j.prompt}</div>
                        </div>
                        <div className="ml-3 flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => setJudgeEdit({ id: j.id, name: j.name, prompt: j.prompt, model: j.model })}
                            className="rounded p-1 text-xyne-fg-tertiary hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
                            title="Edit"
                          >
                            <PencilSimpleIcon size={15} />
                          </button>
                          {!j.isDefault && (
                            <button
                              onClick={() => void removeJudge(j.id)}
                              className="rounded p-1 text-xyne-fg-tertiary hover:bg-xyne-surface-subtle hover:text-xyne-error"
                              title="Delete"
                            >
                              <TrashIcon size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {judges.length === 0 && (
                      <div className="py-10 text-center text-[12px] text-xyne-fg-tertiary">No judges yet.</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : compareFolderId ? (
          <CompareView
            folderName={foldersById.get(compareFolderId)?.name ?? "Project"}
            folderId={compareFolderId}
            convItems={folderConvs[compareFolderId]?.items ?? []}
            onOpenConv={selectConversation}
            onClose={() => setCompareFolderId(null)}
          />
        ) : reportFolderId ? (
          <ProjectReport
            folderName={foldersById.get(reportFolderId)?.name ?? "Project"}
            convItems={folderConvs[reportFolderId]?.items ?? []}
            results={displayResults}
            judgeOptions={judgeOptions}
            activeJudgeId={activeJudgeId}
            onSelectJudge={setActiveJudgeId}
            scoringActive={!!judgeJob.active && judgeJob.active.folderId === reportFolderId}
            scoringConvIds={judgeJob.active?.convScope ? new Set(judgeJob.active.convScope) : null}
            canScore={!!runIdByFolder[reportFolderId]}
            onScore={() =>
              void openJudge({ folderId: reportFolderId, label: `folder “${foldersById.get(reportFolderId)?.name ?? ""}”` })
            }
            onOpenConv={selectConversation}
            onClose={() => setReportFolderId(null)}
          />
        ) : !openConv ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-xyne-fg-tertiary">
            <ChatCircleDotsIcon size={28} weight="thin" />
            <p className="text-[13px]">Expand a folder and pick a conversation to see its turns and eval results.</p>
          </div>
        ) : (
          <>
            <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-xyne-border-subtle px-5">
              <div className="min-w-0">
                <h2 className="truncate text-[14px] font-semibold text-xyne-fg-primary">{openConv.title}</h2>
                <div className="text-[11px] text-xyne-fg-tertiary">
                  {(openConv.turns as EvalTurn[])?.length ?? 0} turns{openConv.source ? ` · ${openConv.source}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {judgeOptions.length > 0 && openConvHasJudgeScores && (
                  <select
                    value={activeJudgeId}
                    onChange={(e) => setActiveJudgeId(e.target.value)}
                    title="Which judge's scores to show"
                    className="h-7 rounded-md border border-xyne-border bg-xyne-surface px-2 text-[11px] text-xyne-fg-secondary outline-none focus:border-xyne-border-focus"
                  >
                    {judgeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                {openConvSummary && openConvSummary.avg != null && (
                  <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${scoreChipClass(openConvSummary.avg)}`}>
                    {openConvSummary.avg}
                    <span className="font-normal opacity-70">/100</span>
                  </span>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<ScalesIcon size={13} />}
                  disabled={!runIdByFolder[openConv.folderId]}
                  title={runIdByFolder[openConv.folderId] ? "Score this conversation" : "Run the eval first"}
                  onClick={() =>
                    void openJudge({ folderId: openConv.folderId, conversationId: openConv.id, label: "this conversation" })
                  }
                >
                  Score
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2">
              <div className="flex flex-col">
                {(openConv.turns as EvalTurn[]).map((t, ti) => (
                  <TurnCard
                    key={ti}
                    index={ti}
                    message={t.message}
                    expected={t.expectedResponse ?? null}
                    live={displayResults[rKey(openConv.id, ti)]}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Run dialog: pick the agent at run time ── */}
      <Dialog open={!!pendingRun} onOpenChange={(o) => !o && setPendingRun(null)} title="Run eval">
        <div className="flex flex-col gap-3">
          <div className="text-[12px] text-xyne-fg-tertiary">
            Running <span className="font-medium text-xyne-fg-secondary">{pendingRun?.label}</span>
          </div>
          <SelectField
            label="Agent"
            placeholder={agents.length === 0 ? "Loading agents…" : "Search agents…"}
            value={agentSlug}
            onValueChange={(v) => setAgentSlug(v ?? "")}
            options={agents.map((a) => ({ value: a.slug, label: a.name }))}
          />
          <div className="flex flex-col gap-1">
            <SelectField
              label="Generation model"
              placeholder="Search models…"
              value={toSel(genChoice)}
              onValueChange={(v) => setGenChoice(fromSel(v))}
              options={[
                { value: DEFAULT_OPT, label: "Default — your agent settings" },
                ...(genModels?.providers ?? []).map((p) => ({
                  value: `prov:${p.provider}`,
                  label: `${p.provider}${p.model ? ` · ${p.model}` : ""} (your provider)`,
                })),
                ...(genModels?.litellm ?? []).map((m) => ({ value: `spaces:${m}`, label: `${m} (platform)` })),
              ]}
            />
            <span className="text-[11px] text-xyne-fg-tertiary">
              Pinned for this run and recorded on the report. Default uses whatever your settings resolve to.
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingRun(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!agentSlug}
              leadingIcon={<PlayIcon size={13} />}
              onClick={() => {
                const scope = pendingRun?.scope;
                setPendingRun(null);
                if (scope) void runOver(scope);
              }}
            >
              Run
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ── Score dialog: pick one or more judges ── */}
      <Dialog open={!!judgeDialog} onOpenChange={(o) => !o && !judging && setJudgeDialog(null)} title="Score — semantic match">
        <div className="flex flex-col gap-3">
          <div className="text-[12px] text-xyne-fg-tertiary">
            Scoring <span className="font-medium text-xyne-fg-secondary">{judgeDialog?.label}</span> — each selected judge
            grades every turn's answer 0-100 against the expected answer. Turns without an expected answer are skipped.
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-xyne-fg-secondary">Judges</span>
              <button
                onClick={() => {
                  setJudgeDialog(null);
                  setShowJudges(true);
                  setJudgeEdit(null);
                }}
                className="text-[11px] text-xyne-brand hover:underline"
              >
                Manage judges
              </button>
            </div>
            {/* Add row: judge + model → Add. The same judge with a different model is a new entry. */}
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SelectField
                  placeholder={judges.length === 0 ? "No judges yet" : "Search judges…"}
                  value={addJudgeId}
                  onValueChange={(v) => {
                    setAddJudgeId(v ?? "");
                    setJudgeAddMsg(null);
                  }}
                  options={judges.map((j) => ({ value: j.id, label: j.name }))}
                />
              </div>
              <div className="min-w-0 flex-1">
                <SelectField
                  placeholder="Search models…"
                  value={toSel(addJudgeModel)}
                  onValueChange={(v) => {
                    setAddJudgeModel(fromSel(v));
                    setJudgeAddMsg(null);
                  }}
                  options={[
                    { value: DEFAULT_OPT, label: `Default model${defaultModelName ? ` (${defaultModelName})` : ""}` },
                    ...(copilotOptionLabel ? [{ value: "prov:copilot", label: copilotOptionLabel }] : []),
                    ...models.map((m) => ({ value: m, label: m })),
                  ]}
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!addJudgeId}
                leadingIcon={<PlusIcon size={12} />}
                onClick={() => {
                  if (!addJudgeId) return;
                  if (judgeEntries.some((e) => e.judgeId === addJudgeId && e.model === addJudgeModel)) {
                    const j = judges.find((x) => x.id === addJudgeId);
                    setJudgeAddMsg(`“${j?.name ?? "This judge"}” with ${addJudgeModel || "the default model"} is already added.`);
                    return;
                  }
                  setJudgeEntries((list) => [...list, { judgeId: addJudgeId, model: addJudgeModel }]);
                  setJudgeAddMsg(null);
                }}
              >
                Add
              </Button>
            </div>
            {judgeAddMsg && <div className="text-[11px] text-amber-600 dark:text-amber-400">{judgeAddMsg}</div>}
            {/* Selected (judge, model) pairs as removable chips. */}
            {judgeEntries.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {judgeEntries.map((e, idx) => {
                  const j = judges.find((x) => x.id === e.judgeId);
                  return (
                    <span
                      key={`${e.judgeId}::${e.model}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-xyne-border bg-xyne-surface-subtle py-1 pl-3 pr-1.5 text-[12px] text-xyne-fg-primary"
                    >
                      {j?.name ?? e.judgeId}
                      <span className="text-[11px] text-xyne-fg-tertiary">{e.model === "prov:copilot" ? copilotOptionLabel ?? "copilot" : e.model || (defaultModelName ? `default (${defaultModelName})` : "default")}</span>
                      <button
                        onClick={() => setJudgeEntries((list) => list.filter((_, i) => i !== idx))}
                        title="Remove"
                        className="grid h-4.5 w-4.5 place-items-center rounded-full text-[11px] leading-none text-xyne-fg-tertiary hover:bg-white/[0.08] hover:text-xyne-error"
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <span className="text-[11px] text-xyne-fg-tertiary">
              Add the same judge with different models to compare graders.
            </span>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-xyne-fg-secondary">
            <input
              type="checkbox"
              checked={judgeOnlyUnscored}
              onChange={(e) => setJudgeOnlyUnscored(e.target.checked)}
              className="accent-xyne-brand"
            />
            Only re-score failed / unscored turns
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={judging} onClick={() => setJudgeDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={judging || judgeEntries.length === 0}
              leadingIcon={judging ? <SpinnerGapIcon size={13} className="animate-spin" /> : <ScalesIcon size={13} />}
              onClick={() => void runJudge()}
            >
              {judging ? "Scoring…" : judgeEntries.length > 1 ? `Run ${judgeEntries.length} judges` : "Run scoring"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ── Import from Spaces dialog ── */}
      <Dialog
        open={!!spacesImport}
        onOpenChange={(o) => !o && !importingSpaces && setSpacesImport(null)}
        title={spacesImport?.channelFirst ? "Fetch from Spaces" : "Import from Spaces"}
      >
        <div className="flex flex-col gap-3">
          <div className="text-[12px] text-xyne-fg-tertiary">
            {spacesImport?.channelFirst
              ? "Pick a channel — it gets its own folder. We extract the real question→answer pairs (verbatim, via LLM). Re-fetching the same channel only adds conversations/replies that are new since last time; nothing already imported is changed."
              : "Pull a conversation from Spaces, extract the real question→answer pairs (verbatim, via LLM), and add them as eval conversations. Read-only and scoped to what you can access in Spaces."}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-xyne-fg-secondary">Source</span>
            <select
              value={importKind}
              onChange={(e) => setImportKind(e.target.value as "channel" | "email-channel")}
              className="h-9 rounded-lg border border-xyne-border bg-xyne-surface px-2.5 text-[13px] text-xyne-fg-primary outline-none focus:border-xyne-border-focus"
            >
              <option value="email-channel">Email</option>
              <option value="channel">Chat</option>
            </select>
          </label>
          {!spacesAuthOk && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              No active Spaces session found — log into Spaces first (or paste an ID manually below).
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-xyne-fg-secondary">Channel</span>
            {(() => {
              const wantEmail = importKind === "email-channel";
              const opts = (spacesChannels ?? []).filter((c) => (wantEmail ? c.type === "EMAIL" : c.type !== "EMAIL"));
              return (
                <SelectField
                  placeholder={spacesChannels === null ? "Loading channels…" : opts.length ? "Search channels…" : "No channels found"}
                  value={importTargetId}
                  onValueChange={(v) => setImportTargetId(v ?? "")}
                  options={opts.map((c) => ({
                    value: c.id,
                    label: `${c.name || c.id}${wantEmail ? "" : ` · ${c.type.toLowerCase()}`}`,
                  }))}
                />
              );
            })()}
          </label>
          {spacesImport?.channelFirst && importTargetId && (
            <div className="rounded-md border border-xyne-border bg-xyne-surface-subtle px-2.5 py-1.5 text-[11px] text-xyne-fg-secondary">
              Imports into folder{" "}
              <span className="font-medium text-xyne-fg-primary">
                {(spacesChannels ?? []).find((c) => c.id === importTargetId)?.name || importTargetId}
              </span>{" "}
              — created automatically and reused every time you re-fetch this channel.
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-xyne-fg-secondary">Time range</span>
            <select
              value={importRange}
              onChange={(e) => setImportRange(e.target.value)}
              className="h-9 rounded-lg border border-xyne-border bg-xyne-surface px-2.5 text-[13px] text-xyne-fg-primary outline-none focus:border-xyne-border-focus"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="3m">Last 3 months</option>
              <option value="6m">Last 6 months</option>
              <option value="1y">Last 1 year</option>
              <option value="all">All time (can be very large)</option>
            </select>
          </label>
          <SelectField
            label="Extraction model"
            placeholder="Search models…"
            value={toSel(importModel)}
            onValueChange={(v) => setImportModel(fromSel(v))}
            options={[
              { value: DEFAULT_OPT, label: `Default${defaultModelName ? ` (${defaultModelName})` : ""}` },
              ...(copilotOptionLabel ? [{ value: "prov:copilot", label: copilotOptionLabel }] : []),
              ...models.map((m) => ({ value: m, label: m })),
            ]}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={importingSpaces} onClick={() => setSpacesImport(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={importingSpaces || !importTargetId.trim()}
              leadingIcon={importingSpaces ? <SpinnerGapIcon size={13} className="animate-spin" /> : <CloudArrowDownIcon size={13} />}
              onClick={() => void runSpacesImport()}
            >
              {importingSpaces ? (spacesImport?.channelFirst ? "Fetching…" : "Importing…") : spacesImport?.channelFirst ? "Fetch" : "Import"}
            </Button>
          </div>
        </div>
      </Dialog>


      {/* ── New folder dialog ── */}
      <Dialog open={folderDialog} onOpenChange={setFolderDialog} title="New folder">
        <div className="flex flex-col gap-3">
          <input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleCreateFolder()}
            placeholder="Folder name"
            autoFocus
            className="h-9 rounded-lg border border-xyne-border bg-xyne-surface px-3 text-[13px] text-xyne-fg-primary outline-none focus:border-xyne-border-focus"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFolderDialog(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!folderName.trim()} onClick={() => void handleCreateFolder()}>
              Create
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ── Import dialog ── */}
      <Dialog
        open={importDialog}
        onOpenChange={setImportDialog}
        title={`Add conversations to ${folders.find((f) => f.id === importFolderId)?.name ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-[12px] text-xyne-fg-secondary">
            <DownloadSimpleIcon size={14} />
            <span>Upload a .json / .jsonl file</span>
            <input
              type="file"
              accept=".json,.jsonl,application/json,text/plain"
              onChange={(e) => e.target.files?.[0] && onFileChosen(e.target.files[0])}
              className="text-[11px]"
            />
          </label>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            className="h-56 resize-none rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 py-2 font-mono text-[12px] text-xyne-fg-primary outline-none focus:border-xyne-border-focus"
          />
          {importPreview &&
            ("error" in importPreview ? (
              <span className="text-[11px] text-xyne-error">⚠ {importPreview.error}</span>
            ) : (
              <span className="text-[11px] text-xyne-success">
                ✓ {importPreview.conversations.length} conversation
                {importPreview.conversations.length === 1 ? "" : "s"},{" "}
                {importPreview.conversations.reduce((n, c) => n + c.turns.length, 0)} turns
              </span>
            ))}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImportDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={importing || !importPreview || "error" in (importPreview ?? {})}
              onClick={() => void handleImport()}
            >
              {importing ? "Importing…" : "Import"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/* ── Project report ── */
/** High-level, numbers-only scorecard for a project (folder): overall score →
 *  per-conversation avg (expandable) → per-turn score. Shows results only, no
 *  message text — drill into a conversation (↗) for the full expected/generated
 *  view. */
/** Compact score: a thin fill bar + the number, color-coded. */
function ScoreBar({ score }: { score: number | null }) {
  if (score == null) return <span className="w-[88px] shrink-0 text-right text-[12px] text-xyne-fg-tertiary">—</span>;
  const bar = score >= 80 ? "bg-xyne-success" : score >= 50 ? "bg-amber-500" : "bg-xyne-error";
  const txt = score >= 80 ? "text-xyne-success" : score >= 50 ? "text-amber-600 dark:text-amber-400" : "text-xyne-error";
  return (
    <span className="flex w-[88px] shrink-0 items-center justify-end gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-xyne-surface-sunken">
        <span className={`block h-full rounded-full ${bar}`} style={{ width: `${score}%` }} />
      </span>
      <span className={`w-6 text-right text-[12px] font-semibold tabular-nums ${txt}`}>{score}</span>
    </span>
  );
}

function ProjectReport({
  folderName,
  convItems,
  results,
  judgeOptions,
  activeJudgeId,
  onSelectJudge,
  scoringActive,
  scoringConvIds,
  canScore,
  onScore,
  onOpenConv,
  onClose,
}: {
  folderName: string;
  convItems: EvalConversationListItem[];
  results: Record<string, LiveTurn>;
  /** Judge×model view options (value = scoreForJudge key, label = "name · model"). */
  judgeOptions: Array<{ value: string; label: string }>;
  activeJudgeId: string;
  onSelectJudge: (id: string) => void;
  scoringActive: boolean;
  scoringConvIds: Set<string> | null;
  canScore: boolean;
  onScore: () => void;
  onOpenConv: (id: string) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    return convItems.map((conv) => {
      const turns = Object.entries(results)
        .filter(([k]) => k.startsWith(`${conv.id}::`))
        .map(([k, v]) => ({ idx: Number(k.split("::")[1]), score: v.matchScore, failed: !!v.judgeFailed }))
        .sort((a, b) => a.idx - b.idx);
      const judged = turns.filter((t) => typeof t.score === "number") as Array<{ idx: number; score: number; failed: boolean }>;
      const failedCount = turns.filter((t) => typeof t.score !== "number" && t.failed).length;
      // Failed-to-score turns drag the average as 0s — same rule as the headline.
      const denom = judged.length + failedCount;
      const avg = denom ? Math.round(judged.reduce((s, t) => s + t.score, 0) / denom) : null;
      return { conv, turns, avg, failedCount };
    });
  }, [convItems, results]);

  const { overall, dist } = useMemo(() => {
    const allTurns = rows.flatMap((r) => r.turns);
    const scores = allTurns.map((t) => t.score).filter((s): s is number => typeof s === "number");
    const errored = allTurns.filter((t) => typeof t.score !== "number" && t.failed).length;
    const good = scores.filter((s) => s >= 80).length;
    const weak = scores.filter((s) => s >= 50 && s < 80).length;
    // A turn that scored < 50 OR that the judge couldn't score → both count as fail,
    // and errored turns count as 0 in the average (no lucky-one-turn 95 headlines).
    const fail = scores.filter((s) => s < 50).length + errored;
    const total = scores.length + errored;
    return {
      overall: total ? Math.round(scores.reduce((s, n) => s + n, 0) / total) : null,
      dist: { good, weak, fail, total },
    };
  }, [rows]);

  const overallTxt = overall == null ? "text-xyne-fg-tertiary" : overall >= 80 ? "text-xyne-success" : overall >= 50 ? "text-amber-600 dark:text-amber-400" : "text-xyne-error";

  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-xyne-border-subtle px-5">
        <div className="flex min-w-0 items-center gap-2">
          <ChartBarIcon size={15} weight="fill" className="shrink-0 text-xyne-brand" />
          <h2 className="truncate text-[14px] font-semibold text-xyne-fg-primary">{folderName}</h2>
          <span className="text-[11px] text-xyne-fg-tertiary">· Report</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {judgeOptions.length > 0 && (
            <select
              value={activeJudgeId}
              onChange={(e) => onSelectJudge(e.target.value)}
              title="Which judge's scores to show"
              className="h-7 rounded-md border border-xyne-border bg-xyne-surface px-2 text-[11px] text-xyne-fg-secondary outline-none focus:border-xyne-border-focus"
            >
              {judgeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {canScore && (
            <Button size="sm" variant="secondary" leadingIcon={<ScalesIcon size={13} />} onClick={onScore}>
              Score
            </Button>
          )}
          <button onClick={onClose} title="Close report" className="text-xyne-fg-tertiary hover:text-xyne-fg-primary">
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto max-w-2xl">
          {/* Summary card */}
          <div className="mb-5 flex items-center justify-between rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-5 py-4">
            <div>
              <div className="flex items-baseline gap-1">
                <span className={`text-[30px] font-bold leading-none ${overallTxt}`}>{overall ?? "—"}</span>
                <span className="text-[13px] text-xyne-fg-tertiary">/100</span>
              </div>
              <div className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-xyne-fg-tertiary">average match</div>
            </div>
            <div className="text-right">
              <div className="text-[12px] text-xyne-fg-secondary">
                {rows.length} conversation{rows.length === 1 ? "" : "s"}
              </div>
              {dist.total > 0 && (
                <div className="mt-2 flex h-1.5 w-44 overflow-hidden rounded-full bg-xyne-surface-sunken">
                  <span className="bg-xyne-success" style={{ width: `${(dist.good / dist.total) * 100}%` }} />
                  <span className="bg-amber-500" style={{ width: `${(dist.weak / dist.total) * 100}%` }} />
                  <span className="bg-xyne-error" style={{ width: `${(dist.fail / dist.total) * 100}%` }} />
                </div>
              )}
              {dist.total > 0 && (
                <div className="mt-2 flex justify-end gap-3 text-[10px] text-xyne-fg-tertiary">
                  <span className="text-xyne-success">{dist.good} good</span>
                  <span className="text-amber-600 dark:text-amber-400">{dist.weak} weak</span>
                  <span className="text-xyne-error">{dist.fail} fail</span>
                </div>
              )}
            </div>
          </div>

          {/* Conversation list */}
          {rows.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-xyne-fg-tertiary">No conversations in this project.</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {rows.map(({ conv, turns, avg, failedCount }) => {
                const isOpen = expanded.has(conv.id);
                return (
                  <div key={conv.id}>
                    <div className="group flex items-center gap-2 rounded-lg px-3 py-2 transition hover:bg-xyne-surface-subtle">
                      <button
                        onClick={() =>
                          setExpanded((s) => {
                            const n = new Set(s);
                            n.has(conv.id) ? n.delete(conv.id) : n.add(conv.id);
                            return n;
                          })
                        }
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className="shrink-0 text-xyne-fg-tertiary">
                          {isOpen ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}
                        </span>
                        <span className="truncate text-[13px] text-xyne-fg-primary">{conv.title}</span>
                      </button>
                      {scoringActive && (!scoringConvIds || scoringConvIds.has(conv.id)) ? (
                        <SpinnerGapIcon size={13} className="shrink-0 animate-spin text-blue-500" />
                      ) : avg == null && failedCount > 0 ? (
                        <span className="shrink-0 text-[11px] font-medium text-xyne-error" title="Judge couldn't score (e.g. rate-limited)">
                          fail
                        </span>
                      ) : (
                        <ScoreBar score={avg} />
                      )}
                      <button
                        onClick={() => onOpenConv(conv.id)}
                        title="Open conversation detail"
                        className="shrink-0 text-xyne-fg-tertiary opacity-0 transition hover:text-xyne-fg-primary group-hover:opacity-100"
                      >
                        <ArrowUpRightIcon size={14} />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="flex flex-col gap-1.5 py-1.5 pl-9 pr-3">
                        {turns.length === 0 ? (
                          <span className="text-[11px] text-xyne-fg-tertiary">No results yet.</span>
                        ) : (
                          turns.map((t) => (
                            <div key={t.idx} className="flex items-center justify-between">
                              <span className="text-[11px] text-xyne-fg-tertiary">Message {t.idx + 1}</span>
                              {typeof t.score !== "number" && t.failed ? (
                                <span className="text-[11px] font-medium text-xyne-error">fail</span>
                              ) : (
                                <ScoreBar score={typeof t.score === "number" ? t.score : null} />
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Run comparison (regression) ── */
function Delta({ a, b }: { a: number | null; b: number | null }) {
  if (typeof a !== "number" || typeof b !== "number")
    return <span className="w-12 shrink-0 text-right text-[11px] text-xyne-fg-tertiary">—</span>;
  const d = b - a;
  const cls = d > 0 ? "text-xyne-success" : d < 0 ? "text-xyne-error" : "text-xyne-fg-tertiary";
  return (
    <span className={`w-12 shrink-0 text-right text-[12px] font-semibold tabular-nums ${cls}`}>
      {d > 0 ? "+" : ""}
      {d}
    </span>
  );
}

function CompareView({
  folderName,
  folderId,
  convItems,
  onOpenConv,
  onClose,
}: {
  folderName: string;
  folderId: string;
  convItems: EvalConversationListItem[];
  onOpenConv: (id: string) => void;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<GenerationMeta[]>([]);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [a, setA] = useState<EvalGeneration | null>(null);
  const [b, setB] = useState<EvalGeneration | null>(null);

  useEffect(() => {
    listGenerationsForFolder(folderId)
      .then((rs) => {
        setRuns(rs);
        if (rs.length >= 2) {
          setBId(rs[0]!.id);
          setAId(rs[1]!.id);
        } else if (rs.length === 1) setBId(rs[0]!.id);
      })
      .catch(() => {});
  }, [folderId]);
  useEffect(() => {
    if (aId) getGeneration(aId).then(setA).catch(() => setA(null));
    else setA(null);
  }, [aId]);
  useEffect(() => {
    if (bId) getGeneration(bId).then(setB).catch(() => setB(null));
    else setB(null);
  }, [bId]);

  const titleById = useMemo(() => new Map(convItems.map((c) => [c.id, c.title])), [convItems]);
  const runLabel = (r: GenerationMeta) =>
    `${r.agentSlug}${r.genModel ? ` · ${r.genModel}` : ""} · ${new Date(r.startedAt).toLocaleDateString()} ${new Date(r.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  const { rows, summary } = useMemo(() => {
    const scoreMap = (run: EvalGeneration | null) => {
      const m = new Map<string, number | null>();
      for (const t of run?.turnResults ?? []) m.set(`${t.conversationId}::${t.turnIndex}`, t.matchScore ?? null);
      return m;
    };
    const ma = scoreMap(a);
    const mb = scoreMap(b);
    const keys = [...new Set([...ma.keys(), ...mb.keys()])];
    const byConv = new Map<string, Array<{ idx: number; a: number | null; b: number | null }>>();
    for (const k of keys) {
      const [cid, idxs] = k.split("::");
      const arr = byConv.get(cid!) ?? [];
      arr.push({ idx: Number(idxs), a: ma.get(k) ?? null, b: mb.get(k) ?? null });
      byConv.set(cid!, arr);
    }
    const rows = [...byConv.entries()]
      .map(([cid, turns]) => ({ cid, title: titleById.get(cid) ?? cid, turns: turns.sort((x, y) => x.idx - y.idx) }))
      .sort((x, y) => x.title.localeCompare(y.title));
    let sa = 0;
    let sb = 0;
    let n = 0;
    for (const k of keys) {
      const av = ma.get(k);
      const bv = mb.get(k);
      if (typeof av === "number" && typeof bv === "number") {
        sa += av;
        sb += bv;
        n++;
      }
    }
    const avgA = n ? Math.round(sa / n) : null;
    const avgB = n ? Math.round(sb / n) : null;
    return { rows, summary: { avgA, avgB, n, delta: avgA != null && avgB != null ? avgB - avgA : null } };
  }, [a, b, titleById]);

  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-xyne-border-subtle px-5">
        <div className="flex min-w-0 items-center gap-2">
          <ScalesIcon size={15} weight="fill" className="shrink-0 text-xyne-brand" />
          <h2 className="truncate text-[14px] font-semibold text-xyne-fg-primary">{folderName}</h2>
          <span className="text-[11px] text-xyne-fg-tertiary">· Compare runs</span>
        </div>
        <button onClick={onClose} title="Close" className="text-xyne-fg-tertiary hover:text-xyne-fg-primary">
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto max-w-2xl">
          {runs.length < 2 ? (
            <div className="py-10 text-center text-[12px] text-xyne-fg-tertiary">Need at least two runs to compare. Run this project again.</div>
          ) : (
            <>
              {/* Run pickers */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <SelectField
                  label="Baseline (A)"
                  placeholder="Search runs…"
                  value={aId}
                  onValueChange={(v) => setAId(v ?? "")}
                  options={runs.map((r) => ({ value: r.id, label: runLabel(r) }))}
                />
                <SelectField
                  label="New (B)"
                  placeholder="Search runs…"
                  value={bId}
                  onValueChange={(v) => setBId(v ?? "")}
                  options={runs.map((r) => ({ value: r.id, label: runLabel(r) }))}
                />
              </div>

              {/* Summary */}
              <div className="mb-4 flex items-center justify-center gap-4 rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-5 py-4">
                <ScoreBar score={summary.avgA} />
                <span className="text-xyne-fg-tertiary">→</span>
                <ScoreBar score={summary.avgB} />
                {summary.delta != null && (
                  <span
                    className={`rounded px-2 py-0.5 text-[13px] font-bold ${
                      summary.delta > 0 ? "bg-xyne-success/15 text-xyne-success" : summary.delta < 0 ? "bg-xyne-error/15 text-xyne-error" : "text-xyne-fg-tertiary"
                    }`}
                  >
                    {summary.delta > 0 ? "+" : ""}
                    {summary.delta}
                  </span>
                )}
                <span className="text-[11px] text-xyne-fg-tertiary">avg over {summary.n} turn{summary.n === 1 ? "" : "s"}</span>
              </div>

              {/* Per-conversation/turn deltas */}
              <div className="mb-2 flex items-center gap-2 px-3 text-[10px] font-medium uppercase tracking-wide text-xyne-fg-tertiary">
                <span className="flex-1">Conversation / turn</span>
                <span className="w-[88px] text-right">A</span>
                <span className="w-[88px] text-right">B</span>
                <span className="w-12 text-right">Δ</span>
                <span className="w-4" />
              </div>
              <div className="flex flex-col gap-2">
                {rows.map((row) => (
                  <div key={row.cid} className="rounded-lg border border-xyne-border-subtle">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="flex-1 truncate text-[12.5px] text-xyne-fg-primary">{row.title}</span>
                      <button
                        onClick={() => onOpenConv(row.cid)}
                        title="Open conversation"
                        className="shrink-0 text-xyne-fg-tertiary hover:text-xyne-fg-primary"
                      >
                        <ArrowUpRightIcon size={13} />
                      </button>
                    </div>
                    <div className="flex flex-col gap-1 border-t border-xyne-border-subtle px-3 py-2">
                      {row.turns.map((t) => (
                        <div key={t.idx} className="flex items-center gap-2">
                          <span className="flex-1 text-[11px] text-xyne-fg-tertiary">Message {t.idx + 1}</span>
                          <ScoreBar score={t.a} />
                          <ScoreBar score={t.b} />
                          <Delta a={t.a} b={t.b} />
                          <span className="w-4" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Tree ── */
interface TreeCtx {
  foldersById: Map<string, EvalFolder>;
  expanded: Set<string>;
  folderConvs: Record<string, FolderState>;
  checked: Set<string>;
  results: Record<string, LiveTurn>;
  openConvId: string | null;
  toggleFolder: (id: string) => void;
  onSelectConv: (id: string) => void;
  onToggleCheck: (id: string, on: boolean) => void;
  onRunFolder: (id: string) => void;
  onRunOne: (id: string) => void;
  onAddConversations: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onDeleteConv: (id: string, folderId: string) => void;
  onLoadMore: (id: string) => void;
  /** Folders that have a run to score (latest run id known). */
  runIdByFolder: Record<string, string>;
  onJudgeFolder: (id: string) => void;
  onOpenReport: (id: string) => void;
  onImportFromSpaces: (id: string) => void;
  onCompareRuns: (id: string) => void;
  reportFolderId: string | null;
  runningFolders: Set<string>;
  submittingRun: boolean;
  scoringFolderId: string | null;
  scoringConvIds: Set<string> | null;
}

/** Tree connector guides: one cell per ancestor (vertical line if that ancestor
 *  has more siblings below) + this node's elbow (└) or tee (├). */
function Guides({ ancestors, isLast }: { ancestors: boolean[]; isLast: boolean }) {
  return (
    // 12px lead-in so the first connector lands under the parent folder's icon
    // (caret + icon offset), not under the caret.
    <span className="flex shrink-0 self-stretch pl-[12px]" aria-hidden>
      {ancestors.map((cont, i) => (
        <span key={i} className="relative w-[15px]">
          {cont && <span className="absolute left-[7px] bottom-0 top-0 border-l border-xyne-border-strong" />}
        </span>
      ))}
      <span className="relative w-[15px]">
        <span className={`absolute left-[7px] top-0 border-l border-xyne-border-strong ${isLast ? "h-1/2" : "bottom-0"}`} />
        <span className="absolute left-[7px] right-[2px] top-1/2 border-t border-xyne-border-strong" />
      </span>
    </span>
  );
}

function FolderNode({ folderId, ctx }: { folderId: string; ctx: TreeCtx }) {
  const folder = ctx.foldersById.get(folderId);
  const isOpen = ctx.expanded.has(folderId);
  const state = ctx.folderConvs[folderId];
  const count = folder?._count?.conversations ?? 0;
  const canJudge = !!ctx.runIdByFolder[folderId];

  // Project-level overview: average judge score across this folder's loaded
  // conversations (the "top-level report").
  const folderSummary = useMemo(() => {
    const convIds = new Set((state?.items ?? []).map((c) => c.id));
    const turns = Object.entries(ctx.results)
      .filter(([k]) => convIds.has(k.split("::")[0]!))
      .map(([, v]) => v);
    return summarizeTurns(turns);
  }, [state, ctx.results]);

  // Conversations indent one level under their folder; the single ancestor
  // column is blank (folders no longer nest).
  const childAncestors = [false];

  type Row =
    | { kind: "conv"; key: string; item: EvalConversationListItem }
    | { kind: "more"; key: string }
    | { kind: "empty"; key: string };
  const rows: Row[] = (state?.items ?? []).map((c): Row => ({ kind: "conv", key: c.id, item: c }));
  if (state && state.items.length < state.total) rows.push({ kind: "more", key: "__more" });
  if (state && state.items.length === 0) rows.push({ kind: "empty", key: "__empty" });

  return (
    <div>
      {/* Folder row */}
      <div className="group flex items-stretch hover:bg-xyne-surface-subtle">
        <div className="flex min-w-0 flex-1 items-center gap-1 py-1.5 pl-2 pr-2">
          <button onClick={() => ctx.toggleFolder(folderId)} className="flex h-4 w-4 shrink-0 items-center justify-center text-xyne-fg-tertiary">
            {isOpen ? <CaretDownIcon size={11} /> : <CaretRightIcon size={11} />}
          </button>
          <button onClick={() => ctx.toggleFolder(folderId)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            {isOpen ? (
              <FolderOpenIcon size={14} className="shrink-0 text-xyne-fg-secondary" />
            ) : (
              <FolderIcon size={14} className="shrink-0 text-xyne-fg-secondary" />
            )}
            <span className="truncate text-[12.5px] font-medium text-xyne-fg-primary">{folder?.name}</span>
            {count > 0 && <span className="text-[10px] text-xyne-fg-tertiary">{count}</span>}
            {folderSummary.avg != null && (
              <span
                title={`Avg semantic match across ${folderSummary.count} judged turn${folderSummary.count === 1 ? "" : "s"}`}
                className={`rounded px-1 py-0.5 text-[9.5px] font-semibold ${scoreChipClass(folderSummary.avg)}`}
              >
                {folderSummary.avg}
              </span>
            )}
          </button>
          <div className="flex shrink-0 items-center gap-1.5">
            {count > 0 && (
              <button
                onClick={() => ctx.onRunFolder(folderId)}
                disabled={ctx.submittingRun || ctx.runningFolders.has(folderId)}
                title="Run this folder"
                className="opacity-70 transition group-hover:opacity-100"
              >
                <PlayIcon size={13} className="text-xyne-fg-tertiary hover:text-xyne-fg-primary" />
              </button>
            )}
            {canJudge && (
              <button
                onClick={() => ctx.onJudgeFolder(folderId)}
                title="Score this folder (semantic match)"
                className="opacity-70 transition group-hover:opacity-100"
              >
                <ScalesIcon size={13} className="text-xyne-fg-tertiary hover:text-xyne-fg-primary" />
              </button>
            )}
            {canJudge && (
              <button
                onClick={() => ctx.onOpenReport(folderId)}
                title="Open project report"
                className={`transition ${ctx.reportFolderId === folderId ? "opacity-100" : "opacity-70 group-hover:opacity-100"}`}
              >
                <ChartBarIcon
                  size={13}
                  weight={ctx.reportFolderId === folderId ? "fill" : "regular"}
                  className={ctx.reportFolderId === folderId ? "text-xyne-brand" : "text-xyne-fg-tertiary hover:text-xyne-fg-primary"}
                />
              </button>
            )}
            <button
              onClick={() => ctx.onAddConversations(folderId)}
              title="Add conversations (manual)"
              className="opacity-70 transition group-hover:opacity-100"
            >
              <PlusIcon size={13} className="text-xyne-fg-tertiary hover:text-xyne-fg-primary" />
            </button>
            <button
              onClick={() => ctx.onImportFromSpaces(folderId)}
              title="Import from Spaces"
              className="opacity-70 transition group-hover:opacity-100"
            >
              <CloudArrowDownIcon size={13} className="text-xyne-fg-tertiary hover:text-xyne-fg-primary" />
            </button>
            <KebabMenu
              items={[
                ...(canJudge ? [{ label: "Compare runs", onClick: () => ctx.onCompareRuns(folderId) }] : []),
                { label: "Delete folder", onClick: () => ctx.onDeleteFolder(folderId) },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Children */}
      {isOpen &&
        rows.map((row, i) => {
          const last = i === rows.length - 1;
          if (row.kind === "conv") {
            return <ConvRow key={row.key} conv={row.item} folderId={folderId} ancestors={childAncestors} isLast={last} ctx={ctx} />;
          }
          if (row.kind === "more") {
            return (
              <div key={row.key} className="flex items-stretch">
                <Guides ancestors={childAncestors} isLast={last} />
                <button
                  onClick={() => ctx.onLoadMore(folderId)}
                  className="py-1 text-[11px] text-xyne-fg-tertiary hover:text-xyne-fg-primary"
                >
                  Show {state ? Math.min(FOLDER_PAGE, state.total - state.items.length) : 0} more…
                </button>
              </div>
            );
          }
          return (
            <div key={row.key} className="flex items-stretch">
              <Guides ancestors={childAncestors} isLast={last} />
              <div className="py-1.5 text-[11px] text-xyne-fg-tertiary">
                Empty — use <span className="font-medium">+</span> to add conversations.
              </div>
            </div>
          );
        })}
    </div>
  );
}

function ConvRow({
  conv,
  folderId: _folderId,
  ancestors,
  isLast,
  ctx,
}: {
  conv: EvalConversationListItem;
  folderId: string;
  ancestors: boolean[];
  isLast: boolean;
  ctx: TreeCtx;
}) {
  const beingScored = ctx.scoringFolderId === _folderId && (!ctx.scoringConvIds || ctx.scoringConvIds.has(conv.id));
  const st = beingScored ? "running" : convStatusFrom(ctx.results, conv.id);
  const sel = ctx.checked.has(conv.id);
  return (
    <div
      className={`group flex items-stretch ${
        ctx.openConvId === conv.id ? "bg-xyne-surface-sunken" : sel ? "bg-xyne-brand/5" : "hover:bg-xyne-surface-subtle"
      }`}
    >
      <Guides ancestors={ancestors} isLast={isLast} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            ctx.onToggleCheck(conv.id, !sel);
          }}
          title={sel ? "Deselect" : "Select"}
          className="shrink-0"
        >
          {sel ? (
            <CheckSquareIcon size={15} weight="fill" className="text-xyne-brand" />
          ) : (
            <SquareIcon size={15} className="text-xyne-fg-tertiary hover:text-xyne-fg-secondary" />
          )}
        </button>
        <button onClick={() => ctx.onSelectConv(conv.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[12px] text-xyne-fg-primary">{conv.title}</span>
        </button>
        {/* Only transient activity is shown in the tree — outcomes live in the
            report, so no persistent ✓/✕ noise on every row. A conversation the
            active run hasn't reached yet shows a dimmed spinner (queued). */}
        {st === "running" ? (
          <MiniStatus status="running" />
        ) : ctx.runningFolders.has(_folderId) && st === "idle" ? (
          <span className="opacity-40">
            <MiniStatus status="running" />
          </span>
        ) : null}
        <KebabMenu items={[{ label: "Run", onClick: () => ctx.onRunOne(conv.id) }]} />
      </div>
    </div>
  );
}

/* ── Kebab (⋮) menu ── */
function KebabMenu({ items }: { items: Array<{ label: string; danger?: boolean; onClick: () => void }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-5 w-5 items-center justify-center rounded text-xyne-fg-tertiary opacity-0 transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary group-hover:opacity-100 data-[open=true]:opacity-100"
        data-open={open}
        title="More"
      >
        <DotsThreeVerticalIcon size={15} weight="bold" />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-30 cursor-default" aria-hidden onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 z-40 mt-1 min-w-[130px] overflow-hidden rounded-lg border border-xyne-border bg-white py-1 shadow-lg dark:bg-xyne-surface">
            {items.map((it, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onClick();
                }}
                className={`block w-full px-3 py-1.5 text-left text-[12px] ${
                  it.danger
                    ? "text-xyne-error hover:bg-xyne-error/10"
                    : "text-xyne-fg-secondary hover:bg-xyne-surface-subtle"
                }`}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Status pills ── */
function MiniStatus({ status }: { status: TurnStatus }) {
  if (status === "running") return <SpinnerGapIcon size={12} className="shrink-0 animate-spin text-blue-500" />;
  if (status === "completed") return <CheckCircleIcon size={12} weight="fill" className="shrink-0 text-xyne-success" />;
  if (status === "failed") return <XCircleIcon size={12} weight="fill" className="shrink-0 text-xyne-error" />;
  return <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-xyne-border-strong" />;
}

/* ── Turn: clean two-column comparison (no boxes) ── */
function TurnCard({
  index,
  message,
  expected,
  live,
}: {
  index: number;
  message: string;
  expected: string | null;
  live?: LiveTurn;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const status = live?.status ?? "idle";
  const answer = live?.answer ?? "";
  const reasoning = live?.reasoning ?? "";
  const tools = live?.tools ?? [];
  const matchScore = live?.matchScore ?? null;
  const judgeReasoning = live?.judgeReasoning ?? "";

  return (
    <div className="border-b border-xyne-border-subtle py-4 first:pt-1 last:border-b-0">
      {/* Header row: caret + M{n} + one-line title are the toggle; score + status
          sit outside it (so the score's info button isn't nested in a button). */}
      <div className="flex w-full items-center gap-2">
        <button onClick={() => setCollapsed((c) => !c)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="shrink-0 text-xyne-fg-tertiary">
            {collapsed ? <CaretRightIcon size={12} /> : <CaretDownIcon size={12} />}
          </span>
          <span className="shrink-0 rounded bg-xyne-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold text-xyne-fg-tertiary">
            M{index + 1}
          </span>
          <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-xyne-fg-primary">
            {collapsed ? turnTitle(message) : null}
          </div>
        </button>
        {matchScore != null && (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${scoreChipClass(matchScore)}`}>
              {matchScore}
            </span>
            {judgeReasoning && (
              <button
                onClick={() => setShowWhy(true)}
                title="Why this score?"
                className="text-xyne-fg-tertiary hover:text-xyne-fg-primary"
              >
                <InfoIcon size={14} />
              </button>
            )}
          </span>
        )}
        <StatusDot status={status} />
      </div>

      {/* Expanded: full query, then Expected vs Generated side by side. */}
      {!collapsed && (
        <div className="mt-3 space-y-4 pl-[26px]">
          <div>
            <div className="mb-1.5 text-[13px] font-bold tracking-tight text-xyne-fg-primary">Query</div>
            <div className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[12.5px] leading-relaxed text-xyne-fg-secondary">{message}</div>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <div className="min-w-0 md:border-r md:border-xyne-border-subtle md:pr-6">
              <div className="mb-1.5 text-[13px] font-bold tracking-tight text-xyne-fg-primary">Expected</div>
              {expected ? (
                <EvalMarkdown tone="secondary">{expected}</EvalMarkdown>
              ) : (
                <span className="text-[12.5px] text-xyne-fg-tertiary">—</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="mb-1.5 text-[13px] font-bold tracking-tight text-xyne-fg-primary">Generated · Claw</div>
              {answer ? (
                <EvalMarkdown tone="primary">{answer}</EvalMarkdown>
              ) : (
                <span className="text-[12.5px] text-xyne-fg-tertiary">{status === "running" ? "…" : "—"}</span>
              )}
              {(reasoning || tools.length > 0) && <GeneratedMeta reasoning={reasoning} tools={tools} />}
            </div>
          </div>
        </div>
      )}

      <Dialog open={showWhy} onOpenChange={setShowWhy} title="Why this score?">
        <div className="flex flex-col gap-3">
          {matchScore != null && (
            <span className={`self-start rounded px-2 py-0.5 text-[13px] font-semibold ${scoreChipClass(matchScore)}`}>
              {matchScore}/100
            </span>
          )}
          <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">{judgeReasoning}</p>
        </div>
      </Dialog>
    </div>
  );
}

function GeneratedMeta({ reasoning, tools }: { reasoning: string; tools: ToolInvocation[] }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [showTools, setShowTools] = useState(false);
  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {reasoning && (
          <button
            onClick={() => setShowReasoning((s) => !s)}
            className="flex items-center gap-1 text-[11px] text-xyne-fg-tertiary hover:text-xyne-fg-primary"
          >
            {showReasoning ? <CaretDownIcon size={11} /> : <CaretRightIcon size={11} />}
            Reasoning
          </button>
        )}
        {tools.length > 0 && (
          <button
            onClick={() => setShowTools((s) => !s)}
            className="flex items-center gap-1 text-[11px] text-xyne-fg-tertiary hover:text-xyne-fg-primary"
          >
            {showTools ? <CaretDownIcon size={11} /> : <CaretRightIcon size={11} />}
            <WrenchIcon size={11} /> {tools.length} tool{tools.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
      {showReasoning && reasoning && (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-xyne-surface-sunken px-3 py-2 font-mono text-[11px] leading-relaxed text-xyne-fg-secondary">
          {reasoning}
        </pre>
      )}
      {showTools && tools.length > 0 && (
        <div className="flex flex-col gap-1">
          {tools.map((inv, i) => (
            <ToolRow key={inv.toolCallId ?? i} inv={inv} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: TurnStatus }) {
  if (status === "running") return <SpinnerGapIcon size={13} className="mt-0.5 shrink-0 animate-spin text-blue-500" />;
  if (status === "completed") return <CheckCircleIcon size={13} weight="fill" className="mt-0.5 shrink-0 text-xyne-success" />;
  if (status === "failed") return <XCircleIcon size={13} weight="fill" className="mt-0.5 shrink-0 text-xyne-error" />;
  return <span className="mt-1.5 h-[6px] w-[6px] shrink-0 rounded-full bg-xyne-border-strong" />;
}

function ToolRow({ inv }: { inv: ToolInvocation }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-sunken">
      <button onClick={() => setOpen((s) => !s)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        {open ? <CaretDownIcon size={11} /> : <CaretRightIcon size={11} />}
        <span className="font-mono text-[11px] font-medium text-xyne-fg-primary">{inv.toolName}</span>
        {inv.subagentName && <Badge as="span" label={inv.subagentName} variant="neutral" size="sm" />}
        {inv.isError && <Badge as="span" label="error" variant="error" size="sm" />}
        {inv.status === "running" && <SpinnerGapIcon size={11} className="animate-spin text-blue-500" />}
        {typeof inv.durationMs === "number" && inv.durationMs > 0 && (
          <span className="ml-auto text-[10px] text-xyne-fg-tertiary">{inv.durationMs}ms</span>
        )}
      </button>
      {open && (
        <div className="border-t border-xyne-border-subtle px-2.5 py-2">
          <div className="mb-0.5 text-[10px] font-semibold uppercase text-xyne-fg-tertiary">Args</div>
          <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-xyne-surface px-2 py-1 font-mono text-[10px] text-xyne-fg-secondary">
            {safeJson(inv.args)}
          </pre>
          <div className="mb-0.5 text-[10px] font-semibold uppercase text-xyne-fg-tertiary">Result</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-xyne-surface px-2 py-1 font-mono text-[10px] text-xyne-fg-secondary">
            {typeof inv.result === "string" ? inv.result : safeJson(inv.result)}
          </pre>
        </div>
      )}
    </div>
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
