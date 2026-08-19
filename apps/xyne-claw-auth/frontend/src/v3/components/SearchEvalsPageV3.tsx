/**
 * SearchEvalsPageV3 — Vespa search retrieval-relevance testing.
 *
 * Upload a CSV of {query, gold answer, gold messageId/conversationId} rows,
 * then run it against Vespa search under a chosen config (entity types,
 * permission mode, as-of timestamp). Scoring is a pure retrieval hit-check:
 * did the gold message/conversation id show up in the top-10 results, and
 * at what rank. No LLM judge — the gold answer text is shown for reference
 * only, never scored.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  UploadSimpleIcon,
  PlayIcon,
  CheckCircleIcon,
  XCircleIcon,
  SpinnerGapIcon,
  CaretDownIcon,
  CaretRightIcon,
  ChatCircleDotsIcon,
  ArrowsClockwiseIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Dialog } from "./ui/Dialog";
import { SelectField, type SelectOption } from "./ui/SelectField";
import { TextField } from "./ui/TextField";
import {
  listSearchEvalSheets,
  uploadSearchEvalSheet,
  startSearchEvalRun,
  getSearchEvalRankProfiles,
  getSearchEvalRun,
  listSearchEvalRuns,
  downloadSearchEvalRunExport,
  type SearchEvalSheetSummary,
  type SearchEvalPermissionMode,
  type SearchEvalRunDetail,
  type SearchEvalRunSummary,
  type SearchEvalMetricsSummary,
  type SearchEvalResultRow,
  type SearchEvalTopResult,
} from "../../lib/api";

interface SearchEvalsPageV3Props {
  userId: string;
}

// Mirrors the dashboard's real cmd+k type filter (SearchFilterBar.tsx TYPE_OPTIONS /
// DOC_TYPE_REGISTRY) exactly — minus "People", which the dashboard resolves entirely
// client-side from the local user list (LOCAL_TYPES in searchFilterParser.ts) and never
// sends to Vespa, so there's no real search-relevance result to score against gold ids.
// "Calls" was never a real cmd+k dropdown option — dropped. "Channels" is dropped too
// (not offered as an eval entity type). The value stays "emails" (the backend-valid
// type both this and cmd+k's "Desk" tab actually send) — only the label is renamed
// to match how it's labeled in cmd+k.
const TYPE_OPTIONS: SelectOption[] = [
  { value: "", label: "All types" },
  { value: "messages", label: "Messages" },
  { value: "files", label: "Files" },
  { value: "tickets", label: "Tickets" },
  { value: "emails", label: "Desk" },
];

/** A run's queryType is either [] ("All types") or a single-element array —
 *  resolve it to the same label shown in the entity-type picker, for compact
 *  display in the run history list. */
