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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FolderIcon,
  FolderOpenIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretLeftIcon,
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
  ClockCounterClockwiseIcon,
  ChartBarIcon,
  InfoIcon,
  ArrowUpRightIcon,
  CloudArrowDownIcon,
  BugIcon,
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
  judgeComparison,
  listEvalModels,
  getGeneration,
  getComparison,
  importEvalFromSpaces,
  importEvalFromSpacesChannel,
  listEvalSpacesChannels,
  getEvalImportJob,
  cancelEvalImportJob,
  startBackgroundGeneration,
  listEvalGenModels,
  listChatLitellmModels,
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
  type EvalTurnResult,
  type ToolInvocation,
} from "../../lib/api";
import type { AgentLight } from "../../lib/types";
import { useBackgroundJob } from "../hooks/useBackgroundJob";
import { DebugDrawer } from "../../components/DebugDrawer";
import {
  CitationMarkdown,
  CitationPanel,
  parseInvocationCitationChunks,
  buildCitationKeyAliases,
  citedChunksFor,
  type CitationRef,
  type CitationSelection,
  type CitationLookup,
} from "./ChatPageV3";
import { EVAL_CSV_HEADERS, buildCsv, downloadCsv, mapPool, safeFilename, type CsvValue } from "../utils/csvExport";

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
  /** Claw run/conversation ids for the "Debug this response" drawer, plus the
   *  RUN's agent (the live picker's agentSlug can change after a run). Populated
   *  from persisted turn results; absent until the turn finalizes. */
  sessionId?: string | null;
  clawConversationId?: string | null;
  agentSlug?: string | null;
}

/** Max agents that can be compared in one run. */
const MAX_COMPARE_AGENTS = 3;

/** One agent participating in a folder's latest run/comparison (a single-agent
 *  run is just a comparison of one). */
interface AgentRun {
  slug: string;
  name: string;
  runId: string;
  /** Human label for the pinned generation model (e.g. "copilot · gpt-4o"), "" if default. */
  genLabel: string;
}

/** The latest run for a folder: 1-3 sibling agent runs sharing a comparisonId. */
interface FolderComparison {
  comparisonId: string | null;
  agents: AgentRun[];
}

/** A row in the Run dialog's agent picker: which agent + its own generation-model
 *  choice (same encoding as the legacy single genChoice). */
interface RunAgentSpec {
  slug: string;
  genChoice: string;
}

/** One agent's answer for a single turn, ready to render as a panel. */
interface TurnAgentPane {
  slug: string;
  name: string;
  live: LiveTurn | undefined;
}

/** Merge a run's persisted turn results into a per-(conv,turn) map without
 *  clobbering newer in-flight state. Pure — shared by the flat (primary-agent)
 *  and per-agent result maps. */
function mergeTurnsInto(prev: Record<string, LiveTurn>, run: EvalGeneration): Record<string, LiveTurn> {
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
      sessionId: tr.sessionId ?? cur?.sessionId ?? null,
      clawConversationId: tr.clawConversationId ?? cur?.clawConversationId ?? null,
      agentSlug: run.agentSlug ?? cur?.agentSlug ?? null,
    };
  }
  return next;
}

/** One CSV row for an eval turn: conversation label, 1-based turn number,
 *  question, expected, claw response, and the cited chunks (numbered). */
