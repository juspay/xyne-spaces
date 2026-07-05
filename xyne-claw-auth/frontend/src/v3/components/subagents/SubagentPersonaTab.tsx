/**
 * SubagentPersonaTab — "who is this subagent".
 *
 * Layout (top → bottom):
 *   1. Read-only banners      (built-in / view-only)
 *   2. Name                   monospace, locked, tooltip
 *   3. Description            editable summary
 *   4. Persona section        system prompt textarea
 *
 * Contract-related fields (Param name, Parameter description, Progress
 * labels) live on the Knowledge tab — see SubagentKnowledgeTab.
 */

import { LockIcon } from "@phosphor-icons/react";
import type { SubagentDef } from "../../../lib/api";
import { InfoIcon } from "../ui/Tooltip";

const HINTS = {
  description:
    "One-sentence summary the parent agent sees when picking who to delegate to.",
  systemPrompt:
    "The persona and instructions the model receives before it runs.",
};

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

interface SubagentPersonaTabProps {
  subagent: SubagentDef;
  isBuiltIn: boolean;
  canEdit: boolean;

  draftDescription: string;
  onDraftDescriptionChange: (v: string) => void;

  draftSystemPrompt: string;
  onDraftSystemPromptChange: (v: string) => void;
}

function SectionTitle({
  title,
  technical,
  hint,
}: {
  title: string;
  technical?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="inline-flex items-baseline gap-2 min-w-0">
        <span className="text-[14px] font-semibold text-xyne-fg-primary">
          {title}
        </span>
        {technical && (
          <>
            <span className="text-xyne-fg-tertiary">•</span>
            <span className="text-[13px] font-normal text-xyne-fg-tertiary">
              {technical}
            </span>
          </>
        )}
      </span>
      {hint && <InfoIcon text={hint} />}
    </div>
  );
}

export function SubagentPersonaTab({
  subagent,
  isBuiltIn,
  canEdit,
  draftDescription,
  onDraftDescriptionChange,
  draftSystemPrompt,
  onDraftSystemPromptChange,
}: SubagentPersonaTabProps) {
  const disabled = isBuiltIn || !canEdit;

  return (
    <div className="flex flex-col gap-7">
      {/* ── Read-only banners ─────────────────────────────────────────── */}
      {isBuiltIn && (
        <div className="flex items-center gap-2 rounded-lg border border-xyne-warning-border bg-xyne-warning-bg px-3 py-1.5 text-[11px] text-xyne-warning-fg">
          <LockIcon size={12} className="shrink-0" />
          Built-in subagent — read-only
        </div>
      )}
      {!isBuiltIn && !canEdit && (
        <div className="rounded-lg border border-xyne-info-border bg-xyne-info-bg px-3 py-1.5 text-[11px] text-xyne-info-fg">
          View-only access
        </div>
      )}

      {/* ── Name ──────────────────────────────────────────────────────
          Immutable identifier — agents reference this subagent by name
          in their config.tools.subagents array. Shown in monospace to
          signal "this is a slug / ID, not a label". */}
      <div className="flex flex-col gap-1 rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 pt-1.5 pb-2">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary">
          Name
          <InfoIcon text="Permanent — agents reference this subagent by name" />
        </span>
        <span className="w-full text-[14px] font-medium font-mono text-xyne-fg-primary">
          {subagent.name}
        </span>
      </div>

      {/* ── Description ─────────────────────────────────────────────────
          One-sentence summary the parent agent sees when picking who to
          delegate to. */}
      <label
        className={`flex flex-col gap-1 rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 pt-1.5 pb-2 transition-colors ${
          canEdit
            ? "hover:border-xyne-border-strong focus-within:border-xyne-border-focus"
            : ""
        }`}
      >
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary">
          Description
          <InfoIcon text={HINTS.description} />
        </span>
        <input
          type="text"
          value={draftDescription}
          onChange={(e) => onDraftDescriptionChange(e.target.value)}
          readOnly={disabled}
          aria-label="Subagent description"
          placeholder="What does this subagent do?"
          className={`w-full bg-transparent border-0 outline-none px-0 py-0 text-[14px] font-medium text-xyne-fg-primary placeholder:text-xyne-fg-muted ${
            disabled ? "cursor-default" : ""
          }`}
        />
      </label>

      {/* ── Persona ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5">
        <SectionTitle
          title="Persona"
          technical="system prompt"
          hint={HINTS.systemPrompt}
        />
        <p className="-mt-1 text-[12px] text-xyne-fg-tertiary">
          The voice and instructions the model receives every run.
        </p>
        <textarea
          value={draftSystemPrompt}
          onChange={(e) => onDraftSystemPromptChange(e.target.value)}
          placeholder="You are a helpful subagent that…"
          readOnly={disabled}
          className="min-h-[260px] w-full resize-y rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 py-2 font-mono text-[12px] leading-relaxed text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none"
        />
        <span className="shrink-0 text-[11px] text-xyne-fg-tertiary">
          {utf8ByteLength(draftSystemPrompt).toLocaleString()} byte
          {utf8ByteLength(draftSystemPrompt) === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
