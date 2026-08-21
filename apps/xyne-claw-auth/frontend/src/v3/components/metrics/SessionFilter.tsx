/**
 * Scope every panel to one run.
 *
 * `agent_runs.sessionId` is unique, so this is the narrowest filter available
 * and turns the tool, LLM, quality and coverage tabs into a per-run forensic
 * view: which tools this run called, what they returned, what failed, how
 * latency moved across its turns.
 *
 * Committed on Enter or blur rather than per keystroke — a session id is pasted,
 * and refetching on every character would fire ~36 useless requests.
 */

import { useEffect, useState, type ReactElement } from "react";
import { Crosshair, X } from "lucide-react";
import { cn } from "../../../lib/utils";

export function SessionFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState(value);

  // Keep the box in step when the value changes elsewhere — a shared link, or
  // the clear button on another control.
  useEffect(() => setDraft(value), [value]);

  const commit = (): void => {
    const next = draft.trim();
    if (next !== value) onChange(next);
  };

  return (
    <div
      className={cn(
        "flex h-[32px] items-center gap-1.5 rounded-md border bg-xyne-surface-sunken px-2.5",
        value ? "border-xyne-fg-primary" : "border-xyne-border",
      )}
    >
      <Crosshair size={12} className="shrink-0 text-xyne-fg-muted" aria-hidden />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(value);
        }}
        placeholder="Session id…"
        aria-label="Filter by session id"
        spellCheck={false}
        className="w-[150px] bg-transparent font-mono text-[12px] text-xyne-fg-primary placeholder:font-sans placeholder:text-xyne-fg-placeholder focus:outline-none"
      />
      {(draft || value) && (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            onChange("");
          }}
          aria-label="Clear session filter"
          className="shrink-0 text-xyne-fg-muted hover:text-xyne-fg-primary"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}