function entityTypeLabel(queryType: string[]): string {
  const value = queryType[0] ?? "";
  return TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** "default_native" / "unranked" / or, when a tunable profile is running with
 *  overrides, "tunable (w_vector=0.60, w_bm25=0.20)" — only the overridden
 *  keys are listed. */
function rankProfileLabel(run: { rankProfile: string | null; rankProfileInputs: Record<string, number> | null }): string {
  if (run.rankProfileInputs && Object.keys(run.rankProfileInputs).length > 0) {
    const overrides = Object.entries(run.rankProfileInputs).map(([k, v]) => `${k}=${v}`).join(", ");
    return `${run.rankProfile || "tunable"} (${overrides})`;
  }
  return run.rankProfile || "default_native";
}

const PERMISSION_OPTIONS: SelectOption[] = [
  { value: "without", label: "Without permission (public channels/tickets/files only)" },
  { value: "with", label: "With permission (private + public, as you)" },
];

// Rank-profile choices are fetched live per entity type from
// getSearchEvalRankProfiles() (rank-profiles.ts on the backend), which reads
// Vespa's actually-deployed .sd schema and regexes out `rank-profile <name>`
// — not a hardcoded list here, so a profile added to a schema and redeployed
// (e.g. "unified") shows up without a frontend change. "" always means "let
// the backend auto-pick default_native" (see buildYqlFromParams) rather than
// sending an explicit name. "All types" gets the intersection across every
// area's schema, since Vespa applies exactly ONE ranking.profile to a
// federated query (see buildFederatedYqlFromParams).
const DEFAULT_RANK_PROFILE_OPTION: SelectOption = { value: "", label: "default_native (default)" };

/** A couple of well-known profiles get a friendlier label; anything else
 *  (a brand-new profile) just shows its own name as-is. */
const RANK_PROFILE_LABELS: Record<string, string> = {
  tunable: "tunable (custom weights)",
};

/** Covers a profile added to (or renamed in) the .sd schema after the live
 *  fetch ran, or one that getSearchEvalRankProfiles() otherwise doesn't
 *  return — the name is passed straight through to Vespa unvalidated (see
 *  buildYqlFromParams in vespa-search-areas.ts), so a typo or a profile
 *  missing from the queried schema just fails that run with Vespa's own
 *  error, shown in the results. */
const CUSTOM_RANK_PROFILE_VALUE = "__custom__";
const CUSTOM_RANK_PROFILE_OPTION: SelectOption = { value: CUSTOM_RANK_PROFILE_VALUE, label: "Custom..." };

function rankProfileOptionsFromNames(names: string[]): SelectOption[] {
  return [
    DEFAULT_RANK_PROFILE_OPTION,
    ...names
      .filter((name) => name !== "default_native")
      .map((name) => ({ value: name, label: RANK_PROFILE_LABELS[name] ?? name })),
    CUSTOM_RANK_PROFILE_OPTION,
  ];
}

interface TunableField {
  key: string;
  label: string;
  default: number;
  max: number;
  step: number;
}

/** A handful of tunable inputs are on a wider scale than the usual 0-1 weight
 *  (decay/saturation constants, id/subject boost multipliers) — everything
 *  else defaults to a 0-1 slider. Keyed by input name since several names
 *  (w_vector, w_bm25, prox_weight, weight_text, weight_people, ...) repeat
 *  identically across schemas. */
const TUNABLE_FIELD_RANGE_OVERRIDES: Record<string, { max: number; step: number }> = {
  prox_decay_t: { max: 10, step: 0.5 },
  saturation_point: { max: 200, step: 5 },
  id_weight: { max: 10, step: 0.5 },
  subject_native_weight: { max: 5, step: 0.25 },
  chunks_native_weight: { max: 5, step: 0.25 },
};

function tunableField(key: string, defaultValue: number): TunableField {
  const range = TUNABLE_FIELD_RANGE_OVERRIDES[key] ?? { max: 1, step: 0.05 };
  return { key, label: key.replace(/_/g, " "), default: defaultValue, ...range };
}

// Each entity type's `tunable` rank-profile declares its OWN distinct
// `inputs {}` block (different names, different defaults) — read directly
// off the deployed .sd schemas (see vespa-search-areas.ts's ground-truth
// comment for the source path). "channels" is absent: chat_container.sd has
// no tunable profile at all.
const TUNABLE_INPUTS_BY_AREA: Record<string, TunableField[]> = {
  messages: [
    tunableField("w_vector", 0.4),
    tunableField("w_bm25", 0.4),
    tunableField("w_prox", 0.2),
    tunableField("w_time_range", 1.0),
    tunableField("alpha_const", 0.1),
    tunableField("slack_vector_decay", 0.8),
    tunableField("weight_text", 0.6),
    tunableField("weight_username", 0.14),
    tunableField("weight_channel_name", 0.14),
    tunableField("prox_weight", 0.45),
    tunableField("prox_decay_t", 3.0),
    tunableField("saturation_point", 100.0),
  ],
  tickets: [
    tunableField("w_vector", 0.4),
    tunableField("w_bm25", 0.4),
    tunableField("w_prox", 0.1),
    tunableField("w_time_range", 1.0),
    tunableField("weight_text", 0.6),
    tunableField("weight_people", 0.14),
    tunableField("weight_mentions", 0.12),
    tunableField("weight_context", 0.14),
    tunableField("weight_tags", 0.1),
    tunableField("weight_other", 0.15),
    tunableField("prox_weight", 0.45),
    tunableField("prox_decay_t", 3.0),
    tunableField("ticket_vector_decay", 0.9),
    tunableField("id_weight", 5.0),
  ],
  files: [
    tunableField("w_vector", 0.5),
    tunableField("w_bm25", 0.5),
    tunableField("weight_filename", 0.6),
    tunableField("weight_chunks", 0.6),
    tunableField("weight_description", 0.1),
    tunableField("weight_image_chunks", 0.1),
    tunableField("w_recency", 0.2),
  ],
  emails: [
    tunableField("w_vector", 0.5),
    tunableField("w_bm25", 0.5),
    tunableField("w_recency", 1.0),
    tunableField("weight_text", 0.65),
    tunableField("weight_people", 0.2),
    tunableField("weight_entity", 0.15),
    tunableField("weight_attachment", 0.05),
    tunableField("subject_native_weight", 2.0),
    tunableField("chunks_native_weight", 1.5),
    tunableField("max_doc_decay", 0.3),
    tunableField("w_people_from", 1.0),
    tunableField("w_people_to", 0.8),
    tunableField("w_people_cc_bcc", 0.3),
  ],
};

function defaultTunableInputs(fields: TunableField[]): Record<string, number> {
  return Object.fromEntries(fields.map((f) => [f.key, f.default]));
}

const HIT_FILTER_OPTIONS: SelectOption[] = [
  { value: "", label: "All" },
  { value: "hit", label: "Hit" },
  { value: "miss", label: "Miss" },
];

// Rank can only ever be 1-10 — the worker only scores against the first
// TOP_K=10 results (see search-eval-run-worker.ts), so there's no ">10" bucket.
const RANK_FILTER_OPTIONS: SelectOption[] = [
  { value: "", label: "All ranks" },
  { value: "1", label: "Rank 1" },
  { value: "2-3", label: "Rank 2–3" },
  { value: "4-10", label: "Rank 4–10" },
  { value: "miss", label: "Miss (no rank)" },
];

function matchesRankFilter(rank: number | null, filter: string): boolean {
  switch (filter) {
    case "": return true;
    case "1": return rank === 1;
    case "2-3": return rank !== null && rank >= 2 && rank <= 3;
    case "4-10": return rank !== null && rank >= 4 && rank <= 10;
    case "miss": return rank === null;
    default: return true;
  }
}

/** Minimal CSV line parser — handles quoted fields containing commas/quotes. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

interface ParsedCsvRow {
  query: string;
  goldAnswer?: string;
  goldId: string;
}

/** Expects a header row with, at minimum, `query` and `goldId` (case-insensitive,
 *  any order; `goldAnswer` is optional, reference-only). `goldId` is the gold
 *  doc's own Vespa docId, whatever it's called for that entity type — messageId
 *  for a message, a ticket's internal id (or its human xyneId, e.g. "XYNE-13292"),
 *  a file's own id, a channelId, a callId, or an email's own id. See mapper.ts
 *  (backend/src/zero/vespa-injection/core/mapper.ts) for the authoritative
 *  per-type docId assignment. */
function parseCsv(content: string): { rows: ParsedCsvRow[] } | { error: string } {
  const lines = content.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { error: "CSV needs a header row and at least one data row." };
  const header = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const queryIdx = header.indexOf("query");
  if (queryIdx === -1) return { error: 'CSV header must include a "query" column.' };
  const goldIdIdx = header.indexOf("goldid") !== -1 ? header.indexOf("goldid") : header.indexOf("gold id");
  if (goldIdIdx === -1) return { error: 'CSV header must include a "goldId" column.' };
  const goldAnswerIdx = header.indexOf("goldanswer") !== -1 ? header.indexOf("goldanswer") : header.indexOf("gold answer");

  const rows: ParsedCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]!);
    const query = fields[queryIdx]?.trim();
    if (!query) continue;
    const goldId = fields[goldIdIdx]?.trim();
    if (!goldId) return { error: `Row ${i + 1}: goldId is required (query "${query}" has none).` };
    rows.push({
      query,
      goldAnswer: goldAnswerIdx !== -1 ? fields[goldAnswerIdx] : undefined,
      goldId,
    });
  }
  if (rows.length === 0) return { error: "No data rows found." };
  return { rows };
}