function evalCsvRow(
  convLabel: string,
  turnIdx: number,
  question: string,
  expected: string | null | undefined,
  answer: string,
  tools: ToolInvocation[],
): CsvValue[] {
  return [convLabel, turnIdx + 1, question, expected ?? "", answer, citedChunksFor(answer, tools)];
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
function EvalMarkdown({ children, tone = "primary", invocations, onOpenCitation, selectedCitationKey = null }: { children: string; tone?: "primary" | "secondary"; invocations?: ToolInvocation[]; onOpenCitation?: (citation: CitationRef, citationNumber: number, numbers: Map<string, number>) => void; selectedCitationKey?: string | null }) {
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
      {invocations
        ? (
          // Generated answers carry inline [clf-…] citation tokens; render them
          // as numbered chips (same renderer as chat). filterUnknownCitations
          // is off so a token is never silently dropped when the eval turn's
          // captured tool invocations don't line up. No side panel (Phase A).
          <CitationMarkdown
            content={children}
            invocations={invocations}
            selectedCitationKey={selectedCitationKey}
            onOpenCitation={onOpenCitation ?? (() => {})}
            filterUnknownCitations={false}
          />
        )
        : <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>}
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
  // When set, the detail pane shows the run-history view for a folder (every past
  // run, each individually scorable — not just the latest).
  const [historyFolderId, setHistoryFolderId] = useState<string | null>(null);

  const [agents, setAgents] = useState<AgentLight[]>([]);
  const [agentSlug, setAgentSlug] = useState("");
  // Run dialog: up to MAX_COMPARE_AGENTS agents to compare, each with its own
  // generation-model choice. genChoice encodings: "" = default, "prov:<provider>"
  // = a provider the user configured in claw, "spaces:<model>" = platform LiteLLM,
  // "litellm:<model>" = a model off THAT agent's shared LiteLLM key.
  const [runAgents, setRunAgents] = useState<RunAgentSpec[]>([{ slug: "", genChoice: "" }]);
  const [genModels, setGenModels] = useState<EvalGenModels | null>(null);
  // Per-agent shared LiteLLM models (each agent's own key), fetched reactively
  // while the Run dialog is open. Keyed by agent slug. Distinct from
  // genModels.litellm, which is the platform catalog run on the platform key.
  const [litellmByAgent, setLitellmByAgent] = useState<Record<string, { id: string; name: string }[]>>({});
  // Right-docked, resizable side panels for an eval turn: the "Debug this
  // response" drawer and the citation source panel. Mutually exclusive (one dock
  // slot) — opening one closes the other, mirroring chat. Widths persist under
  // evals-scoped localStorage keys so they don't collide with chat's.
  const [evalDebug, setEvalDebug] = useState<{ agentSlug: string; conversationId: string; sessionId: string } | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<CitationSelection | null>(null);
  const [citationPanelWidth, setCitationPanelWidth] = useState<number>(() => {
    try { const s = localStorage.getItem("evals-citation-panel-width"); return s ? parseInt(s, 10) : 480; } catch { return 480; }
  });
  const [evalDebuggerWidth, setEvalDebuggerWidth] = useState<number>(() => {
    try { const s = localStorage.getItem("evals-debugger-width"); return s ? parseInt(s, 10) : 460; } catch { return 460; }
  });
  const openTurnDebugger = useCallback((t: LiveTurn) => {
    if (!t.sessionId || !t.clawConversationId) return;
    setSelectedCitation(null); // one dock slot — close the citation panel
    setEvalDebug({ agentSlug: t.agentSlug ?? agentSlug, conversationId: t.clawConversationId, sessionId: t.sessionId });
  }, [agentSlug]);
  const handleOpenCitation = useCallback((ref: CitationRef, citationNumber: number, numbers: Map<string, number>) => {
    setEvalDebug(null); // one dock slot — close the debug drawer
    setSelectedCitation({ key: ref.key, ref, citationNumber, numbers });
  }, []);
  // Per-agent variant used by each comparison panel — remembers which agent's
  // citation index a clicked chip resolves against.
  const makeOpenCitation = useCallback(
    (slug: string) => (ref: CitationRef, citationNumber: number, numbers: Map<string, number>) => {
      setEvalDebug(null);
      setCitationAgent(slug);
      setSelectedCitation({ key: ref.key, ref, citationNumber, numbers });
    },
    [],
  );
  const handleCloseCitation = useCallback(() => setSelectedCitation(null), []);
  const handleCitationResizeStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX; const startWidth = citationPanelWidth; let cur = startWidth;
    const onMove = (ev: MouseEvent) => { cur = Math.max(320, Math.min(760, startWidth + (startX - ev.clientX))); setCitationPanelWidth(cur); };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); try { localStorage.setItem("evals-citation-panel-width", String(cur)); } catch { /* ignore */ } };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, [citationPanelWidth]);
  const handleEvalDebuggerResizeStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX; const startWidth = evalDebuggerWidth; let cur = startWidth;
    const onMove = (ev: MouseEvent) => { cur = Math.max(320, Math.min(760, startWidth + (startX - ev.clientX))); setEvalDebuggerWidth(cur); };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); try { localStorage.setItem("evals-debugger-width", String(cur)); } catch { /* ignore */ } };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, [evalDebuggerWidth]);

  // Flat, cross-folder map of the PRIMARY (first) agent's turns — powers the
  // sidebar ticks, the judge view dropdown, and CSV export (all single-agent).
  const [results, setResults] = useState<Record<string, LiveTurn>>({});
  // Every agent's turns, keyed by agent slug then rKey — powers the side-by-side
  // comparison detail + report. The primary agent lives in both maps.
  const [resultsByAgent, setResultsByAgent] = useState<Record<string, Record<string, LiveTurn>>>({});
  // The latest run/comparison per folder (1-3 sibling agent runs). Drives the
  // comparison detail/report views and the judging fan-out.
  const [compareByFolder, setCompareByFolder] = useState<Record<string, FolderComparison>>({});
  // Which agent's citation index a clicked chip resolves against (one dock slot).
  const [citationAgent, setCitationAgent] = useState<string | null>(null);

  // Primary agent's runId per folder (derived) — the existing judge/gate reads
  // key by a single runId; comparison judging fans out via compareByFolder.
  const runIdByFolder = useMemo(() => {
    const m: Record<string, string> = {};
    for (const fid in compareByFolder) {
      const rid = compareByFolder[fid]?.agents[0]?.runId;
      if (rid) m[fid] = rid;
    }
    return m;
  }, [compareByFolder]);

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
    { comparisonId: string | null; agents: AgentRun[]; folderId: string; conversationIds?: string[]; label: string } | null
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
  // Live mirror of "is any generation run in flight" — read synchronously by the
  // one-run-at-a-time guard so conversation-scoped runs (no folderId) are gated
  // too, and without a stale-closure gap.
  const runActiveRef = useRef(false);
  const startRunRef = useRef<(m: { jobId: string; runId: string; folderId?: string; agentSlug?: string; isPrimary?: boolean }) => void>(() => {});
  const startJudgeRef = useRef<
    (m: { jobId: string; runId: string; folderId: string; convScope?: string[]; primaryJudgeId: string; agentSlug?: string; isPrimary?: boolean }) => void
  >(() => {});
  // The judge×model key of an in-flight scoring pass (keeps it selectable in
  // the view dropdown before its first scores land).
  const [inflightJudgeKey, setInflightJudgeKey] = useState<string | null>(null);

  /** Merge a run's persisted turn results into the flat (primary-agent) map —
   *  used only for the folder's first agent, which backs the single-agent
   *  sidebar / judge-dropdown / CSV surfaces. */
  const mergeRunResults = useCallback((run: EvalGeneration) => {
    setResults((prev) => mergeTurnsInto(prev, run));
  }, []);

  /** Merge a run into its own agent slot in the per-agent map (comparison views).
   *  Every agent (including the primary) is merged here. */
  const mergeAgentResults = useCallback((run: EvalGeneration) => {
    setResultsByAgent((prev) => ({ ...prev, [run.agentSlug]: mergeTurnsInto(prev[run.agentSlug] ?? {}, run) }));
  }, []);

  /** Merge every sibling run of a comparison: agent[0] → flat map (primary) too. */
  const mergeComparisonRuns = useCallback(
    (runs: EvalGeneration[]) => {
      runs.forEach((run, i) => {
        mergeAgentResults(run);
        if (i === 0) mergeRunResults(run);
      });
    },
    [mergeAgentResults, mergeRunResults],
  );

  const agentNameBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.slug, a.name);
    return m;
  }, [agents]);

  /** Human label for a run's pinned generation model ("copilot · gpt-4o"), "" if default. */
  const genLabelFor = useCallback((run: { genProvider?: string | null; genModel?: string | null }) => {
    const p = run.genProvider ?? "";
    const m = run.genModel ?? "";
    return p && m ? `${p} · ${m}` : m || p || "";
  }, []);

  const toAgentRun = useCallback(
    (run: EvalGeneration): AgentRun => ({
      slug: run.agentSlug,
      name: agentNameBySlug.get(run.agentSlug) ?? run.agentSlug,
      runId: run.id,
      genLabel: genLabelFor(run),
    }),
    [agentNameBySlug, genLabelFor],
  );

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

  // Same judge remap, per agent — feeds the side-by-side comparison detail/report.
  const displayByAgent = useMemo(() => {
    const out: Record<string, Record<string, LiveTurn>> = {};
    for (const slug in resultsByAgent) {
      const m = resultsByAgent[slug]!;
      if (!activeJudgeId) {
        out[slug] = m;
        continue;
      }
      const remapped: Record<string, LiveTurn> = {};
      for (const k in m) {
        const t = m[k]!;
        const { score, reasoning, failed } = scoreForJudge(t, activeJudgeId, defaultModelName);
        remapped[k] = { ...t, matchScore: score, judgeReasoning: reasoning, judgeFailed: failed };
      }
      out[slug] = remapped;
    }
    return out;
  }, [resultsByAgent, activeJudgeId, defaultModelName]);

  // The agents to show for the currently open conversation (its folder's latest
  // run) or the open report — 1-3, in comparison order.
  const openAgents = useMemo(
    () => (openConv ? compareByFolder[openConv.folderId]?.agents ?? [] : []),
    [openConv, compareByFolder],
  );

  // Citation index for the open conversation's turns — maps each [clf-id#n] key
  // (all alias forms) to the tool invocation + chunk backing it, so a chip click
  // resolves its source. Mirrors chat's index but iterates eval turn results.
  const citationIndexByAgent = useMemo(() => {
    const out: Record<string, Map<string, CitationLookup>> = {};
    if (!openConv) return out;
    const turnCount = (openConv.turns as EvalTurn[]).length;
    for (const a of openAgents) {
      const dm = displayByAgent[a.slug] ?? {};
      const index = new Map<string, CitationLookup>();
      for (let ti = 0; ti < turnCount; ti++) {
        const invocations = dm[rKey(openConv.id, ti)]?.tools ?? [];
        for (const invocation of invocations) {
          if (!invocation.toolCallId || !invocation.result) continue;
          const chunks = parseInvocationCitationChunks(invocation);
          if (chunks.length === 0) continue;
          for (const chunk of chunks) {
            const lookup: CitationLookup = { invocation, messageId: String(ti), chunk, chunks };
            for (const key of buildCitationKeyAliases(chunk.toolCallId, chunk.chunkIndex)) index.set(key, lookup);
            for (const key of buildCitationKeyAliases(invocation.toolCallId, chunk.chunkIndex)) index.set(key, lookup);
          }
        }
      }
      out[a.slug] = index;
    }
    return out;
  }, [openConv, openAgents, displayByAgent]);

  const resolvedCitation = selectedCitation
    ? citationIndexByAgent[citationAgent ?? openAgents[0]?.slug ?? ""]?.get(selectedCitation.key) ?? null
    : null;

  // Drop a stale citation selection when switching conversations — its key would
  // otherwise resolve against a different conversation's index.
  useEffect(() => {
    setSelectedCitation(null);
    setCitationAgent(null);
  }, [openConv?.id]);

  // ── CSV export (question · expected · claw response · cited chunks) ──
  // Folder ids with an in-flight export (folder export fetches every
  // conversation's turns, so the button shows a spinner meanwhile).
  const [downloadingFolders, setDownloadingFolders] = useState<Set<string>>(new Set());

  // One turn's row — used by the per-message download button.
  const downloadTurnCsv = useCallback((convLabel: string, turnIdx: number, turn: EvalTurn, live: LiveTurn | undefined) => {
    const rows = [evalCsvRow(convLabel, turnIdx, turn.message, turn.expectedResponse, live?.answer ?? "", live?.tools ?? [])];
    downloadCsv(`${safeFilename(convLabel, "turn")}_M${turnIdx + 1}.csv`, buildCsv(EVAL_CSV_HEADERS, rows));
  }, []);

  // The open conversation's turns — everything's already in state, no fetch.
  const downloadConversationCsv = useCallback(() => {
    if (!openConv) return;
    const turns = (openConv.turns as EvalTurn[]) ?? [];
    const rows = turns.map((t, ti) => {
      const live = displayResults[rKey(openConv.id, ti)];
      return evalCsvRow(openConv.title, ti, t.message, t.expectedResponse, live?.answer ?? "", live?.tools ?? []);
    });
    downloadCsv(`${safeFilename(openConv.title, "conversation")}.csv`, buildCsv(EVAL_CSV_HEADERS, rows));
  }, [openConv, displayResults]);

  // Whole folder — spans every conversation, so it fetches: list conversations
  // → latest run's per-turn results → each conversation's turns, then joins them
  // by (conversationId, turnIndex). Never throws; missing results export blank.
  const downloadFolderCsv = useCallback(async (folderId: string) => {
    if (downloadingFolders.has(folderId)) return;
    setDownloadingFolders((s) => new Set(s).add(folderId));
    try {
      const items: EvalConversationListItem[] = [];
      for (;;) {
        const page = await listEvalConversations(folderId, { skip: items.length, take: FOLDER_PAGE });
        items.push(...page.items);
        if (page.items.length === 0 || items.length >= page.total) break;
      }
      const run = await getLatestGenerationForFolder(folderId).catch(() => null);
      const resById = new Map((run?.turnResults ?? []).map((tr) => [`${tr.conversationId}::${tr.turnIndex}`, tr] as const));
      const convs = await mapPool(items, 5, (item) => getEvalConversation(item.id).catch(() => null));
      const rows: CsvValue[][] = [];
      items.forEach((item, i) => {
        const label = item.title || item.source || item.id;
        const turns = (convs[i]?.turns as EvalTurn[] | undefined) ?? [];
        turns.forEach((turn, ti) => {
          const tr = resById.get(`${item.id}::${ti}`);
          rows.push(evalCsvRow(label, ti, turn.message, turn.expectedResponse, tr?.clawAnswer ?? "", tr?.toolInvocations ?? []));
        });
      });
      const folderName = foldersById.get(folderId)?.name ?? "folder";
      downloadCsv(`${safeFilename(folderName, "folder")}.csv`, buildCsv(EVAL_CSV_HEADERS, rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV export failed");
    } finally {
      setDownloadingFolders((s) => { const n = new Set(s); n.delete(folderId); return n; });
    }
  }, [downloadingFolders, foldersById]);

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

  // Per-agent overview for the detail header (one avg chip per compared agent).
  const openAgentSummaries = useMemo(() => {
    if (!openConv) return [] as Array<{ agent: AgentRun; summary: ReturnType<typeof summarizeTurns> }>;
    const turnCount = ((openConv.turns as EvalTurn[]) ?? []).length;
    return openAgents.map((a) => {
      const dm = displayByAgent[a.slug] ?? {};
      const turns: LiveTurn[] = [];
      for (let ti = 0; ti < turnCount; ti++) {
        const t = dm[rKey(openConv.id, ti)];
        if (t) turns.push(t);
      }
      return { agent: a, summary: summarizeTurns(turns) };
    });
  }, [openConv, openAgents, displayByAgent]);

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
      // Overlay the latest run for this folder. If it belongs to a comparison,
      // pull every sibling agent's run so the side-by-side view has them all.
      const latest = await getLatestGenerationForFolder(folderId).catch(() => null);
      if (!latest) return;
      if (latest.comparisonId) {
        const comp = await getComparison(latest.comparisonId).catch(() => ({ agents: [] as { run: EvalGeneration }[] }));
        const runs = comp.agents.map((c) => c.run);
        if (runs.length) {
          setCompareByFolder((prev) => ({ ...prev, [folderId]: { comparisonId: latest.comparisonId ?? null, agents: runs.map(toAgentRun) } }));
          mergeComparisonRuns(runs);
          return;
        }
      }
      // Single-agent run (no comparison) = a comparison of one.
      setCompareByFolder((prev) => ({ ...prev, [folderId]: { comparisonId: null, agents: [toAgentRun(latest)] } }));
      mergeComparisonRuns([latest]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    }
  }, [mergeComparisonRuns, toAgentRun]);

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

  // Decode a per-agent genChoice into the { genProvider, genModel } run pin.
  const decodeGenChoice = useCallback(
    (genChoice: string): { genProvider?: string; genModel?: string } => {
      if (genChoice.startsWith("prov:")) {
        const p = genChoice.slice(5);
        const m = genModels?.providers.find((x) => x.provider === p)?.model;
        return { genProvider: p, ...(m ? { genModel: m } : {}) };
      }
      if (genChoice.startsWith("spaces:")) return { genProvider: "spaces", genModel: genChoice.slice(7) };
      if (genChoice.startsWith("litellm:")) return { genProvider: "litellm", genModel: genChoice.slice(8) };
      return {};
    },
    [genModels],
  );

  // Enqueue a resilient background comparison (1-3 agents replay server-side) and
  // start one poller per agent run.
  const runOver = useCallback(
    async (scope: { conversationIds?: string[]; folderId?: string }) => {
      if (submittingRun) return;
      const specs = runAgents.filter((a) => a.slug);
      if (specs.length === 0) return;
      // One comparison at a time, full stop — a second run (any scope, incl. a
      // checked-selection run with no folderId) would fight the first for the same
      // provider account (stream terminations). Block on any in-flight run.
      if (runActiveRef.current) {
        setInfo("A run is already in progress — wait for it to finish (or cancel it) before starting another.");
        return;
      }
      setError(null);
      setSubmittingRun(true);
      // Clear the previous run's results (flat + per-agent) for these conversations
      // immediately — stale ticks/scores shouldn't linger while the new run streams in.
      const targetIds =
        scope.conversationIds ?? (scope.folderId ? (folderConvs[scope.folderId]?.items ?? []).map((c) => c.id) : []);
      if (targetIds.length > 0) {
        const clear = (m: Record<string, LiveTurn>) => {
          const next = { ...m };
          for (const k of Object.keys(next)) if (targetIds.some((id) => k.startsWith(`${id}::`))) delete next[k];
          return next;
        };
        setResults(clear);
        setResultsByAgent((prev) => {
          const out: Record<string, Record<string, LiveTurn>> = {};
          for (const s in prev) out[s] = clear(prev[s]!);
          return out;
        });
      }
      try {
        const agentsPayload = specs.map((s) => ({ agentSlug: s.slug, ...decodeGenChoice(s.genChoice) }));
        const { comparisonId, runs } = await startBackgroundGeneration({ agents: agentsPayload, ...scope }, userId);
        if (runs.length === 0) throw new Error("No runs started");
        const fid = scope.folderId ?? openConv?.folderId;
        if (fid) {
          const agentRuns: AgentRun[] = runs.map((r) => {
            const spec = specs.find((s) => s.slug === r.agentSlug);
            const g = spec ? decodeGenChoice(spec.genChoice) : {};
            return {
              slug: r.agentSlug,
              name: agentNameBySlug.get(r.agentSlug) ?? r.agentSlug,
              runId: r.runId,
              genLabel: g.genProvider && g.genModel ? `${g.genProvider} · ${g.genModel}` : g.genModel ?? g.genProvider ?? "",
            };
          });
          setCompareByFolder((prev) => ({ ...prev, [fid]: { comparisonId, agents: agentRuns } }));
        }
        runs.forEach((r, i) =>
          startRunRef.current({ jobId: r.jobId, runId: r.runId, ...(fid ? { folderId: fid } : {}), agentSlug: r.agentSlug, isPrimary: i === 0 }),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Run failed");
      } finally {
        setSubmittingRun(false);
      }
    },
    [submittingRun, runAgents, userId, openConv, folderConvs, decodeGenChoice, agentNameBySlug],
  );

  const openRun = useCallback(
    (scope: { conversationIds?: string[]; folderId?: string }, label: string) => {
      if (submittingRun) return;
      // Start with one agent row prefilled to the default agent; the user can add
      // up to MAX_COMPARE_AGENTS to compare.
      setRunAgents([{ slug: agentSlug || agents[0]?.slug || "", genChoice: "" }]);
      setPendingRun({ scope, label });
      // Lazily load the user's configured providers + platform models for the picker.
      if (!genModels) void listEvalGenModels(userId).then(setGenModels).catch(() => setGenModels({ providers: [], litellm: [] }));
    },
    [submittingRun, genModels, userId, agentSlug, agents],
  );

  // Load each picked agent's shared LiteLLM models while the Run dialog is open
  // (empty ⇒ that agent has no litellm credential; the group just hides). Cached
  // per agent slug so switching rows doesn't refetch.
  useEffect(() => {
    if (!pendingRun || !userId) return;
    let cancelled = false;
    const slugs = [...new Set(runAgents.map((a) => a.slug).filter(Boolean))];
    for (const slug of slugs) {
      if (litellmByAgent[slug]) continue;
      listChatLitellmModels(slug, userId)
        .then((r) => { if (!cancelled) setLitellmByAgent((prev) => ({ ...prev, [slug]: r.models })); })
        .catch(() => { if (!cancelled) setLitellmByAgent((prev) => ({ ...prev, [slug]: [] })); });
    }
    return () => { cancelled = true; };
  }, [pendingRun, runAgents, userId, litellmByAgent]);

  // ── Semantic judge ──
  /** Open the judge dialog for a folder (whole run) or one conversation. Lazily
   *  loads the model list + global defaults, and prefills the prompt with the
   *  per-folder override if one is set, else the global default. */
  const openJudge = useCallback(
    async (opts: {
      folderId: string;
      conversationId?: string;
      label: string;
      /** Score a SPECIFIC run/comparison (e.g. a past run from History) instead of
       *  the folder's latest. Falls back to the latest overlay when omitted. */
      target?: { comparisonId: string | null; agents: AgentRun[] };
    }) => {
      const comp = opts.target ?? compareByFolder[opts.folderId];
      if (!comp || comp.agents.length === 0) {
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
        comparisonId: comp.comparisonId,
        agents: comp.agents,
        folderId: opts.folderId,
        ...(opts.conversationId ? { conversationIds: [opts.conversationId] } : {}),
        label: opts.label,
      });
    },
    [compareByFolder, judges, activeJudgeId, models.length],
  );

  // Score a SPECIFIC past run (from the History view). If the run belongs to a
  // comparison, resolve every sibling agent so it's judged apples-to-apples;
  // otherwise score it on its own. Reuses the same judge dialog/flow as the latest.
  const scoreHistoricalRun = useCallback(
    async (folderId: string, run: GenerationMeta) => {
      const genLabel = run.genModel ? `${run.genProvider ? `${run.genProvider} · ` : ""}${run.genModel}` : "";
      const solo: AgentRun = { slug: run.agentSlug, name: agentNameBySlug.get(run.agentSlug) ?? run.agentSlug, runId: run.id, genLabel };
      let target: { comparisonId: string | null; agents: AgentRun[] } = { comparisonId: null, agents: [solo] };
      if (run.comparisonId) {
        const comp = await getComparison(run.comparisonId).catch(() => null);
        const agents = (comp?.agents ?? []).map((c) => toAgentRun(c.run));
        if (agents.length) target = { comparisonId: run.comparisonId, agents };
      }
      const when = new Date(run.startedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
      await openJudge({ folderId, label: `run · ${run.agentSlug} · ${when}`, target });
    },
    [openJudge, toAgentRun, agentNameBySlug],
  );

  const runJudge = useCallback(async () => {
    if (!judgeDialog || judging || judgeEntries.length === 0) return;
    setJudging(true);
    setError(null);
    const entries = judgeEntries;
    const { comparisonId, agents, folderId, conversationIds: convScope } = judgeDialog;
    try {
      const judgesPayload = entries.map((e) => ({ judgeId: e.judgeId, ...(e.model ? { model: e.model } : {}) }));
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
      const payload = {
        judges: judgesPayload,
        ...(convScope ? { conversationIds: convScope } : {}),
        ...(judgeOnlyUnscored ? { onlyUnscored: true } : {}),
      };
      if (comparisonId) {
        // Fan one judge pass across every agent's run (apples-to-apples).
        const { jobs } = await judgeComparison(comparisonId, payload, userId);
        jobs.forEach((j, i) =>
          startJudgeRef.current({
            jobId: j.jobId,
            runId: j.runId,
            folderId,
            ...(convScope ? { convScope } : {}),
            primaryJudgeId: firstKey,
            agentSlug: j.agentSlug,
            isPrimary: i === 0,
          }),
        );
      } else {
        // Legacy single-agent run (no comparison group).
        const runId = agents[0]?.runId;
        if (!runId) throw new Error("No run to score");
        const { jobId } = await judgeEvalRun(runId, payload, userId);
        startJudgeRef.current({
          jobId,
          runId,
          folderId,
          ...(convScope ? { convScope } : {}),
          primaryJudgeId: firstKey,
          ...(agents[0]?.slug ? { agentSlug: agents[0].slug } : {}),
          isPrimary: true,
        });
      }
      setJudgeDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scoring failed");
    } finally {
      setJudging(false);
    }
  }, [judgeDialog, judging, judgeEntries, judgeOnlyUnscored, userId, defaultModelName, copilotProv]);

  // ── Background scoring job (generic poller — see useBackgroundJob) ──
  const judgeJob = useBackgroundJob<
    { jobId: string; runId: string; folderId: string; convScope?: string[]; primaryJudgeId: string; agentSlug?: string; isPrimary?: boolean },
    EvalJudgeProgress
  >({
    storageKey: "xyne-eval-judge",
    fetchStatus: (id) => getEvalJudgeJob(id, userId),
    cancelJob: (id) => cancelEvalJudgeJob(id, userId),
    isDone: (st) => st.progress?.phase === "done" || st.progress?.phase === "cancelled",
    onRestore: (meta) => setInflightJudgeKey(meta.primaryJudgeId ?? null),
    onFinish: () => setInflightJudgeKey(null),
    // Live: pull the scores written so far so the report/turns fill in as it runs.
    // Route into the agent's slot; the primary also feeds the flat (sidebar) map.
    onTick: async (meta) => {
      const run = await getGeneration(meta.runId).catch(() => null);
      if (!run) return;
      mergeAgentResults(run);
      if (meta.isPrimary !== false) mergeRunResults(run);
    },
    onDone: (meta, st) => {
      if (meta.primaryJudgeId) setActiveJudgeId((cur) => cur || meta.primaryJudgeId);
      // One toast per comparison, not per agent — announce on the primary run.
      if (meta.isPrimary === false) return;
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
    setHistoryFolderId(null);
    setOpenConvId(id);
  }, []);

  // Open a project's report; ensure its conversations (and their scores) are loaded.
  const openReport = useCallback(
    (folderId: string) => {
      setShowJudges(false);
      setOpenConvId(null);
      setCompareFolderId(null);
      setHistoryFolderId(null);
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
      setHistoryFolderId(null);
      setCompareFolderId(folderId);
      if (!folderConvs[folderId]) void loadFolderConvs(folderId);
    },
    [folderConvs, loadFolderConvs],
  );

  // Open a project's run history (all past runs). Conversations are loaded so the
  // Score-a-past-run flow can resolve the folder's comparison group if needed.
  const openHistory = useCallback(
    (folderId: string) => {
      setShowJudges(false);
      setOpenConvId(null);
      setReportFolderId(null);
      setCompareFolderId(null);
      setHistoryFolderId(folderId);
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
    else if (searchParams.get("history")) openHistory(searchParams.get("history")!);
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
    else if (historyFolderId) next.set("history", historyFolderId);
    else if (reportFolderId) next.set("report", reportFolderId);
    else if (openConvId) next.set("conv", openConvId);
    if (activeJudgeId) next.set("judge", activeJudgeId);
    setSearchParams(next, { replace: true });
  }, [showJudges, compareFolderId, historyFolderId, reportFolderId, openConvId, activeJudgeId, setSearchParams]);

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

  const runJob = useBackgroundJob<{ jobId: string; runId: string; folderId?: string; agentSlug?: string; isPrimary?: boolean }, GenerationProgress>({
    storageKey: "xyne-eval-generation",
    fetchStatus: (id) => getGenerationJob(id, userId),
    cancelJob: (id) => cancelGenerationJob(id, userId),
    isDone: (st) => st.progress?.phase === "done" || st.progress?.phase === "cancelled" || st.progress?.phase === "failed",
    // Live: each generated answer appears as soon as the worker persists it.
    // Route into the agent's slot; the primary also feeds the flat (sidebar) map.
    onTick: async (meta) => {
      const run = await getGeneration(meta.runId).catch(() => null);
      if (!run) return;
      mergeAgentResults(run);
      if (meta.isPrimary !== false) mergeRunResults(run);
    },
    onDone: async (meta, st) => {
      // One toast + one folder refresh per comparison — do it on the primary run
      // (non-primary agents keep streaming their scores in via onTick).
      if (meta.isPrimary === false) return;
      const p = st.progress;
      setInfo(
        st.state === "failed" || p?.phase === "failed"
          ? `Run failed: ${st.failedReason ?? "see logs"}`
          : `Run ${p?.phase === "cancelled" ? "cancelled" : "done"}: ${p?.conversationsDone ?? 0}/${p?.conversationsTotal ?? 0} conversations, ` +
              `${p?.turnsDone ?? 0} turns${p?.turnsFailed ? `, ${p.turnsFailed} failed` : ""}.`,
      );
      // Refresh every loaded folder so results + run-ids overlay.
      await Promise.all(Object.keys(folderConvs).map((fid) => loadFolderConvs(fid).catch(() => {})));
    },
  });
  startRunRef.current = runJob.start;

  // runningFolders (per-folder Run-button gating) is exactly the set of folders
  // with an in-flight generation job — derive it from the poller's active jobs so
  // the guard survives refresh and clears only when a folder's LAST agent finishes.
  // runActiveRef additionally tracks folderId-less (conversation-scoped) runs.
  useEffect(() => {
    runActiveRef.current = runJob.actives.length > 0;
    setRunningFolders(new Set(runJob.actives.map((a) => a.folderId).filter((x): x is string => !!x)));
  }, [runJob.actives]);

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
    onDownloadCsv: (id) => void downloadFolderCsv(id),
    downloadingFolders,
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
    onOpenHistory: openHistory,
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
      <section className="relative flex flex-1 flex-col overflow-hidden min-w-0">
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
                      {job.agentSlug ? ` · ${agentNameBySlug.get(job.agentSlug) ?? job.agentSlug}` : ""}
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
        ) : historyFolderId ? (
          <HistoryView
            folderName={foldersById.get(historyFolderId)?.name ?? "Project"}
            folderId={historyFolderId}
            convItems={folderConvs[historyFolderId]?.items ?? []}
            scoringRunId={judgeJob.active?.folderId === historyFolderId ? (judgeJob.active?.runId ?? null) : null}
            onScoreRun={(run) => void scoreHistoricalRun(historyFolderId, run)}
            onClose={() => setHistoryFolderId(null)}
          />
        ) : reportFolderId ? (
          <ProjectReport
            folderName={foldersById.get(reportFolderId)?.name ?? "Project"}
            convItems={folderConvs[reportFolderId]?.items ?? []}
            agents={(compareByFolder[reportFolderId]?.agents ?? []).map((a) => ({
              slug: a.slug,
              name: a.name,
              genLabel: a.genLabel,
              results: displayByAgent[a.slug] ?? {},
            }))}
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
                {/* Once ANY agent is scored, show a chip for EVERY agent (a failed /
                    unscored agent shows "—") so the header can't silently look like
                    a smaller comparison than it is. */}
                {openAgentSummaries.some((s) => s.summary.avg != null) &&
                  openAgentSummaries.map((s) => {
                    const avg = s.summary.avg;
                    return (
                      <span
                        key={s.agent.slug}
                        title={`${s.agent.name} — average semantic match`}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold ${
                          avg != null ? scoreChipClass(avg) : "bg-xyne-surface-sunken text-xyne-fg-tertiary"
                        }`}
                      >
                        {openAgents.length > 1 && (
                          <span className="max-w-[90px] truncate font-normal opacity-80">{s.agent.name}</span>
                        )}
                        {avg != null ? (
                          <>
                            {avg}
                            <span className="font-normal opacity-70">/100</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    );
                  })}
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
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<DownloadSimpleIcon size={13} />}
                  title="Download this conversation as CSV"
                  onClick={downloadConversationCsv}
                >
                  Export CSV
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2">
              <div className="flex flex-col">
                {(openConv.turns as EvalTurn[]).map((t, ti) => {
                  const panes: TurnAgentPane[] = openAgents.map((a) => ({
                    slug: a.slug,
                    name: a.name,
                    live: (displayByAgent[a.slug] ?? {})[rKey(openConv.id, ti)],
                  }));
                  return (
                    <TurnCard
                      key={ti}
                      index={ti}
                      message={t.message}
                      expected={t.expectedResponse ?? null}
                      panes={panes}
                      selectedCitationKey={selectedCitation?.key ?? null}
                      citationAgent={citationAgent}
                      onOpenDebug={openTurnDebugger}
                      makeOpenCitation={makeOpenCitation}
                      onDownloadCsv={() => downloadTurnCsv(openConv.title, ti, t, displayResults[rKey(openConv.id, ti)])}
                    />
                  );
                })}
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Citation source panel — right-docked, resizable. One dock slot:
              rendered only when no debug drawer is open. ── */}
      {selectedCitation && !evalDebug && (
        <>
          <div
            data-id="evals-citation-resizer"
            className="group relative flex w-1 shrink-0 cursor-col-resize items-center justify-center"
            onMouseDown={handleCitationResizeStart}
          >
            <div className="h-full w-px bg-xyne-border-subtle group-hover:w-0.5 group-hover:bg-xyne-border-strong transition-all" />
          </div>
          <CitationPanel
            selection={selectedCitation}
            citation={resolvedCitation}
            width={citationPanelWidth}
            onClose={handleCloseCitation}
            onOpenCitation={handleOpenCitation}
          />
        </>
      )}

      {/* ── Debug drawer for an eval turn's claw run — right-docked, resizable. ── */}
      {evalDebug && (
        <>
          <div
            data-id="evals-debugger-resizer"
            className="group relative flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent"
            onMouseDown={handleEvalDebuggerResizeStart}
          >
            <div className="h-full w-px bg-xyne-border-subtle group-hover:w-0.5 group-hover:bg-xyne-border-strong transition-all" />
          </div>
          <DebugDrawer
            open
            inline
            width={evalDebuggerWidth}
            agentSlug={evalDebug.agentSlug}
            conversationId={evalDebug.conversationId}
            selectedSessionId={evalDebug.sessionId}
            onClose={() => setEvalDebug(null)}
          />
        </>
      )}

      {/* ── Run dialog: pick 1-3 agents to compare, each with its own model ── */}
      <Dialog open={!!pendingRun} onOpenChange={(o) => !o && setPendingRun(null)} title="Run eval">
        {(() => {
          const chosen = runAgents.filter((a) => a.slug).length;
          const setRow = (idx: number, patch: Partial<RunAgentSpec>) =>
            setRunAgents((l) => l.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
          return (
            <div className="flex flex-col gap-3">
              <div className="text-[12px] text-xyne-fg-tertiary">
                Running <span className="font-medium text-xyne-fg-secondary">{pendingRun?.label}</span>
                {chosen > 1 ? <span className="text-xyne-fg-secondary"> — comparing {chosen} agents</span> : null}
              </div>
              <div className="flex flex-col gap-2.5">
                {runAgents.map((row, idx) => {
                  const taken = new Set(runAgents.filter((_, i) => i !== idx).map((r) => r.slug).filter(Boolean));
                  return (
                    <div key={idx} className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle p-2.5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
                          {runAgents.length > 1 ? `Agent ${idx + 1}` : "Agent"}
                        </span>
                        {runAgents.length > 1 && (
                          <button
                            onClick={() => setRunAgents((l) => l.filter((_, i) => i !== idx))}
                            title="Remove agent"
                            className="text-[11px] text-xyne-fg-tertiary hover:text-xyne-error"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <SelectField
                          placeholder={agents.length === 0 ? "Loading agents…" : "Search agents…"}
                          value={row.slug}
                          onValueChange={(v) => setRow(idx, { slug: v ?? "", genChoice: "" })}
                          options={agents.filter((a) => !taken.has(a.slug)).map((a) => ({ value: a.slug, label: a.name }))}
                        />
                        <SelectField
                          placeholder="Generation model…"
                          value={toSel(row.genChoice)}
                          onValueChange={(v) => setRow(idx, { genChoice: fromSel(v) })}
                          options={[
                            { value: DEFAULT_OPT, label: "Default — agent settings" },
                            ...(genModels?.providers ?? []).map((p) => ({
                              value: `prov:${p.provider}`,
                              label: `${p.provider}${p.model ? ` · ${p.model}` : ""} (your provider)`,
                            })),
                            ...(genModels?.litellm ?? []).map((m) => ({ value: `spaces:${m}`, label: `${m} (platform)` })),
                            ...(litellmByAgent[row.slug] ?? []).map((m) => ({ value: `litellm:${m.id}`, label: `${m.name} (agent LiteLLM)` })),
                          ]}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {runAgents.length < MAX_COMPARE_AGENTS && agents.length > chosen && !runAgents.some((a) => !a.slug) && (
                <button
                  onClick={() => setRunAgents((l) => (l.length < MAX_COMPARE_AGENTS ? [...l, { slug: "", genChoice: "" }] : l))}
                  className="flex items-center gap-1.5 self-start text-[12px] text-xyne-brand hover:underline"
                >
                  <PlusIcon size={13} /> Add agent to compare
                </button>
              )}
              <span className="text-[11px] text-xyne-fg-tertiary">
                Compare up to {MAX_COMPARE_AGENTS} agents over the same conversations — each replays on its own model and is
                judged against the same gold answers. Each model pin is recorded on the report.
              </span>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setPendingRun(null)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={chosen === 0}
                  leadingIcon={<PlayIcon size={13} />}
                  onClick={() => {
                    const scope = pendingRun?.scope;
                    setPendingRun(null);
                    if (scope) void runOver(scope);
                  }}
                >
                  {chosen > 1 ? `Compare ${chosen} agents` : "Run"}
                </Button>
              </div>
            </div>
          );
        })()}
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

/** One agent's column in the report (judge-remapped results for that agent). */
interface ReportAgent {
  slug: string;
  name: string;
  genLabel: string;
  results: Record<string, LiveTurn>;
}

/** Per-agent rollup: avg (failed-to-score turns count as 0) + good/weak/fail. */
function rollupAgent(turns: Array<{ score: number | null; failed: boolean }>) {
  const scores = turns.map((t) => t.score).filter((s): s is number => typeof s === "number");
  const errored = turns.filter((t) => typeof t.score !== "number" && t.failed).length;
  const good = scores.filter((s) => s >= 80).length;
  const weak = scores.filter((s) => s >= 50 && s < 80).length;
  const fail = scores.filter((s) => s < 50).length + errored;
  const total = scores.length + errored;
  const avg = total ? Math.round(scores.reduce((s, n) => s + n, 0) / total) : null;
  return { avg, good, weak, fail, total };
}

function ProjectReport({
  folderName,
  convItems,
  agents,
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
  /** One column per compared agent (1-3); results already judge-remapped. */
  agents: ReportAgent[];
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
  const multi = agents.length > 1;

  // Per conversation: for each agent, its turn scores + a per-conversation avg.
  const rows = useMemo(() => {
    return convItems.map((conv) => {
      const perAgent = agents.map((a) => {
        const turns = Object.entries(a.results)
          .filter(([k]) => k.startsWith(`${conv.id}::`))
          .map(([k, v]) => ({ idx: Number(k.split("::")[1]), score: v.matchScore, failed: !!v.judgeFailed }))
          .sort((x, y) => x.idx - y.idx);
        return { ...rollupAgent(turns), turns };
      });
      const turnIdxs = [...new Set(perAgent.flatMap((pa) => pa.turns.map((t) => t.idx)))].sort((x, y) => x - y);
      return { conv, perAgent, turnIdxs };
    });
  }, [convItems, agents]);

  // Overall per agent (across every conversation).
  const overall = useMemo(
    () => agents.map((_, ai) => rollupAgent(rows.flatMap((r) => r.perAgent[ai]?.turns ?? []))),
    [rows, agents],
  );
  const bestAvg = Math.max(-1, ...overall.map((o) => (typeof o.avg === "number" ? o.avg : -1)));

  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-xyne-border-subtle px-5">
        <div className="flex min-w-0 items-center gap-2">
          <ChartBarIcon size={15} weight="fill" className="shrink-0 text-xyne-brand" />
          <h2 className="truncate text-[14px] font-semibold text-xyne-fg-primary">{folderName}</h2>
          <span className="text-[11px] text-xyne-fg-tertiary">· {multi ? `Comparison · ${agents.length} agents` : "Report"}</span>
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
        <div className={`mx-auto ${multi ? "max-w-3xl" : "max-w-2xl"}`}>
          {agents.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-xyne-fg-tertiary">Run this project to generate scores.</div>
          ) : (
            <>
              {/* Per-agent headline scores (reuses ScoreBar + Delta) */}
              <div className="mb-5 flex flex-col gap-2.5 rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-5 py-4">
                {agents.map((a, ai) => {
                  const o = overall[ai]!;
                  const isBest = multi && typeof o.avg === "number" && o.avg === bestAvg;
                  return (
                    <div key={a.slug} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-xyne-fg-primary">{a.name}</span>
                          {isBest && (
                            <span className="shrink-0 rounded bg-xyne-success/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-xyne-success">
                              Best
                            </span>
                          )}
                        </div>
                        {a.genLabel && <div className="truncate text-[10.5px] text-xyne-fg-tertiary">{a.genLabel}</div>}
                      </div>
                      {o.total > 0 && (
                        <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-xyne-surface-sunken sm:flex">
                          <span className="bg-xyne-success" style={{ width: `${(o.good / o.total) * 100}%` }} />
                          <span className="bg-amber-500" style={{ width: `${(o.weak / o.total) * 100}%` }} />
                          <span className="bg-xyne-error" style={{ width: `${(o.fail / o.total) * 100}%` }} />
                        </div>
                      )}
                      <ScoreBar score={o.avg} />
                      {multi && <Delta a={overall[0]?.avg ?? null} b={o.avg} />}
                    </div>
                  );
                })}
                <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-xyne-fg-tertiary">
                  average match · {rows.length} conversation{rows.length === 1 ? "" : "s"}
                  {multi ? ` · Δ vs ${agents[0]!.name}` : ""}
                </div>
              </div>

              {/* Agent column header (multi only) */}
              {multi && (
                <div className="mb-1 flex items-center gap-2 px-3 text-[10px] font-medium uppercase tracking-wide text-xyne-fg-tertiary">
                  <span className="min-w-0 flex-1">Conversation</span>
                  {agents.map((a) => (
                    <span key={a.slug} className="w-[88px] shrink-0 truncate text-right" title={a.name}>
                      {a.name}
                    </span>
                  ))}
                  <span className="w-4 shrink-0" />
                </div>
              )}

              {/* Conversation list */}
              {rows.length === 0 ? (
                <div className="py-10 text-center text-[12px] text-xyne-fg-tertiary">No conversations in this project.</div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {rows.map(({ conv, perAgent, turnIdxs }) => {
                    const isOpen = expanded.has(conv.id);
                    const scoring = scoringActive && (!scoringConvIds || scoringConvIds.has(conv.id));
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
                          {perAgent.map((pa, ai) =>
                            scoring ? (
                              <span key={ai} className="flex w-[88px] shrink-0 items-center justify-end">
                                <SpinnerGapIcon size={13} className="animate-spin text-blue-500" />
                              </span>
                            ) : pa.avg == null && pa.fail > 0 ? (
                              <span
                                key={ai}
                                className="w-[88px] shrink-0 text-right text-[11px] font-medium text-xyne-error"
                                title="Judge couldn't score (e.g. rate-limited)"
                              >
                                fail
                              </span>
                            ) : (
                              <ScoreBar key={ai} score={pa.avg} />
                            ),
                          )}
                          <button
                            onClick={() => onOpenConv(conv.id)}
                            title="Open conversation detail"
                            className="w-4 shrink-0 text-xyne-fg-tertiary opacity-0 transition hover:text-xyne-fg-primary group-hover:opacity-100"
                          >
                            <ArrowUpRightIcon size={14} />
                          </button>
                        </div>
                        {isOpen && (
                          <div className="flex flex-col gap-1.5 py-1.5 pl-9 pr-3">
                            {turnIdxs.length === 0 ? (
                              <span className="text-[11px] text-xyne-fg-tertiary">No results yet.</span>
                            ) : (
                              turnIdxs.map((idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <span className="min-w-0 flex-1 text-[11px] text-xyne-fg-tertiary">Message {idx + 1}</span>
                                  {perAgent.map((pa, ai) => {
                                    const t = pa.turns.find((x) => x.idx === idx);
                                    return typeof t?.score !== "number" && t?.failed ? (
                                      <span key={ai} className="w-[88px] shrink-0 text-right text-[11px] font-medium text-xyne-error">
                                        fail
                                      </span>
                                    ) : (
                                      <ScoreBar key={ai} score={typeof t?.score === "number" ? t.score : null} />
                                    );
                                  })}
                                  <span className="w-4 shrink-0" />
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
            </>
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
  // Ordered list of run ids under comparison; index 0 is the baseline. Supports
  // N runs (not just A/B) — each non-baseline column shows its Δ vs the baseline.
  const [selIds, setSelIds] = useState<string[]>([]);
  // Full generations (with turnResults) fetched once and cached by run id.
  const [gens, setGens] = useState<Record<string, EvalGeneration | null>>({});

  useEffect(() => {
    listGenerationsForFolder(folderId)
      .then((rs) => {
        setRuns(rs);
        // Default: baseline = second-newest, compared against the newest (matches
        // the old A/B default); a single run just shows itself.
        if (rs.length >= 2) setSelIds([rs[1]!.id, rs[0]!.id]);
        else if (rs.length === 1) setSelIds([rs[0]!.id]);
      })
      .catch(() => {});
  }, [folderId]);
  // Fetch any newly-selected run's full generation once; cache in `gens`.
  useEffect(() => {
    for (const id of selIds) {
      if (id && !(id in gens)) {
        getGeneration(id)
          .then((g) => setGens((m) => ({ ...m, [id]: g })))
          .catch(() => setGens((m) => ({ ...m, [id]: null })));
      }
    }
  }, [selIds, gens]);

  const titleById = useMemo(() => new Map(convItems.map((c) => [c.id, c.title])), [convItems]);
  const runLabel = (r: GenerationMeta) =>
    `${r.agentSlug}${r.genModel ? ` · ${r.genModel}` : ""} · ${new Date(r.startedAt).toLocaleDateString()} ${new Date(r.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  /** Column letter for a run position: A, B, C, … */
  const colLetter = (i: number) => String.fromCharCode(65 + i);

  const { rows, perRun, n } = useMemo(() => {
    const scoreMap = (run: EvalGeneration | null) => {
      const m = new Map<string, number | null>();
      for (const t of run?.turnResults ?? []) m.set(`${t.conversationId}::${t.turnIndex}`, t.matchScore ?? null);
      return m;
    };
    const maps = selIds.map((id) => ({ id, scores: scoreMap(gens[id] ?? null) }));
    const keys = [...new Set(maps.flatMap((mp) => [...mp.scores.keys()]))];
    const byConv = new Map<string, Array<{ idx: number; scores: Array<number | null> }>>();
    for (const k of keys) {
      const [cid, idxs] = k.split("::");
      const arr = byConv.get(cid!) ?? [];
      arr.push({ idx: Number(idxs), scores: maps.map((mp) => mp.scores.get(k) ?? null) });
      byConv.set(cid!, arr);
    }
    const rows = [...byConv.entries()]
      .map(([cid, turns]) => ({ cid, title: titleById.get(cid) ?? cid, turns: turns.sort((x, y) => x.idx - y.idx) }))
      .sort((x, y) => x.title.localeCompare(y.title));
    // Per-run average over turns where EVERY selected run scored — keeps the
    // column averages (and the Δs between them) apples-to-apples.
    const sums = maps.map(() => 0);
    let n = 0;
    for (const k of keys) {
      const vals = maps.map((mp) => mp.scores.get(k));
      if (vals.every((v) => typeof v === "number")) {
        vals.forEach((v, i) => (sums[i]! += v as number));
        n++;
      }
    }
    const perRun = maps.map((mp, i) => ({ id: mp.id, avg: n ? Math.round(sums[i]! / n) : null }));
    return { rows, perRun, n };
  }, [selIds, gens, titleById]);

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
        <div className="mx-auto max-w-4xl">
          {runs.length < 2 ? (
            <div className="py-10 text-center text-[12px] text-xyne-fg-tertiary">Need at least two runs to compare. Run this project again.</div>
          ) : (
            <>
              {/* Run pickers — baseline (A) plus any number of comparison runs */}
              <div className="mb-4 flex flex-wrap items-end gap-3">
                {selIds.map((id, idx) => {
                  const taken = new Set(selIds.filter((_, i) => i !== idx));
                  return (
                    <div key={idx} className="flex min-w-[240px] flex-1 items-end gap-1.5">
                      <div className="min-w-0 flex-1">
                        <SelectField
                          label={idx === 0 ? "Baseline (A)" : `Run ${colLetter(idx)}`}
                          placeholder="Search runs…"
                          value={id}
                          onValueChange={(v) => setSelIds((l) => l.map((x, i) => (i === idx ? (v ?? "") : x)))}
                          options={runs.filter((r) => r.id === id || !taken.has(r.id)).map((r) => ({ value: r.id, label: runLabel(r) }))}
                        />
                      </div>
                      {selIds.length > 2 && (
                        <button
                          onClick={() => setSelIds((l) => l.filter((_, i) => i !== idx))}
                          title="Remove run"
                          className="mb-1.5 shrink-0 text-[12px] text-xyne-fg-tertiary hover:text-xyne-error"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
                {selIds.length < runs.length && (
                  <button
                    onClick={() => {
                      const next = runs.find((r) => !selIds.includes(r.id));
                      if (next) setSelIds((l) => [...l, next.id]);
                    }}
                    className="mb-1.5 flex shrink-0 items-center gap-1.5 self-end text-[12px] text-xyne-brand hover:underline"
                  >
                    <PlusIcon size={13} /> Add run
                  </button>
                )}
              </div>

              {/* Summary — baseline avg, then each run's avg + Δ vs baseline */}
              <div className="mb-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-5 py-4">
                {perRun.map((r, i) => {
                  const base = perRun[0]?.avg ?? null;
                  const delta = i > 0 && r.avg != null && base != null ? r.avg - base : null;
                  return (
                    <div key={r.id} className="flex items-center gap-2">
                      {i > 0 && <span className="text-xyne-fg-tertiary">→</span>}
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">{colLetter(i)}</span>
                      <ScoreBar score={r.avg} />
                      {delta != null && (
                        <span
                          className={`rounded px-2 py-0.5 text-[13px] font-bold ${
                            delta > 0 ? "bg-xyne-success/15 text-xyne-success" : delta < 0 ? "bg-xyne-error/15 text-xyne-error" : "text-xyne-fg-tertiary"
                          }`}
                        >
                          {delta > 0 ? "+" : ""}
                          {delta}
                        </span>
                      )}
                    </div>
                  );
                })}
                <span className="text-[11px] text-xyne-fg-tertiary">avg over {n} turn{n === 1 ? "" : "s"}</span>
              </div>

              {/* Per-conversation/turn deltas — one score column per run + Δ vs A */}
              <div className="overflow-x-auto">
                <div className="min-w-max">
                  <div className="mb-2 flex items-center gap-2 px-3 text-[10px] font-medium uppercase tracking-wide text-xyne-fg-tertiary">
                    <span className="min-w-[200px] flex-1">Conversation / turn</span>
                    {selIds.map((id, i) => (
                      <Fragment key={id}>
                        <span className="w-[88px] text-right">{colLetter(i)}</span>
                        {i > 0 && <span className="w-12 text-right">Δ</span>}
                      </Fragment>
                    ))}
                    <span className="w-4" />
                  </div>
                  <div className="flex flex-col gap-2">
                    {rows.map((row) => (
                      <div key={row.cid} className="rounded-lg border border-xyne-border-subtle">
                        <div className="flex items-center gap-2 px-3 py-2">
                          <span className="min-w-[200px] flex-1 truncate text-[12.5px] text-xyne-fg-primary">{row.title}</span>
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
                              <span className="min-w-[200px] flex-1 text-[11px] text-xyne-fg-tertiary">Message {t.idx + 1}</span>
                              {t.scores.map((s, i) => (
                                <Fragment key={i}>
                                  <ScoreBar score={s} />
                                  {i > 0 && <Delta a={t.scores[0] ?? null} b={s} />}
                                </Fragment>
                              ))}
                              <span className="w-4" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Run history (all past runs, each individually scorable) ── */
function HistoryView({
  folderName,
  folderId,
  convItems,
  scoringRunId,
  onScoreRun,
  onClose,
}: {
  folderName: string;
  folderId: string;
  convItems: EvalConversationListItem[];
  /** Run id currently being scored (any run in a comparison group counts), or null. */
  scoringRunId: string | null;
  onScoreRun: (run: GenerationMeta) => void;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<GenerationMeta[]>([]);
  const [loading, setLoading] = useState(true);
  // The run whose Q&A is open (drill-in); null = show the list.
  const [openRun, setOpenRun] = useState<GenerationMeta | null>(null);
  const [detail, setDetail] = useState<EvalGeneration | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    listGenerationsForFolder(folderId)
      .then((rs) => setRuns(rs))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [folderId]);

  // Fetch the opened run's full turn results (question / expected / answer / score).
  useEffect(() => {
    if (!openRun) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    getGeneration(openRun.id)
      .then((g) => setDetail(g))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [openRun]);

  const titleById = useMemo(() => new Map(convItems.map((c) => [c.id, c.title])), [convItems]);

  // Collapse a multi-agent comparison (same comparisonId) into one entry —
  // scoring any run in it fans across all siblings. Standalone runs stand alone.
  // The API returns runs newest-first, so groups keep that order.
  const groups = useMemo(() => {
    const out: Array<{ key: string; lead: GenerationMeta; members: GenerationMeta[] }> = [];
    const byKey = new Map<string, { key: string; lead: GenerationMeta; members: GenerationMeta[] }>();
    for (const r of runs) {
      const gid = r.comparisonId ?? `solo:${r.id}`;
      const existing = byKey.get(gid);
      if (existing) existing.members.push(r);
      else {
        const g = { key: gid, lead: r, members: [r] };
        byKey.set(gid, g);
        out.push(g);
      }
    }
    return out;
  }, [runs]);

  // The opened run's turns grouped by conversation (titled + ordered).
  const detailRows = useMemo(() => {
    const byConv = new Map<string, EvalTurnResult[]>();
    for (const t of detail?.turnResults ?? []) {
      const arr = byConv.get(t.conversationId) ?? [];
      arr.push(t);
      byConv.set(t.conversationId, arr);
    }
    return [...byConv.entries()]
      .map(([cid, ts]) => ({ cid, title: titleById.get(cid) ?? cid, turns: ts.sort((a, b) => a.turnIndex - b.turnIndex) }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [detail, titleById]);

  const fmtWhen = (iso: string) =>
    `${new Date(iso).toLocaleDateString()} ${new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const statusClass = (s: string) =>
    s === "completed"
      ? "text-xyne-success"
      : s === "failed" || s === "cancelled"
        ? "text-xyne-error"
        : "text-amber-600 dark:text-amber-400";

  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-xyne-border-subtle px-5">
        <div className="flex min-w-0 items-center gap-2">
          {openRun ? (
            <button onClick={() => setOpenRun(null)} title="Back to history" className="shrink-0 text-xyne-fg-tertiary hover:text-xyne-fg-primary">
              <CaretLeftIcon size={15} />
            </button>
          ) : (
            <ClockCounterClockwiseIcon size={15} weight="fill" className="shrink-0 text-xyne-brand" />
          )}
          <h2 className="truncate text-[14px] font-semibold text-xyne-fg-primary">{folderName}</h2>
          <span className="truncate text-[11px] text-xyne-fg-tertiary">
            · {openRun ? `${openRun.agentSlug} · ${fmtWhen(openRun.startedAt)}` : "Run history"}
          </span>
        </div>
        <button onClick={onClose} title="Close" className="text-xyne-fg-tertiary hover:text-xyne-fg-primary">
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto max-w-3xl">
          {openRun ? (
            // ── Run detail: questions + answers for the selected run ──
            detailLoading ? (
              <div className="py-10 text-center text-[12px] text-xyne-fg-tertiary">Loading answers…</div>
            ) : detailRows.length === 0 ? (
              <div className="py-10 text-center text-[12px] text-xyne-fg-tertiary">No answers recorded for this run.</div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={openRun.id === scoringRunId}
                    leadingIcon={<ScalesIcon size={12} />}
                    onClick={() => onScoreRun(openRun)}
                  >
                    {openRun.id === scoringRunId ? "Scoring…" : "Score this run"}
                  </Button>
                </div>
                {detailRows.map((row) => (
                  <div key={row.cid} className="rounded-lg border border-xyne-border-subtle">
                    <div className="border-b border-xyne-border-subtle px-3 py-2 text-[12.5px] font-medium text-xyne-fg-primary">{row.title}</div>
                    <div className="flex flex-col gap-4 px-3 py-3">
                      {row.turns.map((t) => (
                        <div key={t.id} className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Message {t.turnIndex + 1}</span>
                            {typeof t.matchScore === "number" && <ScoreBar score={t.matchScore} />}
                          </div>
                          <div className="rounded-md bg-xyne-surface-subtle px-3 py-2 text-[12.5px] text-xyne-fg-primary">{t.inputMessage}</div>
                          {t.expectedResponse && (
                            <div>
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Expected</div>
                              <div className="rounded-md border border-xyne-border-subtle px-3 py-2">
                                <EvalMarkdown tone="secondary">{t.expectedResponse}</EvalMarkdown>
                              </div>
                            </div>
                          )}
                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Answer</div>
                            <div className="rounded-md border border-xyne-border-subtle px-3 py-2">
                              {t.clawAnswer ? (
                                <EvalMarkdown tone="primary" invocations={t.toolInvocations ?? undefined}>
                                  {t.clawAnswer}
                                </EvalMarkdown>
                              ) : (
                                <span className="text-[12px] text-xyne-fg-tertiary">{t.status === "failed" ? "Run failed for this turn." : "No answer."}</span>
                              )}
                            </div>
                          </div>
                          {t.judgeReasoning && t.judgeReasoning !== "judge_unavailable" && (
                            <div className="text-[11px] text-xyne-fg-tertiary">
                              <span className="font-medium">Judge:</span> {t.judgeReasoning}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : loading ? (
            <div className="py-10 text-center text-[12px] text-xyne-fg-tertiary">Loading runs…</div>
          ) : runs.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-xyne-fg-tertiary">No runs yet. Run this project to create one.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {groups.map((g) => {
                const isComparison = !!g.lead.comparisonId && g.members.length > 1;
                const beingScored = g.members.some((m) => m.id === scoringRunId);
                return (
                  <div
                    key={g.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenRun(g.lead)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenRun(g.lead);
                      }
                    }}
                    title="View questions & answers"
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-xyne-border-subtle px-3 py-2.5 text-left transition hover:border-xyne-border hover:bg-xyne-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xyne-border-focus"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-medium text-xyne-fg-primary">
                          {g.members.map((m) => m.agentSlug).join(" · ")}
                        </span>
                        {isComparison && (
                          <span className="shrink-0 rounded bg-xyne-surface-sunken px-1.5 py-0.5 text-[10px] text-xyne-fg-tertiary">
                            comparison · {g.members.length}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-xyne-fg-tertiary">
                        <span>{fmtWhen(g.lead.startedAt)}</span>
                        {g.lead.genModel && <span>· {g.lead.genModel}</span>}
                        <span className={statusClass(g.lead.status)}>· {g.lead.status}</span>
                      </div>
                    </div>
                    <ArrowUpRightIcon size={13} className="shrink-0 text-xyne-fg-tertiary" />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={beingScored}
                      leadingIcon={<ScalesIcon size={12} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onScoreRun(g.lead);
                      }}
                    >
                      {beingScored ? "Scoring…" : "Score"}
                    </Button>
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
  onDownloadCsv: (id: string) => void;
  downloadingFolders: Set<string>;
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
  onOpenHistory: (id: string) => void;
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
            {count > 0 && (
              <button
                onClick={() => ctx.onDownloadCsv(folderId)}
                disabled={ctx.downloadingFolders.has(folderId)}
                title="Download CSV (all conversations)"
                className="opacity-70 transition group-hover:opacity-100 disabled:opacity-40"
              >
                <DownloadSimpleIcon size={13} className={`text-xyne-fg-tertiary hover:text-xyne-fg-primary ${ctx.downloadingFolders.has(folderId) ? "animate-pulse" : ""}`} />
              </button>
            )}
            <KebabMenu
              items={[
                ...(canJudge ? [{ label: "Compare runs", onClick: () => ctx.onCompareRuns(folderId) }] : []),
                ...(canJudge ? [{ label: "Run history", onClick: () => ctx.onOpenHistory(folderId) }] : []),
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

/* ── Turn: expected (gold) reference + up to 3 collapsible per-agent answers ── */
function TurnCard({
  index,
  message,
  expected,
  panes,
  onOpenDebug,
  makeOpenCitation,
  selectedCitationKey,
  citationAgent,
  onDownloadCsv,
}: {
  index: number;
  message: string;
  expected: string | null;
  /** One panel per compared agent (0-3). Empty until the eval has been run. */
  panes: TurnAgentPane[];
  onOpenDebug?: (t: LiveTurn) => void;
  makeOpenCitation?: (slug: string) => (citation: CitationRef, citationNumber: number, numbers: Map<string, number>) => void;
  selectedCitationKey?: string | null;
  /** Which agent's panel currently owns the open citation (for highlighting). */
  citationAgent?: string | null;
  onDownloadCsv?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Per-agent panel collapse — lets you fold agents you're not focusing on so the
  // remaining answers get the full width.
  const [collapsedPanes, setCollapsedPanes] = useState<Set<string>>(new Set());
  const multi = panes.length > 1;
  const anyRunning = panes.some((p) => (p.live?.status ?? "idle") === "running");
  const anyFailed = panes.some((p) => (p.live?.status ?? "idle") === "failed");
  const status: TurnStatus = anyRunning ? "running" : anyFailed ? "failed" : panes.some((p) => p.live) ? "completed" : "idle";

  return (
    <div className="border-b border-xyne-border-subtle py-4 first:pt-1 last:border-b-0">
      {/* Header: caret + M{n} + title (toggle); per-agent score chips + status. */}
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
        <span className="flex shrink-0 items-center gap-1">
          {panes.map((p) =>
            p.live?.matchScore != null ? (
              <span
                key={p.slug}
                title={multi ? `${p.name}: ${p.live.matchScore}/100` : `${p.live.matchScore}/100`}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${scoreChipClass(p.live.matchScore)}`}
              >
                {p.live.matchScore}
              </span>
            ) : null,
          )}
        </span>
        <StatusDot status={status} />
        {onDownloadCsv && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDownloadCsv(); }}
            title="Download this turn as CSV"
            aria-label="Download this turn as CSV"
            className="shrink-0 text-xyne-fg-muted opacity-60 transition hover:text-xyne-fg-primary hover:opacity-100"
          >
            <DownloadSimpleIcon size={13} />
          </button>
        )}
      </div>

      {/* Expanded: query → expected (gold) reference → per-agent answer panels. */}
      {!collapsed && (
        <div className="mt-3 space-y-4 pl-[26px]">
          <div>
            <div className="mb-1.5 text-[13px] font-bold tracking-tight text-xyne-fg-primary">Query</div>
            <div className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[12.5px] leading-relaxed text-xyne-fg-secondary">{message}</div>
          </div>
          <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5">
            <div className="mb-1.5 text-[13px] font-bold tracking-tight text-xyne-fg-primary">Expected · gold</div>
            {expected ? (
              <EvalMarkdown tone="secondary">{expected}</EvalMarkdown>
            ) : (
              <span className="text-[12.5px] text-xyne-fg-tertiary">—</span>
            )}
          </div>
          {panes.length === 0 ? (
            <div className="text-[12.5px] text-xyne-fg-tertiary">Run the eval to generate answers to compare.</div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {panes.map((p) => {
                const isCollapsed = collapsedPanes.has(p.slug);
                const live = p.live;
                return (
                  <div
                    key={p.slug}
                    className={`min-w-0 rounded-lg border border-xyne-border-subtle ${isCollapsed ? "flex-none" : "flex-1 basis-[300px]"}`}
                  >
                    <div className="flex items-center gap-2 border-b border-xyne-border-subtle px-3 py-2">
                      <button
                        onClick={() =>
                          setCollapsedPanes((s) => {
                            const n = new Set(s);
                            n.has(p.slug) ? n.delete(p.slug) : n.add(p.slug);
                            return n;
                          })
                        }
                        title={isCollapsed ? "Expand" : "Collapse"}
                        className="flex min-w-0 items-center gap-1.5 text-left"
                      >
                        <span className="shrink-0 text-xyne-fg-tertiary">
                          {isCollapsed ? <CaretRightIcon size={11} /> : <CaretDownIcon size={11} />}
                        </span>
                        <span className="min-w-0 truncate text-[12px] font-semibold text-xyne-fg-primary">
                          {multi ? p.name : `Generated · ${p.name}`}
                        </span>
                      </button>
                      {live?.matchScore != null && (
                        <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${scoreChipClass(live.matchScore)}`}>
                          {live.matchScore}
                        </span>
                      )}
                      <StatusDot status={live?.status ?? "idle"} />
                    </div>
                    {!isCollapsed && (
                      <div className="px-3 py-2.5">
                        <PaneBody
                          live={live}
                          slug={p.slug}
                          makeOpenCitation={makeOpenCitation}
                          selectedCitationKey={citationAgent === p.slug ? selectedCitationKey ?? null : null}
                          onOpenDebug={onOpenDebug}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One agent's answer body inside a comparison panel: markdown (with citations),
 *  reasoning/tools, the judge rationale, and the debug link. */
function PaneBody({
  live,
  slug,
  makeOpenCitation,
  selectedCitationKey,
  onOpenDebug,
}: {
  live: LiveTurn | undefined;
  slug: string;
  makeOpenCitation?: (slug: string) => (citation: CitationRef, citationNumber: number, numbers: Map<string, number>) => void;
  selectedCitationKey?: string | null;
  onOpenDebug?: (t: LiveTurn) => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const answer = live?.answer ?? "";
  const reasoning = live?.reasoning ?? "";
  const tools = live?.tools ?? [];
  const status = live?.status ?? "idle";
  const onOpenCitation = makeOpenCitation ? makeOpenCitation(slug) : undefined;
  return (
    <>
      {answer ? (
        <EvalMarkdown tone="primary" invocations={tools} onOpenCitation={onOpenCitation} selectedCitationKey={selectedCitationKey}>
          {answer}
        </EvalMarkdown>
      ) : (
        <span className="text-[12.5px] text-xyne-fg-tertiary">{status === "running" ? "…" : "—"}</span>
      )}
      {(reasoning || tools.length > 0) && <GeneratedMeta reasoning={reasoning} tools={tools} />}
      {(live?.judgeReasoning || live?.sessionId) && (
        <div className="mt-2 flex items-center gap-3">
          {live?.judgeReasoning && (
            <button
              onClick={() => setShowWhy(true)}
              className="inline-flex items-center gap-1 text-[10px] text-xyne-fg-muted transition hover:text-xyne-fg-secondary"
            >
              <InfoIcon size={11} /> Why this score?
            </button>
          )}
          {live?.sessionId && (
            <button
              type="button"
              onClick={() => live && onOpenDebug?.(live)}
              className="inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-xyne-fg-muted transition hover:bg-xyne-surface hover:text-xyne-fg-secondary"
            >
              <BugIcon size={11} /> Debug
            </button>
          )}
        </div>
      )}
      <Dialog open={showWhy} onOpenChange={setShowWhy} title="Why this score?">
        <div className="flex flex-col gap-3">
          {live?.matchScore != null && (
            <span className={`self-start rounded px-2 py-0.5 text-[13px] font-semibold ${scoreChipClass(live.matchScore)}`}>
              {live.matchScore}/100
            </span>
          )}
          <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">{live?.judgeReasoning}</p>
        </div>
      </Dialog>
    </>
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
