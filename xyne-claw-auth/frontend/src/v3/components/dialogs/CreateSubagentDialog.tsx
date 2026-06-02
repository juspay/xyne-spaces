import { useState, useEffect, useCallback, useRef } from "react";
import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  WarningCircleIcon,
  SparkleIcon,
  CircleDashedIcon,
} from "@phosphor-icons/react";
import { createSubagent, listSkills } from "../../../lib/api";
import type { Skill } from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import { Button } from "../ui/Button";
import { InfoIcon } from "../ui/Tooltip";

/* UTF-8 byte length — same as V1's `utf8ByteLength`. Used to surface
   the system-prompt size so authors can keep an eye on the token
   budget for the subagent's child loop. */
function utf8ByteLength(s: string): number {
  // eslint-disable-next-line no-undef
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length;
}

/* Field-hint copy ported from V1 (SubagentDetailPage). Single source so
   the wizard's info icons stay in lock-step with V1's tooltips. */
const HINTS = {
  name: (
    <>
      The tool name parent agents see (e.g.{" "}
      <code className="rounded bg-xyne-surface-sunken px-1 font-mono">
        deploy-checker
      </code>
      ). Lowercase letters, digits, and hyphens only. Immutable after create.
    </>
  ),
  description: (
    <>
      Read by the <strong>parent agent's LLM</strong>. Tells it what this
      subagent does and when to call it.
    </>
  ),
  progressLabels: (
    <>
      Shown in the chat spinner while this subagent runs. One picked at
      random per invocation. Use emoji + a short verb.
    </>
  ),
  paramName: (
    <>
      The argument key the subagent accepts (default{" "}
      <code className="rounded bg-xyne-surface-sunken px-1 font-mono">
        question
      </code>
      ).
    </>
  ),
  paramDescription: (
    <>
      The <strong>parent agent's LLM</strong> reads this to decide what
      value to pass. Most important field for tool-use quality.
    </>
  ),
  systemPrompt: (
    <>
      Read by the <strong>subagent's own LLM</strong> at session start.
      Keep small — every byte costs tokens in the child loop. Use Skills
      for big chunks of context.
    </>
  ),
  directTools: (
    <>
      Built-in tool names this subagent can call directly (one per line
      or comma-separated). Examples:{" "}
      <code className="rounded bg-xyne-surface-sunken px-1 font-mono">
        read_file
      </code>
      ,{" "}
      <code className="rounded bg-xyne-surface-sunken px-1 font-mono">
        write_file
      </code>
      .
    </>
  ),
  customTools: (
    <>
      Slugs of custom tools (those registered under{" "}
      <code className="rounded bg-xyne-surface-sunken px-1 font-mono">
        custom:source:name
      </code>
      ). One per line or comma-separated.
    </>
  ),
  skills: (
    <>
      Skills inject reusable instruction snippets into this subagent's
      context. Big chunks of knowledge live here, not in the system
      prompt — cheaper at runtime.
    </>
  ),
};

interface CreateSubagentDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  userId: string;
  existingNames: string[];
}

const STEPS = ["Identity", "Instructions", "Tools & Skills", "Review"];

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface WizardState {
  step: number;
  name: string;
  description: string;
  paramName: string;
  paramDescription: string;
  systemPrompt: string;
  progressLabels: string[];
  directToolsInput: string;
  customToolsInput: string;
  selectedSkillIds: string[];
  availableSkills: Skill[];
  skillsLoading: boolean;
  nameError: string | null;
  nameValid: boolean;
  creating: boolean;
  error: string | null;
}

const INIT: WizardState = {
  step: 0,
  name: "",
  description: "",
  paramName: "question",
  paramDescription: "",
  systemPrompt: "",
  progressLabels: ["🔧 Working on it..."],
  directToolsInput: "",
  customToolsInput: "",
  selectedSkillIds: [],
  availableSkills: [],
  skillsLoading: false,
  nameError: null,
  nameValid: false,
  creating: false,
  error: null,
};