function UploadSheetDialog({
  userId,
  open,
  onClose,
  onUploaded,
}: {
  userId: string;
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissionMode, setPermissionMode] = useState<SearchEvalPermissionMode>("with");
  const [asOfTimestamp, setAsOfTimestamp] = useState<string>("");
  const [rows, setRows] = useState<ParsedCsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = typeof ev.target?.result === "string" ? ev.target.result : "";
      const parsed = parseCsv(content);
      if ("error" in parsed) {
        setErr(parsed.error);
        setRows([]);
        return;
      }
      setRows(parsed.rows);
    };
    reader.onerror = () => {
      setErr("Failed to read file. Please try again.");
      setFileName("");
      setRows([]);
    };
    reader.readAsText(file);
  }

  function reset() {
    setName("");
    setDescription("");
    setPermissionMode("with");
    setAsOfTimestamp("");
    setRows([]);
    setFileName("");
    setErr(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit() {
    if (!name.trim() || rows.length === 0) return;
    setUploading(true);
    setErr(null);
    try {
      await uploadSearchEvalSheet(
        {
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          permissionMode,
          ...(asOfTimestamp ? { asOfTimestamp: new Date(asOfTimestamp).toISOString() } : {}),
          queries: rows,
        },
        userId,
      );
      reset();
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
      onOpenChange={(newOpen) => { if (!newOpen) { reset(); onClose(); } }}
      title="Upload search-eval sheet"
      leftOffset={100}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={!name.trim() || rows.length === 0 || uploading} onClick={submit}>
            {uploading ? "Uploading…" : `Upload${rows.length ? ` (${rows.length} rows)` : ""}`}
          </Button>
        </>
      }
    >
      <p className="text-[12px] text-xyne-fg-secondary">
        A CSV with columns <code>query</code>, <code>goldId</code>, and optionally <code>goldAnswer</code>.{" "}
        <code>query</code> and <code>goldId</code> are both required. <code>goldId</code> is the gold doc's own
        Vespa id — messageId for a message, a ticket's internal id (or its human xyneId, e.g. "XYNE-13292"), a
        file's own id, a channelId, a callId, or an email's own id — scoring checks whether it appears in the
        top-10 search results. <code>goldAnswer</code> is stored for reference only, never scored.
      </p>

      <div>
        <label className="mb-[4px] block text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
          Eval name <span className="text-xyne-error-fg normal-case">*</span>
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Support search regression set"
          required
          className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-[4px] block text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
          Goal (optional)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is the goal of this eval? e.g. Regression set for support-desk search quality"
          rows={2}
          className="w-full resize-none rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-[4px] block text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
          CSV file
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileSelect}
          className="block w-full text-[12px] text-xyne-fg-secondary file:mr-[8px] file:rounded-lg file:border file:border-xyne-border file:bg-xyne-surface-sunken file:px-[10px] file:py-[6px] file:text-[12px] file:text-xyne-fg-primary hover:file:bg-xyne-surface-subtle"
        />
        {fileName && !err && <p className="mt-[4px] text-[11px] text-xyne-fg-tertiary">{fileName} — {rows.length} rows parsed</p>}
      </div>

      <SelectField
        label="Permission"
        options={PERMISSION_OPTIONS}
        value={permissionMode}
        onValueChange={(v) => setPermissionMode((v as SearchEvalPermissionMode) ?? "with")}
      />
      <div>
        <label className="mb-[4px] block text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
          As of (optional — searches only data before this time)
        </label>
        <input
          type="datetime-local"
          value={asOfTimestamp}
          onChange={(e) => setAsOfTimestamp(e.target.value)}
          className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
        />
      </div>

      {err && (
        <div className="rounded-lg border border-xyne-border bg-xyne-error-bg p-[10px] text-[11px] text-xyne-error-fg">
          {err}
        </div>
      )}
    </Dialog>
  );
}

/** Sliders for the current entity type's real `tunable` rank-profile inputs
 *  — field set, defaults, and ranges come from TUNABLE_INPUTS_BY_AREA, which
 *  differs per entity type (see its comment for the schema source). */
