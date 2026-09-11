import { useRef, useState } from "react";
import {
  SpinnerGapIcon,
  CheckCircleIcon,
  WarningIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { importDigitalTwinMemories } from "../../../lib/api";
import type { MemoryBankMemory, TwinArchiveRecord, TwinMemoryArchive } from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";

interface Props {
  open: boolean;
  /** The live memory set, used to flag records that already exist. */
  existing: MemoryBankMemory[];
  onClose: () => void;
  /** Fired after a successful import so the caller can refresh. */
  onImported: () => void;
}

type Phase = "pick" | "preview" | "importing" | "done" | "error";

/** 5 MB of JSON is ~5k memories — past that it is a paste of something else. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Hindsight appends "| Involving: … | When: …" to stored content, so a live
 * memory never string-matches the archived fact it came from. Strip that tail
 * and normalise whitespace/case before comparing, or every record in a
 * freshly-exported archive would read as new.
 */
function dedupeKey(s: string): string {
  return s
    .replace(/\s*\|\s*(Involving|When|Where|Who|Related|Context)\s*:.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseArchive(text: string): { records: TwinArchiveRecord[]; verbatim: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const archive = parsed as Partial<TwinMemoryArchive>;
  if (!archive || typeof archive !== "object" || !Array.isArray(archive.records)) {
    throw new Error("Not a Xyne memory archive — expected a top-level `records` array.");
  }
  if (archive.format && archive.format !== "xyne.digital-twin.memories") {
    throw new Error(`Unexpected archive format "${archive.format}".`);
  }
  const records = archive.records.filter(
    (r): r is TwinArchiveRecord => !!r && typeof r.content === "string" && r.content.trim().length > 0,
  );
  if (records.length === 0) throw new Error("The archive has no memories with content.");
  // A file carrying our format marker holds facts Hindsight already extracted,
  // so it is restored as-is. Anything hand-written may be raw prose, which has
  // to go through fact extraction to become usable memories.
  return { records, verbatim: archive.format === "xyne.digital-twin.memories" };
}

/**
 * Restore memories from an exported archive.
 *
 * Duplicate detection runs HERE rather than server-side: the dashboard already
 * holds the full memory set, so it can diff locally and show the user exactly
 * what will be added before anything is sent. Records that already exist are
 * excluded by default — re-importing is otherwise additive, because Hindsight's
 * retain re-extracts rather than upserting.
 */
export function ImportMemoriesModal({ open, existing, onClose, onImported }: Props) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [filename, setFilename] = useState("");
  const [fresh, setFresh] = useState<TwinArchiveRecord[]>([]);
  const [dupCount, setDupCount] = useState(0);
  const [includeDupes, setIncludeDupes] = useState(false);
  const [dupes, setDupes] = useState<TwinArchiveRecord[]>([]);
  const [result, setResult] = useState<{ submitted: number; failed: number } | null>(null);
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const [verbatim, setVerbatim] = useState(true);
  /** What the file itself suggests — used to mark the recommended option and to
   *  warn when the user overrides it. */
  const [detectedVerbatim, setDetectedVerbatim] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase("pick");
    setFilename("");
    setFresh([]);
    setDupes([]);
    setDupCount(0);
    setIncludeDupes(false);
    setResult(null);
    setProgress({ sent: 0, total: 0 });
    setVerbatim(true);
    setDetectedVerbatim(true);
    setErr(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    if (phase === "importing") return; // a half-sent archive must not be abandoned
    reset();
    onClose();
  };

  async function onFile(file: File) {
    setErr(null);
    if (file.size > MAX_FILE_BYTES) {
      setErr(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 5 MB.`);
      setPhase("error");
      return;
    }
    try {
      const { records, verbatim: isVerbatim } = parseArchive(await file.text());
      setVerbatim(isVerbatim);
      setDetectedVerbatim(isVerbatim);
      const seen = new Set(existing.map((m) => dedupeKey(m.content)));
      const isNew: TwinArchiveRecord[] = [];
      const isDupe: TwinArchiveRecord[] = [];
      for (const r of records) {
        (seen.has(dedupeKey(r.content)) ? isDupe : isNew).push(r);
      }
      setFilename(file.name);
      setFresh(isNew);
      setDupes(isDupe);
      setDupCount(isDupe.length);
      setPhase("preview");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  const toSend = includeDupes ? [...fresh, ...dupes] : fresh;

  async function submit() {
    if (toSend.length === 0) return;
    setErr(null);
    setProgress({ sent: 0, total: toSend.length });
    setPhase("importing");
    try {
      const res = await importDigitalTwinMemories(
        toSend,
        verbatim ? "verbatim" : "extract",
        (sent, total) => setProgress({ sent, total }),
      );
      setResult({ submitted: res.submitted, failed: res.failed });
      setPhase("done");
      onImported();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title="Import memories"
      leftOffset={100}
      footer={
        phase === "preview" ? (
          <>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={toSend.length === 0}>
              Import {toSend.length} memor{toSend.length === 1 ? "y" : "ies"}
            </Button>
          </>
        ) : phase === "done" ? (
          <Button variant="ghost" size="sm" onClick={close}>
            Close
          </Button>
        ) : phase === "error" ? (
          <>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" onClick={reset}>
              Try another file
            </Button>
          </>
        ) : phase === "pick" ? (
          <Button variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
        ) : null
      }
    >
      {phase === "pick" ? (
        <div className="flex flex-col gap-[10px] py-[6px]">
          <p className="text-[12px] text-xyne-fg-secondary">
            Restore memories from a file you exported earlier. Memories already in your Twin are
            detected and skipped.
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-[8px] rounded-lg border border-dashed border-xyne-border bg-xyne-surface-sunken px-[16px] py-[22px] text-center transition hover:border-xyne-fg-muted">
            <UploadSimpleIcon size={22} className="text-xyne-fg-tertiary" />
            <span className="text-[13px] font-medium text-xyne-fg-primary">Choose an archive</span>
            <span className="text-[11px] text-xyne-fg-muted">.json exported from this page · up to 5 MB</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>
          <details className="rounded-lg border border-xyne-border bg-xyne-surface-sunken px-[12px] py-[8px]">
            <summary className="cursor-pointer text-[11px] font-medium text-xyne-fg-secondary">
              Accepted format
            </summary>
            <p className="mt-[8px] text-[11px] text-xyne-fg-tertiary">
              A JSON object with a <code className="text-xyne-fg-secondary">records</code> array.
              Only <code className="text-xyne-fg-secondary">content</code> is required — everything
              else is optional.
            </p>
            <pre className="mt-[8px] overflow-x-auto rounded-md bg-xyne-surface px-[10px] py-[8px] text-[10px] leading-[1.5] text-xyne-fg-secondary">
{`{
  "format": "xyne.digital-twin.memories",
  "records": [
    {
      "content": "Prefers async updates over standups.",
      "subsystem": "preferences",
      "timestamp": "2026-08-01T10:00:00Z"
    }
  ]
}`}
            </pre>
            <ul className="mt-[8px] flex list-disc flex-col gap-[3px] pl-[16px] text-[10px] text-xyne-fg-muted">
              <li>
                <code>subsystem</code>: style, triage, expertise, projects, relationships,
                preferences, decisions, context, docs. Anything else becomes “context”.
              </li>
              <li>
                <code>timestamp</code>: ISO date the fact is from. Future dates are ignored.
              </li>
              <li>
                Tags in the file are always discarded — memories are scoped to your account.
              </li>
              <li>
                The <code>format</code> line only picks the default import mode — you choose the
                mode yourself on the next screen either way.
              </li>
            </ul>
          </details>
        </div>
      ) : phase === "preview" ? (
        <div className="flex flex-col gap-[10px] py-[6px]">
          <p className="truncate text-[12px] text-xyne-fg-secondary">
            <span className="font-medium text-xyne-fg-primary">{filename}</span>
          </p>
          <div className="flex flex-col gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface-sunken px-[12px] py-[10px]">
            <Row label="New memories" value={fresh.length} />
            <Row label="Already in your Twin" value={dupCount} muted />
          </div>
          {dupCount > 0 && (
            <label className="flex items-start gap-[8px] text-[12px] text-xyne-fg-secondary">
              <input
                type="checkbox"
                checked={includeDupes}
                onChange={(e) => setIncludeDupes(e.target.checked)}
                className="mt-[2px]"
              />
              <span>
                Import the {dupCount} duplicate{dupCount === 1 ? "" : "s"} too — this will create
                second copies.
              </span>
            </label>
          )}
          {fresh.length === 0 && !includeDupes && (
            <p className="text-[12px] text-xyne-fg-tertiary">
              Everything in this archive is already in your Twin — nothing to import.
            </p>
          )}
          <div className="flex flex-col gap-[6px]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-xyne-fg-tertiary">
              How should these be imported?
            </p>
            <ModeOption
              selected={verbatim}
              onSelect={() => setVerbatim(true)}
              title="Restore exactly"
              recommended={detectedVerbatim}
              lines={[
                "Saves each record word-for-word. No AI processing, so nothing is rewritten, merged or split.",
                "Fast, and one record always becomes exactly one memory.",
                "Everything is filed as a WORLD fact — original categories aren't restored.",
              ]}
            />
            <ModeOption
              selected={!verbatim}
              onSelect={() => setVerbatim(false)}
              title="Re-process into facts"
              recommended={!detectedVerbatim}
              lines={[
                "Reads each record and extracts facts from it — right for notes or prose that aren't memories yet.",
                "Wording changes, and one record can become several memories or merge into an existing one.",
                "Slower: it's paced to respect rate limits and takes a minute or two to show up.",
              ]}
            />
            {verbatim !== detectedVerbatim && (
              <p className="text-[11px] text-xyne-fg-muted">
                {detectedVerbatim
                  ? "This file looks like a Xyne archive — its records are already facts, so re-processing them will reword what you approved."
                  : "This file has no Xyne format marker, so its records may be raw text. Restoring them exactly will save them verbatim, whatever they contain."}
              </p>
            )}
          </div>
        </div>
      ) : phase === "importing" ? (
        <div className="flex flex-col items-center gap-[10px] py-[14px] text-center">
          <SpinnerGapIcon size={26} className="animate-spin text-xyne-fg-secondary" />
          <p className="text-[13px] font-medium text-xyne-fg-primary">
            Importing {progress.sent}/{progress.total}…
          </p>
          <p className="text-[12px] text-xyne-fg-tertiary">
            Sent in paced batches so your Twin's extraction service isn't rate-limited.
          </p>
          <p className="text-[11px] text-xyne-fg-muted">Keep this open until it finishes.</p>
        </div>
      ) : phase === "done" ? (
        <div className="flex flex-col items-center gap-[8px] py-[14px] text-center">
          <CheckCircleIcon size={26} weight="fill" className="text-xyne-success-fg" />
          <p className="text-[13px] font-medium text-xyne-fg-primary">
            Sent {result?.submitted ?? 0} memor{(result?.submitted ?? 0) === 1 ? "y" : "ies"}
          </p>
          {!!result?.failed && (
            <p className="text-[12px] text-xyne-error-fg">
              {result.failed} could not be imported — try those again later.
            </p>
          )}
          <p className="text-[12px] text-xyne-fg-tertiary">
            Your Twin is extracting them now; they'll show up here shortly.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-[8px] py-[14px] text-center">
          <WarningIcon size={26} weight="fill" className="text-xyne-error-fg" />
          <p className="text-[13px] font-medium text-xyne-fg-primary">Import failed</p>
          <p className="text-[12px] text-xyne-fg-tertiary">{err}</p>
        </div>
      )}
    </Dialog>
  );
}

/** One selectable import mode, with the trade-offs spelled out rather than
 *  hidden behind a label — the two modes differ in fidelity, speed and how many
 *  memories you end up with, and none of that is guessable from the name. */
function ModeOption({
  selected,
  onSelect,
  title,
  lines,
  recommended,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  lines: string[];
  recommended?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-[8px] rounded-lg border px-[12px] py-[10px] transition ${
        selected
          ? "border-xyne-brand bg-xyne-surface-sunken"
          : "border-xyne-border hover:border-xyne-fg-muted"
      }`}
    >
      <input
        type="radio"
        name="import-mode"
        checked={selected}
        onChange={onSelect}
        className="mt-[3px]"
      />
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="flex items-center gap-[6px]">
          <span className="text-[12px] font-medium text-xyne-fg-primary">{title}</span>
          {recommended && (
            <span className="rounded border border-xyne-border px-[5px] py-[1px] text-[9px] font-medium uppercase tracking-wide text-xyne-fg-tertiary">
              Suggested
            </span>
          )}
        </span>
        {lines.map((l) => (
          <span key={l} className="text-[11px] leading-[1.45] text-xyne-fg-tertiary">
            {l}
          </span>
        ))}
      </span>
    </label>
  );
}

function Row({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className={muted ? "text-xyne-fg-tertiary" : "text-xyne-fg-secondary"}>{label}</span>
      <span
        className={`font-medium tabular-nums ${muted ? "text-xyne-fg-tertiary" : "text-xyne-fg-primary"}`}
      >
        {value}
      </span>
    </div>
  );
}