export function CreateSubagentDialog({
  open,
  onClose,
  onCreated,
  userId,
  existingNames,
}: CreateSubagentDialogProps) {
  const [w, setW] = useState<WizardState>(INIT);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const u = useCallback(
    (patch: Partial<WizardState>) => setW((prev) => ({ ...prev, ...patch })),
    []
  );

  useEffect(() => {
    if (open) {
      setW(INIT);
    }
  }, [open]);

  useEffect(() => {
    if (w.step === 2 && w.availableSkills.length === 0) {
      u({ skillsLoading: true });
      listSkills(userId)
        .then((d) => u({ availableSkills: d }))
        .catch(() => {})
        .finally(() => u({ skillsLoading: false }));
    }
  }, [w.step, w.availableSkills.length, u, userId]);

  useEffect(() => {
    u({ nameError: null, nameValid: false });
    const trimmed = w.name.trim();
    if (!trimmed) return;

    if (!KEBAB_RE.test(trimmed)) {
      u({ nameError: "Use lowercase letters, numbers, and hyphens only" });
      return;
    }

    if (existingNames.includes(trimmed)) {
      u({ nameError: `"${trimmed}" is already taken — choose a different name` });
      return;
    }

    u({ nameValid: true });
  }, [w.name, existingNames, u]);

  const updateLabel = (idx: number, value: string) => {
    const next = [...w.progressLabels];
    next[idx] = value;
    u({ progressLabels: next });
  };

  const addLabel = () => {
    if (w.progressLabels.length >= 8) return;
    u({ progressLabels: [...w.progressLabels, ""] });
  };

  const removeLabel = (idx: number) => {
    if (w.progressLabels.length <= 1) return;
    u({
      progressLabels: w.progressLabels.filter((_, i) => i !== idx),
    });
  };

  const toggleSkill = (id: string) => {
    setW((p) => ({
      ...p,
      selectedSkillIds: p.selectedSkillIds.includes(id)
        ? p.selectedSkillIds.filter((x) => x !== id)
        : [...p.selectedSkillIds, id],
    }));
  };

  const handleCreate = async () => {
    u({ creating: true, error: null });
    try {
      const direct = w.directToolsInput
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const custom = w.customToolsInput
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      await createSubagent({
        name: w.name.trim(),
        description: w.description.trim(),
        systemPrompt: w.systemPrompt.trim(),
        paramName: w.paramName.trim() || "question",
        paramDescription: w.paramDescription.trim(),
        progressLabels: w.progressLabels
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        tools: {
          ...(direct.length > 0 ? { direct } : {}),
          ...(custom.length > 0 ? { custom } : {}),
        },
        skillIds:
          w.selectedSkillIds.length > 0 ? w.selectedSkillIds : undefined,
      });
      onCreated();
    } catch (err) {
      // Surface a more actionable message for the 401/403 auth cases —
      // those come from `requireAuth` middleware when the Spaces cookie
      // can't be validated. Telling the user to "Authentication
      // required" without a next step is a dead end.
      const raw = err instanceof Error ? err.message : "Failed to create subagent";
      const isAuth =
        /authentication required/i.test(raw)
        || /request failed:\s*401/i.test(raw)
        || /request failed:\s*403/i.test(raw);
      u({
        error: isAuth
          ? "Your session has expired or your cookie isn't being recognised. Refresh the page and sign in again, then retry."
          : raw,
      });
    } finally {
      u({ creating: false });
    }
  };

  const canNext =
    w.step === 0
      ? w.name.trim().length > 0 && w.nameValid && !w.nameError
      : w.step === 1
        ? w.systemPrompt.trim().length > 0
        : true;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Create Subagent"
      description={`Step ${w.step + 1} of ${STEPS.length}: ${STEPS[w.step]}`}
      maxWidth={672}
      footer={
        <div className="flex w-full items-center justify-between">
          <button
            onClick={() =>
              w.step > 0 ? u({ step: w.step - 1 }) : onClose()
            }
            className="flex items-center gap-1 text-[14px] text-xyne-fg-muted transition hover:text-xyne-fg-primary"
          >
            <CaretLeftIcon size={16} />
            {w.step > 0 ? "Back" : "Cancel"}
          </button>
          {w.step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              onClick={() => u({ step: w.step + 1 })}
              disabled={!canNext}
            >
              Next <CaretRightIcon size={16} />
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={w.creating || !canNext}
            >
              {w.creating ? (
                <CircleDashedIcon
                  size={14}
                  className="animate-spin"
                />
              ) : null}
              Create Subagent
            </Button>
          )}
        </div>
      }
    >
      {/* Step indicator */}
      <div className="flex gap-1">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition ${i <= w.step ? "bg-xyne-brand" : "bg-xyne-surface-subtle"}`}
          />
        ))}
      </div>

      <div className="min-h-[320px] max-h-[60vh] overflow-y-auto">
        {/* Step 1: Identity */}
        {w.step === 0 && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-[12px] font-medium text-xyne-fg-secondary">
                Name <span className="text-xyne-fg-muted">(kebab-case)</span>
                <InfoIcon text={HINTS.name} />
              </label>
              <div className="relative">
                <input
                  value={w.name}
                  onChange={(e) =>
                    u({
                      name: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]+/g, "-")
                        .replace(/--+/g, "-")
                        .replace(/^-|-$/g, ""),
                    })
                  }
                  placeholder="deploy-checker"
                  autoFocus
                  className={[
                    "w-full rounded-[var(--comp-input-radius)] border bg-xyne-surface px-3 py-2 pr-8 text-[14px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:outline-none focus:shadow-[var(--comp-focus-ring)] transition-[border-color,box-shadow]",
                    w.nameError
                      ? "border-xyne-border-error"
                      : w.nameValid
                        ? "border-green-500"
                        : "border-xyne-border focus:border-xyne-border-focus",
                  ].join(" ")}
                />
                {w.name.trim() && (
                  <span className="absolute right-2.5 top-2.5">
                    {w.nameError ? (
                      <WarningCircleIcon
                        size={14}
                        className="text-xyne-error-fg"
                      />
                    ) : w.nameValid ? (
                      <CheckIcon size={14} className="text-green-600" />
                    ) : null}
                  </span>
                )}
              </div>
              {w.nameError && (
                <p className="mt-1 text-[11px] text-xyne-error-fg">
                  {w.nameError}
                </p>
              )}
            </div>

            <TextField
              label="Description"
              info={HINTS.description}
              placeholder="What this subagent does, when the parent should call it."
              value={w.description}
              onChange={(e) => u({ description: e.target.value })}
            />

            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Param name"
                info={HINTS.paramName}
                hint="The argument key the subagent accepts"
                value={w.paramName}
                onChange={(e) => u({ paramName: e.target.value })}
                placeholder="question"
              />
              <TextField
                label="Param description"
                info={HINTS.paramDescription}
                hint="How the parent agent decides what to pass"
                placeholder="What the parent agent should pass in"
                value={w.paramDescription}
                onChange={(e) => u({ paramDescription: e.target.value })}
              />
            </div>
          </div>
        )}

        {/* Step 2: Instructions */}
        {w.step === 1 && (
          <div className="space-y-4">
            <TextField
              label={`System prompt (${utf8ByteLength(w.systemPrompt)} bytes)`}
              info={HINTS.systemPrompt}
              multiline
              rows={8}
              placeholder="You are a..."
              value={w.systemPrompt}
              onChange={(e) => u({ systemPrompt: e.target.value })}
            />

            <div>
              <label className="mb-1.5 flex items-center gap-1 text-[12px] font-medium text-xyne-fg-secondary">
                Progress labels ({w.progressLabels.length}/8)
                <InfoIcon text={HINTS.progressLabels} />
              </label>
              <p className="mb-2 text-[11px] text-xyne-fg-muted">
                Shown in the chat spinner while this subagent runs.
              </p>
              <div className="space-y-1.5">
                {w.progressLabels.map((label, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input
                      value={label}
                      onChange={(e) => updateLabel(idx, e.target.value)}
                      placeholder="🔧 Working..."
                      className="flex-1 rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-3 py-1.5 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeLabel(idx)}
                      disabled={w.progressLabels.length === 1}
                      className="rounded border border-xyne-border px-2 text-xs text-xyne-fg-muted hover:bg-xyne-surface-subtle disabled:opacity-40"
                    >
                      −
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addLabel}
                disabled={w.progressLabels.length >= 8}
                className="mt-1.5 rounded border border-xyne-border px-2 py-1 text-xs text-xyne-fg-secondary hover:bg-xyne-surface-subtle disabled:opacity-40"
              >
                + Add label
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Tools & Skills */}
        {w.step === 2 && (
          <div className="space-y-5">
            {/* Skills */}
            <div>
              <h3 className="mb-2 flex items-center gap-1 text-[13px] font-medium text-xyne-fg-secondary">
                Skills
                <InfoIcon text={HINTS.skills} />
              </h3>
              {w.skillsLoading ? (
                <p className="text-[14px] text-xyne-fg-muted">
                  Loading skills…
                </p>
              ) : w.availableSkills.length === 0 ? (
                <p className="text-[14px] text-xyne-fg-muted">
                  No skills available.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {w.availableSkills.map((skill) => (
                      <button
                        key={skill.id}
                        onClick={() => toggleSkill(skill.id)}
                        className={`rounded-full border px-3 py-1.5 text-[13px] transition ${w.selectedSkillIds.includes(skill.id) ? "border-xyne-brand bg-xyne-surface-subtle text-xyne-fg-primary" : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"}`}
                        title={skill.description || skill.slug}
                      >
                        {skill.label || skill.name}
                      </button>
                    ))}
                  </div>
                  {w.selectedSkillIds.length > 0 && (
                    <p className="mt-2 text-[12px] text-xyne-fg-muted">
                      {w.selectedSkillIds.length} skill(s) selected
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Tools */}
            <div className="space-y-3">
              <h3 className="text-[13px] font-medium text-xyne-fg-secondary">
                Tools
              </h3>
              <TextField
                label="Direct tools"
                info={HINTS.directTools}
                hint="One per line or comma-separated"
                multiline
                rows={3}
                placeholder="tool-name-1&#10;tool-name-2"
                value={w.directToolsInput}
                onChange={(e) => u({ directToolsInput: e.target.value })}
              />
              <TextField
                label="Custom tools"
                info={HINTS.customTools}
                hint="One per line or comma-separated"
                multiline
                rows={3}
                placeholder="custom-tool-1&#10;custom-tool-2"
                value={w.customToolsInput}
                onChange={(e) => u({ customToolsInput: e.target.value })}
              />
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {w.step === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-xyne-fg-primary">
                {w.name || "Untitled"}
              </h3>
              <p className="text-[12px] text-xyne-fg-muted">custom</p>
            </div>

            {w.description && (
              <p className="text-[14px] text-xyne-fg-muted">
                {w.description}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <span className="text-xyne-fg-muted">Param name:</span>{" "}
                <span className="font-mono text-xyne-fg-primary">
                  {w.paramName || "question"}
                </span>
              </div>
              <div>
                <span className="text-xyne-fg-muted">Progress labels:</span>{" "}
                <span className="text-xyne-fg-primary">
                  {w.progressLabels.length}
                </span>
              </div>
            </div>

            <div>
              <h4 className="mb-1 text-[12px] font-medium text-xyne-fg-muted">
                System Prompt
              </h4>
              <pre className="max-h-32 overflow-auto rounded-xl bg-xyne-surface-sunken p-3 text-[12px] text-xyne-fg-secondary">
                {w.systemPrompt.slice(0, 500)}
                {w.systemPrompt.length > 500 ? "…" : ""}
              </pre>
            </div>

            {w.directToolsInput.trim() && (
              <div>
                <h4 className="mb-1 text-[12px] font-medium text-xyne-fg-muted">
                  Direct Tools
                </h4>
                <div className="flex flex-wrap gap-1">
                  {w.directToolsInput
                    .split(/[\n,]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-xyne-surface-subtle px-2 py-0.5 text-[12px] text-xyne-fg-primary border border-xyne-border"
                      >
                        {t}
                      </span>
                    ))}
                </div>
              </div>
            )}

            {w.customToolsInput.trim() && (
              <div>
                <h4 className="mb-1 text-[12px] font-medium text-xyne-fg-muted">
                  Custom Tools
                </h4>
                <div className="flex flex-wrap gap-1">
                  {w.customToolsInput
                    .split(/[\n,]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-xyne-surface-subtle px-2 py-0.5 text-[12px] text-xyne-fg-primary border border-xyne-border"
                      >
                        {t}
                      </span>
                    ))}
                </div>
              </div>
            )}

            {w.selectedSkillIds.length > 0 && (
              <div>
                <h4 className="mb-1 text-[12px] font-medium text-xyne-fg-muted">
                  Skills
                </h4>
                <div className="flex flex-wrap gap-1">
                  {w.selectedSkillIds.map((id) => {
                    const s = w.availableSkills.find((x) => x.id === id);
                    return (
                      <span
                        key={id}
                        className="rounded-full bg-xyne-surface-subtle px-2 py-0.5 text-[12px] text-xyne-fg-secondary border border-xyne-border"
                      >
                        {s?.label || s?.name || id}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {w.error && (
              <p className="rounded-xl bg-xyne-surface-subtle border border-xyne-border-error p-2 text-[13px] text-xyne-error-fg">
                {w.error}
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