function TunableRankInputsEditor({
  fields,
  value,
  onChange,
}: {
  fields: TunableField[];
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface p-[12px] space-y-[10px]">
      {fields.map(({ key, label, max, step }) => (
        <div key={key}>
          <div className="mb-[2px] flex items-center justify-between">
            <label className="text-[11px] font-medium capitalize text-xyne-fg-primary">{label}</label>
            <span className="font-mono text-[11px] text-xyne-fg-tertiary">{(value[key] ?? 0).toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={max}
            step={step}
            value={value[key] ?? 0}
            onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
            className="w-full accent-xyne-brand"
          />
        </div>
      ))}
    </div>
  );
}

function RunConfigDialog({
  userId,
  sheet,
  onClose,
  onStarted,
}: {
  userId: string;
  sheet: SearchEvalSheetSummary;
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const [queryType, setQueryType] = useState<string>("");
  const [rankProfile, setRankProfile] = useState<string>("");
  const [customRankProfile, setCustomRankProfile] = useState<string>("");
  const [tunableInputs, setTunableInputs] = useState<Record<string, number>>({});
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fetched live from Vespa's deployed schema per queryType (see
  // getSearchEvalRankProfiles) rather than a hardcoded per-type list.
  const [rankProfileOptions, setRankProfileOptions] = useState<SelectOption[]>([DEFAULT_RANK_PROFILE_OPTION]);
  const [rankProfilesLoading, setRankProfilesLoading] = useState(false);
  const [rankProfilesErr, setRankProfilesErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRankProfilesLoading(true);
    setRankProfilesErr(null);
    getSearchEvalRankProfiles(queryType, userId)
      .then((names) => {
        if (cancelled) return;
        setRankProfileOptions(rankProfileOptionsFromNames(names));
      })
      .catch((e) => {
        if (cancelled) return;
        setRankProfilesErr(e instanceof Error ? e.message : String(e));
        setRankProfileOptions([DEFAULT_RANK_PROFILE_OPTION]);
      })
      .finally(() => { if (!cancelled) setRankProfilesLoading(false); });
    return () => { cancelled = true; };
  }, [queryType, userId]);

  const tunableFields = TUNABLE_INPUTS_BY_AREA[queryType] ?? [];
  const isTunable = rankProfile === "tunable" && tunableFields.length > 0;
  const isCustomRankProfile = rankProfile === CUSTOM_RANK_PROFILE_VALUE;
  // The name actually sent to the backend — the sentinel is a UI-only pick.
  const effectiveRankProfile = isCustomRankProfile ? customRankProfile.trim() : rankProfile;

  function handleQueryTypeChange(v: string) {
    setQueryType(v);
    setRankProfile("");
    setCustomRankProfile("");
    setTunableInputs(defaultTunableInputs(TUNABLE_INPUTS_BY_AREA[v] ?? []));
  }

  function handleRankProfileChange(v: string) {
    setRankProfile(v);
    if (v === "tunable") setTunableInputs(defaultTunableInputs(tunableFields));
    if (v !== CUSTOM_RANK_PROFILE_VALUE) setCustomRankProfile("");
  }

  async function submit() {
    setStarting(true);
    setErr(null);
    try {
      const { runId } = await startSearchEvalRun(
        sheet.id,
        {
          queryType: queryType ? [queryType] : [],
          ...(effectiveRankProfile ? { rankProfile: effectiveRankProfile } : {}),
          ...(isTunable ? { rankProfileInputs: tunableInputs } : {}),
        },
        userId,
      );
      onStarted(runId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(newOpen) => { if (!newOpen) onClose(); }}
      title={`Run "${sheet.name}"`}
      description={
        `${sheet._count.queries} queries · ${sheet.permissionMode} permission` +
        (sheet.asOfTimestamp ? ` · as of ${new Date(sheet.asOfTimestamp).toLocaleString()}` : "") +
        " (set at upload)"
      }
      leftOffset={100}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<PlayIcon size={14} />}
            disabled={starting || (isCustomRankProfile && customRankProfile.trim() === "")}
            onClick={submit}
          >
            {starting ? "Starting…" : "Run"}
          </Button>
        </>
      }
    >
      {sheet.description && (
        <p className="text-[12px] text-xyne-fg-secondary"><span className="font-medium text-xyne-fg-primary">Goal:</span> {sheet.description}</p>
      )}
      <SelectField label="Entity type" options={TYPE_OPTIONS} value={queryType} onValueChange={(v) => handleQueryTypeChange(v ?? "")} />
      <SelectField label="Rank profile" options={rankProfileOptions} value={rankProfile} onValueChange={(v) => handleRankProfileChange(v ?? "")} />
      {isCustomRankProfile && (
        <TextField
          label="Custom rank profile name"
          placeholder="e.g. a profile just added to the .sd schema"
          hint="Sent to Vespa as-is — not validated against a known list. A typo or a profile missing from the queried schema fails that run with Vespa's error."
          value={customRankProfile}
          onChange={(e) => setCustomRankProfile(e.target.value)}
        />
      )}
      {rankProfilesLoading && (
        <p className="text-[11px] text-xyne-fg-tertiary">Reading rank profiles from Vespa…</p>
      )}
      {rankProfilesErr && (
        <p className="text-[11px] text-xyne-error-fg">Couldn't fetch rank profiles from Vespa ({rankProfilesErr}) — only the default is available.</p>
      )}
      {!rankProfilesLoading && !rankProfilesErr && queryType === "" && (
        <p className="text-[11px] text-xyne-fg-tertiary">"All types" only offers profiles common to every schema. Pick a single entity type to unlock its full list (incl. tunable).</p>
      )}
      {isTunable && (
        <TunableRankInputsEditor fields={tunableFields} value={tunableInputs} onChange={setTunableInputs} />
      )}
      {err && (
        <div className="rounded-lg border border-xyne-border bg-xyne-error-bg p-[10px] text-[11px] text-xyne-error-fg">
          {err}
        </div>
      )}
    </Dialog>
  );
}

function TopKBreakdown({ summary }: { summary: SearchEvalMetricsSummary }) {
  if (summary.queriesScored === 0) return null;
  const stats: Array<{ label: string; count: number; pct: number | null }> = [
    { label: "Top 1", count: summary.top1.count, pct: summary.top1.pct },
    { label: "Top 3", count: summary.top3.count, pct: summary.top3.pct },
    { label: "Top 10", count: summary.top10.count, pct: summary.top10.pct },
  ];
  return (
    <div className="mb-[16px] grid grid-cols-4 gap-[12px]">
      {stats.map(({ label, count, pct }) => (
        <div key={label} className="rounded-xl border border-xyne-border bg-xyne-surface p-[12px]">
          <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">{label}</p>
          <p className="mt-1 text-[15px] font-medium text-xyne-fg-primary">
            {pct !== null ? `${Math.round(pct * 100)}%` : "—"}
            <span className="ml-1 text-[11px] text-xyne-fg-tertiary">({count}/{summary.queriesScored})</span>
          </p>
        </div>
      ))}
      <div className="rounded-xl border border-xyne-border bg-xyne-surface p-[12px]">
        <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Overall MRR</p>
        <p className="mt-1 text-[15px] font-medium text-xyne-fg-primary">
          {summary.mrr !== null ? summary.mrr.toFixed(3) : "—"}
        </p>
      </div>
    </div>
  );
}

/** Dumps every query's exact request + generated YQL to the browser console,
 *  grouped per query, so each permission/type/date case can be eyeballed and
 *  confirmed directly — no need to dig through backend server logs. */
