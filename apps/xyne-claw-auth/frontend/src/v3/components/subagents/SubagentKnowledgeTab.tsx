/**
 * SubagentKnowledgeTab — what the subagent works with.
 *
 * Two sub-sections, both grouped here per the page-level IA decision:
 *
 *   1. Parameter contract     param name + parameter description +
 *                              progress labels. Defines how the parent
 *                              passes a job in and what status lines the
 *                              chat surface shows while it's running.
 *   2. Skills                 markdown playbooks the subagent consults
 *                              while working — runbooks, guidelines.
 *
 * Both are "inputs the subagent has access to / draws from" — the parameter
 * is what the parent gives it, skills are what it reads on the side. They're
 * grouped together here to keep contract-shaping and reference material on
 * the same surface, since both are typically tuned together when a user is
 * adapting a subagent to a new use case.
 */

import { useMemo, useState } from "react";
import {
  PlusIcon,
  MinusIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import type { SubagentDef, Skill } from "../../../lib/api";
import { InfoIcon } from "../ui/Tooltip";

const HINTS = {
  paramName:
    "Single argument the parent passes to this subagent (camelCase, no spaces).",
  paramDescription:
    "What the parent should put into the parameter — e.g. 'The user question, verbatim'.",
  progressLabels:
    "Status lines shown in chat while the subagent is working. Cycled in order.",
  skills:
    "Markdown playbooks attached to the subagent — runbooks, guidelines, references.",
};

interface SubagentKnowledgeTabProps {
  subagent: SubagentDef;
  isBuiltIn: boolean;
  canEdit: boolean;

  draftParamName: string;
  onDraftParamNameChange: (v: string) => void;

  draftParamDescription: string;
  onDraftParamDescriptionChange: (v: string) => void;

  draftProgressLabels: string[];
  onDraftProgressLabelsChange: (labels: string[]) => void;

  draftSkillIds: string[];
  onToggleSkill: (id: string) => void;

  availableSkills: Skill[];
  skillsLoading: boolean;
}

function SectionTitle({
  title,
  technical,
  hint,
  trailing,
}: {
  title: string;
  technical?: string;
  hint?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
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
      {trailing}
    </div>
  );
}

export function SubagentKnowledgeTab({
  isBuiltIn,
  canEdit,
  draftParamName,
  onDraftParamNameChange,
  draftParamDescription,
  onDraftParamDescriptionChange,
  draftProgressLabels,
  onDraftProgressLabelsChange,
  draftSkillIds,
  onToggleSkill,
  availableSkills,
  skillsLoading,
}: SubagentKnowledgeTabProps) {
  const disabled = isBuiltIn || !canEdit;
  const [skillSearch, setSkillSearch] = useState("");

  const updateLabel = (idx: number, value: string) => {
    const next = [...draftProgressLabels];
    next[idx] = value;
    onDraftProgressLabelsChange(next);
  };
  const addLabel = () => {
    if (draftProgressLabels.length >= 8) return;
    onDraftProgressLabelsChange([...draftProgressLabels, ""]);
  };
  const removeLabel = (idx: number) => {
    if (draftProgressLabels.length <= 1) return;
    onDraftProgressLabelsChange(
      draftProgressLabels.filter((_, i) => i !== idx),
    );
  };

  const filteredSkills = useMemo(() => {
    const q = skillSearch.trim().toLowerCase();
    if (!q) return availableSkills;
    return availableSkills.filter(
      (s) =>
        (s.label || s.name).toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [availableSkills, skillSearch]);

  return (
    <div className="flex flex-col gap-7">
      {/* ── Parameter contract ─────────────────────────────────────── */}
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <SectionTitle title="Parameter" technical="what the parent passes" />
          <p className="text-[12px] text-xyne-fg-tertiary">
            The contract between this subagent and the agents that delegate
            to it.
          </p>
        </div>

        {/* Param name + description sit on one row. Name is short
            (camelCase identifier), description is the prose explanation. */}
        <div className="grid grid-cols-12 gap-3 items-stretch">
          <label
            className={`col-span-4 min-w-0 flex flex-col rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 pt-1.5 pb-2 transition-colors ${
              canEdit
                ? "hover:border-xyne-border-strong focus-within:border-xyne-border-focus"
                : ""
            }`}
          >
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary">
              Param name
              <InfoIcon text={HINTS.paramName} />
            </span>
            <input
              type="text"
              value={draftParamName}
              onChange={(e) => onDraftParamNameChange(e.target.value)}
              readOnly={disabled}
              aria-label="Parameter name"
              placeholder="question"
              className={`w-full bg-transparent border-0 outline-none px-0 py-0 text-[14px] font-medium text-xyne-fg-primary placeholder:text-xyne-fg-muted ${
                disabled ? "cursor-default" : ""
              }`}
            />
          </label>

          <label
            className={`col-span-8 min-w-0 flex flex-col rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 pt-1.5 pb-2 transition-colors ${
              canEdit
                ? "hover:border-xyne-border-strong focus-within:border-xyne-border-focus"
                : ""
            }`}
          >
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary">
              Param description
              <InfoIcon text={HINTS.paramDescription} />
            </span>
            <input
              type="text"
              value={draftParamDescription}
              onChange={(e) => onDraftParamDescriptionChange(e.target.value)}
              readOnly={disabled}
              placeholder={`What to pass into ${draftParamName || "question"} (e.g. the user message, verbatim)`}
              className={`w-full bg-transparent border-0 outline-none px-0 py-0 text-[14px] font-medium text-xyne-fg-primary placeholder:text-xyne-fg-muted ${
                disabled ? "cursor-default" : ""
              }`}
            />
          </label>
        </div>

        {/* Progress labels */}
        <div className="flex flex-col gap-2.5">
          <SectionTitle
            title="Progress labels"
            technical={`${draftProgressLabels.length}/8`}
            hint={HINTS.progressLabels}
            trailing={
              !disabled && (
                <button
                  type="button"
                  onClick={addLabel}
                  disabled={draftProgressLabels.length >= 8}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-xyne-border text-xyne-fg-secondary transition hover:bg-xyne-surface-subtle disabled:opacity-40"
                  title="Add label"
                >
                  <PlusIcon size={14} />
                </button>
              )
            }
          />
          <p className="-mt-1 text-[12px] text-xyne-fg-tertiary">
            Status lines shown in chat while running. Cycled in order.
          </p>
          <div className="flex flex-col gap-1.5">
            {draftProgressLabels.map((label, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  value={label}
                  onChange={(e) => updateLabel(idx, e.target.value)}
                  placeholder="🔧 Working on it…"
                  readOnly={disabled}
                  className="flex-1 rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 py-1.5 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none"
                />
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeLabel(idx)}
                    disabled={draftProgressLabels.length === 1}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-xyne-border text-xyne-fg-muted transition hover:bg-xyne-surface-subtle disabled:opacity-40"
                    title="Remove label"
                  >
                    <MinusIcon size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Skills ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 border-t border-xyne-border-subtle pt-6">
        <div className="flex flex-col gap-1.5">
          <SectionTitle
            title="Skills"
            technical="reference material"
            hint={HINTS.skills}
          />
          <p className="text-[12px] text-xyne-fg-tertiary">
            Markdown playbooks the subagent consults while working.
          </p>
        </div>

        {availableSkills.length > 0 && (
          <div className="relative">
            <MagnifyingGlassIcon
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
            />
            <input
              type="text"
              value={skillSearch}
              onChange={(e) => setSkillSearch(e.target.value)}
              placeholder="Search skills…"
              className="w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken py-2 pl-9 pr-3 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none"
            />
          </div>
        )}

        {skillsLoading ? (
          <p className="text-[13px] text-xyne-fg-muted">Loading skills…</p>
        ) : availableSkills.length === 0 ? (
          <p className="text-[13px] text-xyne-fg-muted">
            No skills available.
          </p>
        ) : filteredSkills.length === 0 ? (
          <p className="text-[13px] text-xyne-fg-muted">
            No skills match &ldquo;{skillSearch}&rdquo;.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {filteredSkills.map((skill) => {
              const selected = draftSkillIds.includes(skill.id);
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => !disabled && onToggleSkill(skill.id)}
                  disabled={disabled}
                  className={`rounded-full border px-3 py-1.5 text-[13px] transition ${
                    selected
                      ? "border-xyne-brand bg-xyne-brand text-xyne-fg-inverse"
                      : "border-xyne-border bg-xyne-surface-sunken text-xyne-fg-secondary hover:border-xyne-border-strong"
                  } disabled:opacity-50`}
                  title={skill.description || skill.slug}
                >
                  {skill.label || skill.name}
                </button>
              );
            })}
          </div>
        )}

        {draftSkillIds.length > 0 && (
          <p className="text-[12px] text-xyne-fg-muted">
            {draftSkillIds.length} skill
            {draftSkillIds.length === 1 ? "" : "s"} attached
          </p>
        )}
      </div>
    </div>
  );
}