function logRunToConsole(detail: SearchEvalRunDetail): void {
  // eslint-disable-next-line no-console
  console.group(
    `[Search Evals] "${detail.run.sheetName}"${detail.run.sheetDescription ? ` — Goal: ${detail.run.sheetDescription}` : ""} — Run ${detail.run.id} — ${detail.run.permissionMode} permission, ` +
    `${detail.run.queryType.length > 0 ? detail.run.queryType.join(", ") : "all types"}` +
    `, rank profile: ${rankProfileLabel(detail.run)}` +
    `${detail.run.asOfTimestamp ? `, as of ${detail.run.asOfTimestamp}` : ""}`,
  );
  for (const row of detail.rows) {
    // eslint-disable-next-line no-console
    console.group(`${row.hit ? `✅ HIT rank ${row.rank}` : "❌ MISS"} — "${row.query}"`);
    // eslint-disable-next-line no-console
    console.log("goldId:", row.goldId);
    if (row.debug && row.debug.length > 0) {
      for (const stage of row.debug) {
        // eslint-disable-next-line no-console
        console.log(`[${stage.stage}] YQL:\n${stage.yql}`);
        // eslint-disable-next-line no-console
        console.log(`[${stage.stage}] params:`, stage.vespaParams);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log("(no YQL captured for this row)");
    }
    // eslint-disable-next-line no-console
    console.log("top results:", row.topResults);
    // eslint-disable-next-line no-console
    console.groupEnd();
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}

/** Vespa rank-profile inputs are always sent as `input.query(<name>)` params
 *  (alpha, freshness_weight, query_length, time_from/time_to, etc.) — pull
 *  those out of a debug stage's raw vespaParams so they're easy to scan
 *  without hunting through the full payload dump. */
function rankProfileInputs(vespaParams: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(vespaParams).filter(([k]) => k.startsWith("input.query("));
}

/** Pulls a result's per-hit rank feature breakdown (bm25(text), vector_score,
 *  combined_nativeRank, etc. — whatever the active rank profile's
 *  `match-features {}` block declares) out of its raw object. */
function matchFeaturesOf(result: SearchEvalTopResult): Record<string, unknown> | null {
  const raw = result.raw as { debugInfo?: { matchfeatures?: Record<string, unknown> } } | null | undefined;
  return raw?.debugInfo?.matchfeatures ?? null;
}

/** Row-click debug view: the rank profile actually used (name + every
 *  input.query(...) parameter value sent), the raw YQL per stage, and the
 *  top-20 fetched results (10 past the scoring cutoff) so a miss can be
 *  confirmed as "not indexed for this query" vs. "ranked just outside top 10". */
function QueryDebugDialog({ row, onClose }: { row: SearchEvalResultRow; onClose: () => void }) {
  const results = row.topResults ?? [];
  const goldIdx = results.findIndex((r) => (r.id && r.id === row.goldId) || (r.xyneId && r.xyneId === row.goldId));
  const [selectedIdx, setSelectedIdx] = useState(goldIdx !== -1 ? goldIdx : 0);
  const selected = results[selectedIdx] ?? null;

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={row.query}
      description={`goldId: ${row.goldId} · ${row.hit ? `hit at rank ${row.rank}` : "miss"}`}
      leftOffset={100}
      maxWidth={1560}
      maxHeight="85vh"
      bodyClassName="flex-1 overflow-hidden p-[var(--comp-dialog-padding)]"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Close</Button>}
    >
      <div className="max-h-[calc(85vh-140px)] min-w-0 w-full space-y-[20px] overflow-y-auto pr-[4px]">
        {(!row.debug || row.debug.length === 0) && (
          <p className="text-[12px] text-xyne-fg-tertiary">No YQL/debug info captured for this row.</p>
        )}
        {row.debug?.map((stage, i) => {
          const inputs = rankProfileInputs(stage.vespaParams);
          const profile = (stage.vespaParams as Record<string, unknown>)["ranking.profile"];
          return (
            <div key={i} className="rounded-xl border border-xyne-border bg-xyne-surface p-[12px]">
              <p className="mb-[8px] text-[11px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
                [{stage.stage}] rank profile: <span className="text-xyne-fg-primary normal-case">{String(profile ?? "—")}</span>
              </p>
              {/* Side by side once there's room — inputs table stays a fixed
                  readable width, YQL takes the rest, instead of stacking. */}
              <div className="flex min-w-0 flex-col gap-[12px] lg:flex-row">
                {inputs.length > 0 && (
                  <table className="w-full shrink-0 self-start text-[11px] lg:w-[340px]">
                    <tbody>
                      {inputs.map(([k, v]) => (
                        <tr key={k} className="border-b border-xyne-border-subtle last:border-0">
                          <td className="py-[3px] pr-[12px] font-mono text-xyne-fg-tertiary">{k}</td>
                          <td className="py-[3px] font-mono text-xyne-fg-primary">{JSON.stringify(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <pre className="max-h-[220px] min-w-0 flex-1 overflow-auto break-words rounded-lg bg-xyne-surface-sunken p-[8px] text-[10.5px] leading-[1.4] text-xyne-fg-secondary whitespace-pre-wrap">
                  {stage.yql}
                </pre>
              </div>
            </div>
          );
        })}

        <div>
          <p className="mb-[8px] text-[11px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
            Top {results.length} results — click a row to inspect its full values
          </p>
          <div className="grid min-w-0 grid-cols-1 gap-[12px] lg:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]">
            <div className="min-w-0 max-h-[420px] overflow-auto rounded-xl border border-xyne-border">
              <table className="w-full text-[11.5px]">
                <thead className="sticky top-0">
                  <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-xyne-fg-tertiary">
                    <th className="px-[10px] py-[6px] font-medium">#</th>
                    <th className="px-[10px] py-[6px] font-medium">Type</th>
                    <th className="px-[10px] py-[6px] font-medium">ID</th>
                    <th className="px-[10px] py-[6px] font-medium">Relevance</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, idx) => {
                    const isGold = (r.id && r.id === row.goldId) || (r.xyneId && r.xyneId === row.goldId);
                    // "All types" merges results from N single-schema queries
                    // (see search-eval-vespa.ts) — raw.type is the docType
                    // transformHit() stamped on this specific hit (message,
                    // file, ticket, channel, mail, ...), the only way to tell
                    // which stage/area a given merged row actually came from.
                    const resultType = typeof r.raw?.["type"] === "string" ? (r.raw["type"] as string) : null;
                    return (
                      <tr
                        key={idx}
                        onClick={() => setSelectedIdx(idx)}
                        className={`cursor-pointer border-b border-xyne-border-subtle last:border-0 hover:bg-xyne-surface-subtle ${
                          idx === selectedIdx ? "bg-xyne-surface-subtle" : ""
                        } ${isGold ? "bg-xyne-success/10" : ""} ${idx >= 10 ? "opacity-60" : ""}`}
                      >
                        <td className="px-[10px] py-[6px] text-xyne-fg-tertiary">{idx + 1}</td>
                        <td className="px-[10px] py-[6px] text-xyne-fg-secondary">{resultType ?? "—"}</td>
                        <td className="max-w-[220px] truncate px-[10px] py-[6px] font-mono text-xyne-fg-primary" title={r.id ?? ""}>
                          {isGold && <span className="mr-1 text-xyne-success-fg">★</span>}
                          {r.id ?? "—"}
                        </td>
                        <td className="px-[10px] py-[6px] text-xyne-fg-secondary">{r.relevanceScore?.toFixed(4) ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="min-w-0 max-h-[420px] overflow-auto rounded-xl border border-xyne-border bg-xyne-surface-sunken p-[10px]">
              {selected ? (
                <>
                  <p className="mb-[6px] text-[11px] font-medium text-xyne-fg-tertiary">
                    #{selectedIdx + 1} — all values
                  </p>
                  <pre className="break-words text-[10.5px] leading-[1.4] text-xyne-fg-secondary whitespace-pre-wrap">
                    {JSON.stringify(selected.raw ?? selected, null, 2)}
                  </pre>
                </>
              ) : (
                <p className="text-[11px] text-xyne-fg-tertiary">No results.</p>
              )}
            </div>
          </div>
          <p className="mt-[6px] text-[10.5px] text-xyne-fg-tertiary">Rows past #10 (dimmed) are fetched for debugging only — not counted for hit/rank scoring.</p>
        </div>

        <MatchFeaturesTable results={results} goldId={row.goldId} />
      </div>
    </Dialog>
  );
}

/** match-features (bm25(text), vector_score, combined_nativeRank, etc. — whatever
 *  the active rank profile declares) laid out with features as COLUMNS and one
 *  row per result, so values are comparable across all 20 results at a glance —
 *  a per-result vertical dump doesn't work for that; this does. Column set is
 *  the union across all results, since different doc types (in an "All types"
 *  run) can carry different feature sets. */
function MatchFeaturesTable({ results, goldId }: { results: SearchEvalTopResult[]; goldId: string }) {
  const withFeatures = results.map((r, idx) => ({ idx, r, features: matchFeaturesOf(r) })).filter((x) => x.features);
  if (withFeatures.length === 0) return null;

  const columns = Array.from(new Set(withFeatures.flatMap((x) => Object.keys(x.features!)))).sort();

  return (
    <div>
      <p className="mb-[8px] text-[11px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
        Match features
      </p>
      <div className="min-w-0 overflow-x-auto rounded-xl border border-xyne-border">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-xyne-fg-tertiary">
              <th className="sticky left-0 bg-xyne-surface-subtle px-[10px] py-[6px] font-medium">#</th>
              <th className="sticky left-[28px] bg-xyne-surface-subtle px-[10px] py-[6px] font-medium">ID</th>
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-[10px] py-[6px] font-medium font-mono">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {withFeatures.map(({ idx, r, features }) => {
              const isGold = (r.id && r.id === goldId) || (r.xyneId && r.xyneId === goldId);
              return (
                <tr key={idx} className={`border-b border-xyne-border-subtle last:border-0 ${isGold ? "bg-xyne-success/10" : ""}`}>
                  <td className="sticky left-0 bg-xyne-surface px-[10px] py-[6px] text-xyne-fg-tertiary">{idx + 1}</td>
                  <td className="sticky left-[28px] max-w-[140px] truncate bg-xyne-surface px-[10px] py-[6px] font-mono text-xyne-fg-primary" title={r.id ?? ""}>
                    {isGold && <span className="mr-1 text-xyne-success-fg">★</span>}
                    {r.id ?? "—"}
                  </td>
                  {columns.map((c) => {
                    const v = features![c];
                    return (
                      <td key={c} className="whitespace-nowrap px-[10px] py-[6px] font-mono text-xyne-fg-secondary">
                        {typeof v === "number" ? v.toFixed(4) : v !== undefined ? String(v) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunResultsView({ userId, runId }: { userId: string; runId: string }) {
  const [detail, setDetail] = useState<SearchEvalRunDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [debugRow, setDebugRow] = useState<SearchEvalResultRow | null>(null);
  const [search, setSearch] = useState("");
  const [hitFilter, setHitFilter] = useState<string>("");
  const [rankFilter, setRankFilter] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const loggedRef = useRef(false);

  async function handleExport() {
    setExporting(true);
    setExportErr(null);
    try {
      await downloadSearchEvalRunExport(runId, userId);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    setDetail(null);
    setErr(null);
    loggedRef.current = false;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = await getSearchEvalRun(runId, userId);
        if (cancelled) return;
        setDetail(d);
        if (d.run.status === "running") {
          timer = setTimeout(poll, 2000);
        } else if (!loggedRef.current) {
          loggedRef.current = true;
          logRunToConsole(d);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [runId, userId]);

  const allRows = detail?.rows ?? [];
  const filteredRows = allRows.filter((row) => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!row.query.toLowerCase().includes(q) && !row.goldId.toLowerCase().includes(q)) return false;
    }
    if (hitFilter === "hit" && row.hit !== true) return false;
    if (hitFilter === "miss" && row.hit !== false) return false;
    if (!matchesRankFilter(row.rank, rankFilter)) return false;
    return true;
  });

  return (
    <div className="max-w-[1000px]">
      <div className="mb-[16px] flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-xyne-fg-primary">
            Run results{detail ? ` — ${detail.run.sheetName}` : ""}
          </h2>
          {detail?.run.sheetDescription && (
            <p className="mt-[4px] text-[13px] font-medium text-xyne-fg-primary">
              <span className="text-xyne-fg-tertiary font-normal uppercase tracking-[0.06em] text-[10px] mr-[6px]">Goal</span>
              {detail.run.sheetDescription}
            </p>
          )}
          {detail && (
            <p className="mt-1 text-[12px] text-xyne-fg-tertiary">
              {new Date(detail.run.startedAt).toLocaleString()} · {detail.run.permissionMode} permission
              {detail.run.queryType.length > 0 ? ` · ${detail.run.queryType.join(", ")}` : " · all types"}
              {` · rank profile: ${rankProfileLabel(detail.run)}`}
              {detail.run.asOfTimestamp ? ` · as of ${new Date(detail.run.asOfTimestamp).toLocaleString()}` : ""}
            </p>
          )}
        </div>
        {detail && (
          <div className="flex shrink-0 items-center gap-[8px]">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<DownloadSimpleIcon size={14} />}
              disabled={exporting}
              onClick={() => void handleExport()}
            >
              {exporting ? "Exporting…" : "Download .xlsx"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => logRunToConsole(detail)}>
              Log queries to console
            </Button>
          </div>
        )}
      </div>

      {exportErr && <div className="mb-[12px] rounded-lg border border-xyne-border bg-xyne-error-bg p-[10px] text-[11px] text-xyne-error-fg">{exportErr}</div>}
      {err && <div className="rounded-lg border border-xyne-border bg-xyne-error-bg p-[10px] text-[11px] text-xyne-error-fg">{err}</div>}

      {!detail ? (
        <div className="flex items-center gap-2 text-[12px] text-xyne-fg-muted"><SpinnerGapIcon size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <>
          <div className="mb-[16px] flex items-center gap-[24px] rounded-xl border border-xyne-border bg-xyne-surface p-[16px]">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Status</p>
              <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-xyne-fg-primary">
                {detail.run.status === "running" && <SpinnerGapIcon size={14} className="animate-spin" />}
                {detail.run.status === "completed" && <CheckCircleIcon size={14} className="text-emerald-500" />}
                {detail.run.status === "failed" && <XCircleIcon size={14} className="text-red-500" />}
                {detail.run.status}
                {detail.progress ? ` (${detail.progress.queriesDone}/${detail.progress.queriesTotal})` : ""}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Queries scored</p>
              <p className="mt-1 text-[13px] font-medium text-xyne-fg-primary">
                {detail.summary.queriesScored}/{detail.summary.queriesTotal}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Overall MRR</p>
              <p className="mt-1 text-[13px] font-medium text-xyne-fg-primary">
                {detail.summary.mrr !== null ? detail.summary.mrr.toFixed(3) : "—"}
              </p>
            </div>
          </div>

          <TopKBreakdown summary={detail.summary} />

          <div className="mb-[10px] flex items-end gap-[8px]">
            <div className="w-[260px]">
              <label className="mb-[4px] block text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
                Search
              </label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Query or gold ID…"
                className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
              />
            </div>
            <div className="w-[140px]">
              <SelectField label="Hit" options={HIT_FILTER_OPTIONS} value={hitFilter} onValueChange={(v) => setHitFilter(v ?? "")} />
            </div>
            <div className="w-[160px]">
              <SelectField label="Rank" options={RANK_FILTER_OPTIONS} value={rankFilter} onValueChange={(v) => setRankFilter(v ?? "")} />
            </div>
            {(search || hitFilter || rankFilter) && (
              <span className="text-[11px] text-xyne-fg-tertiary">{filteredRows.length}/{allRows.length} rows</span>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-xyne-border">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-xyne-fg-tertiary">
                  <th className="px-[12px] py-[8px] font-medium">Query</th>
                  <th className="px-[12px] py-[8px] font-medium">Gold ID</th>
                  <th className="px-[12px] py-[8px] font-medium">Gold answer</th>
                  <th className="px-[12px] py-[8px] font-medium">Hit</th>
                  <th className="px-[12px] py-[8px] font-medium">Rank</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-[12px] py-[16px] text-center text-xyne-fg-tertiary">No rows match the current filters.</td>
                  </tr>
                )}
                {filteredRows.map((row) => (
                  <tr
                    key={row.queryId}
                    onClick={() => setDebugRow(row)}
                    className="cursor-pointer border-b border-xyne-border last:border-0 hover:bg-xyne-surface-subtle"
                    title="Click to see rank profile params + top-20 results"
                  >
                    <td className="max-w-[280px] truncate px-[12px] py-[8px] text-xyne-fg-primary" title={row.query}>{row.query}</td>
                    <td className="max-w-[160px] truncate px-[12px] py-[8px] text-xyne-fg-secondary font-mono text-[11px]" title={row.goldId}>{row.goldId}</td>
                    <td className="max-w-[320px] truncate px-[12px] py-[8px] text-xyne-fg-secondary" title={row.goldAnswer ?? ""}>{row.goldAnswer ?? "—"}</td>
                    <td className="px-[12px] py-[8px]">
                      {row.hit === null ? (
                        <span className="text-xyne-fg-tertiary">—</span>
                      ) : row.hit ? (
                        <Badge as="span" variant="success" size="sm" label="Hit" />
                      ) : (
                        <Badge as="span" variant="error" size="sm" label="Miss" />
                      )}
                    </td>
                    <td className="px-[12px] py-[8px] text-xyne-fg-primary">{row.rank ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {debugRow && <QueryDebugDialog row={debugRow} onClose={() => setDebugRow(null)} />}
    </div>
  );
}

/** Compact relative-time label for run-history rows (chat-list style). */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === "running") return <SpinnerGapIcon size={12} className="shrink-0 animate-spin text-xyne-fg-tertiary" />;
  if (status === "completed") return <CheckCircleIcon size={12} className="shrink-0 text-emerald-500" />;
  return <XCircleIcon size={12} className="shrink-0 text-red-500" />;
}

/** One sheet row in the left panel — expands to show its run history (a
 *  "chat list" of past runs), lazy-loaded on first expand. */
function SheetNode({
  userId,
  sheet,
  expanded,
  onToggle,
  onNewRun,
  selectedRunId,
  onSelectRun,
  refreshKey,
}: {
  userId: string;
  sheet: SearchEvalSheetSummary;
  expanded: boolean;
  onToggle: () => void;
  onNewRun: () => void;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  refreshKey: number;
}) {
  const [runs, setRuns] = useState<SearchEvalRunSummary[] | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (first: boolean) => {
      if (first) setLoadingRuns(true);
      try {
        const r = await listSearchEvalRuns(sheet.id, userId);
        if (cancelled) return;
        setRuns(r);
        // Keep polling while any run in the list is still in progress — otherwise
        // a run that completes after its row is first fetched stays showing its
        // spinner/"0/N" forever, since nothing else re-triggers this effect.
        if (r.some((run) => run.status === "running")) {
          timer = setTimeout(() => poll(false), 2000);
        }
      } finally {
        if (first && !cancelled) setLoadingRuns(false);
      }
    };
    void poll(true);
    return () => { cancelled = true; clearTimeout(timer); };
    // refreshKey bump re-fetches after a new run starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, sheet.id, userId, refreshKey]);

  return (
    <div>
      <div
        className="group flex cursor-pointer items-center gap-1.5 px-2 py-1.5 hover:bg-xyne-surface-subtle"
        onClick={onToggle}
      >
        {expanded ? <CaretDownIcon size={12} className="shrink-0 text-xyne-fg-tertiary" /> : <CaretRightIcon size={12} className="shrink-0 text-xyne-fg-tertiary" />}
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] text-xyne-fg-primary"
          title={
            (sheet.description ? `Goal: ${sheet.description}\n\n` : "") +
            `${sheet.permissionMode} permission` +
            (sheet.asOfTimestamp ? ` · as of ${new Date(sheet.asOfTimestamp).toLocaleString()}` : "")
          }
        >
          {sheet.name}
        </span>
        <span className="shrink-0 text-[10.5px] text-xyne-fg-tertiary">{sheet._count.queries}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onNewRun(); }}
          title="New run"
          className="shrink-0 rounded p-0.5 text-xyne-fg-tertiary opacity-0 hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary group-hover:opacity-100"
        >
          <PlayIcon size={12} />
        </button>
      </div>

      {expanded && (
        <div className="ml-[20px] border-l border-xyne-border-subtle pl-2">
          {loadingRuns ? (
            <div className="px-2 py-1.5 text-[11px] text-xyne-fg-tertiary">Loading…</div>
          ) : !runs || runs.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-xyne-fg-tertiary">No runs yet.</div>
          ) : (
            runs.map((run) => (
              <button
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-xyne-surface-subtle ${
                  selectedRunId === run.id ? "bg-xyne-surface-subtle" : ""
                }`}
              >
                <RunStatusIcon status={run.status} />
                {/* Not truncated, not individually scrollable — a per-row scrollbar
                    means scrolling one row at a time to reach MRR. Instead this
                    renders at its full natural width and the SIDEBAR PANEL itself
                    scrolls horizontally (overflow-x-auto on the list container
                    above) as one unit, same scroll position for every row. */}
                <span className="shrink-0 whitespace-nowrap text-[11.5px] text-xyne-fg-secondary">
                  {relativeTime(run.startedAt)} · {entityTypeLabel(run.queryType)} · {rankProfileLabel(run)}
                  {run.summary && run.summary.queriesScored > 0 ? ` · MRR ${run.summary.mrr?.toFixed(2) ?? "—"}` : ""}
                </span>
                <span className="shrink-0 text-[10.5px] text-xyne-fg-tertiary">{run._count.results}/{sheet._count.queries}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function SearchEvalsPageV3({ userId }: SearchEvalsPageV3Props) {
  const [sheets, setSheets] = useState<SearchEvalSheetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [runConfigSheet, setRunConfigSheet] = useState<SearchEvalSheetSummary | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);

  // Left-docked, resizable sidebar — width persists across visits (own
  // localStorage key so it doesn't collide with the similar resizers in
  // EvalsPageV3.tsx). Dragging right grows it (unlike a right-docked panel,
  // where growing is dragging left) since the sidebar is pinned to the left edge.
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try { const s = localStorage.getItem("search-evals-sidebar-width"); return s ? parseInt(s, 10) : 320; } catch { return 320; }
  });
  const handleSidebarResizeStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX; const startWidth = sidebarWidth; let cur = startWidth;
    const onMove = (ev: MouseEvent) => { cur = Math.max(240, Math.min(760, startWidth + (ev.clientX - startX))); setSidebarWidth(cur); };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); try { localStorage.setItem("search-evals-sidebar-width", String(cur)); } catch { /* ignore */ } };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setSheets(await listSearchEvalSheets(userId));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void reload(); }, [reload]);

  const toggleSheet = (sheetId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sheetId)) next.delete(sheetId); else next.add(sheetId);
      return next;
    });
  };

  return (
    <div className="flex h-full w-full flex-row overflow-hidden">
      {/* ── Sheets + run history panel ── */}
      <section className="flex shrink-0 flex-col" style={{ width: sidebarWidth }}>
        <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-xyne-border-subtle px-3">
          <span className="text-[13px] font-semibold text-xyne-fg-primary">Search Evals</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void reload()}
              title="Refresh"
              className="rounded p-1 text-xyne-fg-tertiary hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
            >
              <ArrowsClockwiseIcon size={15} />
            </button>
            <button
              onClick={() => setShowUpload(true)}
              title="Upload sheet"
              className="rounded p-1 text-xyne-fg-tertiary hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
            >
              <UploadSimpleIcon size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-auto py-1">
          {loading ? (
            <div className="px-3 py-6 text-center text-[12px] text-xyne-fg-tertiary">Loading…</div>
          ) : sheets.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-xyne-fg-tertiary">
              No sheets yet.
              <br />
              Click <span className="font-medium">Upload</span> to start.
            </div>
          ) : (
            sheets.map((sheet) => (
              <SheetNode
                key={sheet.id}
                userId={userId}
                sheet={sheet}
                expanded={expanded.has(sheet.id)}
                onToggle={() => toggleSheet(sheet.id)}
                onNewRun={() => setRunConfigSheet(sheet)}
                selectedRunId={selectedRunId}
                onSelectRun={setSelectedRunId}
                refreshKey={runsRefreshKey}
              />
            ))
          )}
        </div>
      </section>

      {/* ── Sidebar resizer — drag to widen/narrow (see handleSidebarResizeStart). ── */}
      <div
        data-id="search-evals-sidebar-resizer"
        className="group relative flex w-1 shrink-0 cursor-col-resize items-center justify-center"
        onMouseDown={handleSidebarResizeStart}
      >
        <div className="h-full w-px bg-xyne-border-subtle transition-all group-hover:w-0.5 group-hover:bg-xyne-border-strong" />
      </div>

      {/* ── Detail ── */}
      <section className="flex flex-1 flex-col overflow-y-auto min-w-0 px-[32px] py-[24px]">
        {selectedRunId ? (
          <RunResultsView userId={userId} runId={selectedRunId} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-xyne-fg-tertiary">
            <ChatCircleDotsIcon size={28} weight="thin" />
            <p className="text-[13px]">Expand a sheet and pick a run to see its results.</p>
            {sheets.length === 0 && (
              <Button variant="secondary" size="sm" leadingIcon={<UploadSimpleIcon size={14} />} className="mt-2" onClick={() => setShowUpload(true)}>
                Upload a sheet
              </Button>
            )}
          </div>
        )}
      </section>

      <UploadSheetDialog
        userId={userId}
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUploaded={() => { setShowUpload(false); void reload(); }}
      />

      {runConfigSheet && (
        <RunConfigDialog
          userId={userId}
          sheet={runConfigSheet}
          onClose={() => setRunConfigSheet(null)}
          onStarted={(runId) => {
            setRunConfigSheet(null);
            setExpanded((prev) => new Set(prev).add(runConfigSheet.id));
            setSelectedRunId(runId);
            setRunsRefreshKey((k) => k + 1);
            void reload();
          }}
        />
      )}
    </div>
  );
}
