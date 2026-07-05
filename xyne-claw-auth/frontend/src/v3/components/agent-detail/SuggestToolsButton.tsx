import { useState } from "react";
import { MagicWandIcon, CheckIcon, XIcon } from "@phosphor-icons/react";
import { suggestTools, type ToolSuggestion, type AvailableTools } from "../../../lib/api";
import type { AgentToolSelection } from "../ToolPickerDialog";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { useSnackbar } from "../ui/Snackbar";

/* ── props ─────────────────────────────────────────────────────────── */

interface Props {
  systemPrompt: string;
  agentDescription: string;
  /** Current tool selection; used to compute the diff against the suggestion. */
  currentSelection: AgentToolSelection;
  /** Catalog needed to map suggestion keys back to UI tool slugs/names. */
  availableTools: AvailableTools | null;
  /** Fired with the new selection iff the user accepts the suggestion. */
  onApply: (next: AgentToolSelection) => void;
  disabled?: boolean;
}

/* ── helpers ───────────────────────────────────────────────────────── */

// Translate a suggestion into the AgentToolSelection shape the rest of the
// app uses. We merge with the current selection (additive only — the LLM's
// job is to *propose*, not silently strip the user's manual picks).
function suggestionToSelection(
  s: ToolSuggestion,
  current: AgentToolSelection,
  catalog: AvailableTools,
): AgentToolSelection {
  const subagentSet = new Set(current.subagents);
  for (const name of s.subagents ?? []) subagentSet.add(name);

  const directSet = new Set(current.direct);
  const customSet = new Set(current.custom);

  // For each suggested integration, route its tool names into either
  // `direct` (mcp/builtin — keyed by name) or `custom` (keyed by slug).
  for (const sugg of s.integrations ?? []) {
    const intg = catalog.integrations.find((i) => i.slug === sugg.slug);
    if (!intg) continue;
    const allTools = [...intg.readTools, ...intg.writeTools];
    const allNames = new Set([...(sugg.readTools ?? []), ...(sugg.writeTools ?? [])]);
    for (const tool of allTools) {
      if (!allNames.has(tool.name)) continue;
      if (intg.kind === "custom") customSet.add(tool.slug);
      else directSet.add(tool.name);
    }
  }

  return {
    subagents: Array.from(subagentSet),
    direct: Array.from(directSet),
    custom: Array.from(customSet),
    gateway: [],
  };
}

// Compute the "what would change" view shown in the diff dialog.
function diffSelection(current: AgentToolSelection, proposed: AgentToolSelection) {
  const addedSubagents = proposed.subagents.filter((s) => !current.subagents.includes(s));
  const addedDirect = proposed.direct.filter((s) => !current.direct.includes(s));
  const addedCustom = proposed.custom.filter((s) => !current.custom.includes(s));
  return { addedSubagents, addedDirect, addedCustom };
}

/* ── component ─────────────────────────────────────────────────────── */

export function SuggestToolsButton({
  systemPrompt,
  agentDescription,
  currentSelection,
  availableTools,
  onApply,
  disabled,
}: Props) {
  const { show: showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<ToolSuggestion | null>(null);

  // The intent fed to the LLM. Prefer the full system prompt; fall back to
  // the short description so users mid-creation (before they've written a
  // prompt) still get usable suggestions.
  const intent = systemPrompt.trim() || agentDescription.trim();
  const canRun = intent.length > 0 && !disabled && availableTools !== null;

  const handleClick = async () => {
    if (!canRun || !availableTools) return;
    setLoading(true);
    try {
      const data = await suggestTools({
        systemPrompt: systemPrompt.trim() || undefined,
        description: !systemPrompt.trim() ? agentDescription.trim() : undefined,
      });
      setSuggestion(data);
      setOpen(true);
    } catch (err) {
      console.error("[suggest-tools] failed:", err);
      showSnackbar({ variant: "error", title: "Couldn't suggest tools — try again" });
    } finally {
      setLoading(false);
    }
  };

  const proposed = suggestion && availableTools
    ? suggestionToSelection(suggestion, currentSelection, availableTools)
    : null;
  const diff = proposed ? diffSelection(currentSelection, proposed) : null;
  const totalAdded = diff ? diff.addedSubagents.length + diff.addedDirect.length + diff.addedCustom.length : 0;

  const reasoningFor = (key: string) => suggestion?.reasoning?.[key] ?? "";

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={!canRun || loading}
        title={
          !intent
            ? "Add a description or system prompt first"
            : "Let AI suggest tools based on the agent's purpose"
        }
        className="inline-flex items-center gap-1 rounded-md border border-[#c4b5fd] bg-[#faf5ff] px-2 py-1 text-[12px] font-medium text-[#7c3aed] transition-colors hover:bg-[#f3e8ff] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#6d28d9]/40 dark:bg-[#2e1065]/20 dark:text-[#a78bfa]"
      >
        <MagicWandIcon size={12} weight="fill" />
        {loading ? "Thinking…" : "Suggest"}
      </button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Suggested tools"
        description={
          totalAdded === 0
            ? "AI didn't suggest anything new — your current selection already covers the agent's purpose."
            : `AI proposes ${totalAdded} addition${totalAdded === 1 ? "" : "s"} to your tool selection. Accept to apply, or close to ignore.`
        }
        maxWidth={640}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              <XIcon size={12} /> Discard
            </Button>
            <Button
              variant="primary"
              disabled={totalAdded === 0 || !proposed}
              onClick={() => {
                if (proposed) onApply(proposed);
                setOpen(false);
              }}
            >
              <CheckIcon size={12} /> Apply {totalAdded} change{totalAdded === 1 ? "" : "s"}
            </Button>
          </>
        }
      >
        {diff && (
          <div className="flex flex-col gap-4">
            {diff.addedSubagents.length > 0 && (
              <DiffGroup title="Add helpers" entries={diff.addedSubagents.map((name) => ({
                key: name,
                label: name,
                reason: reasoningFor(name),
              }))} />
            )}
            {diff.addedDirect.length > 0 && (
              <DiffGroup title="Enable tools" entries={diff.addedDirect.map((name) => ({
                key: name,
                label: name,
                reason: reasoningFor(name),
              }))} />
            )}
            {diff.addedCustom.length > 0 && (
              <DiffGroup title="Enable custom tools" entries={diff.addedCustom.map((slug) => {
                const name = availableTools?.customGroups
                  .flatMap((g) => g.tools)
                  .find((t) => t.slug === slug)?.name ?? slug;
                return { key: slug, label: name, reason: reasoningFor(name) || reasoningFor(slug) };
              })} />
            )}
            {totalAdded === 0 && (
              <p className="py-6 text-center text-[12px] text-xyne-fg-tertiary">
                No additions suggested.
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

function DiffGroup({
  title,
  entries,
}: {
  title: string;
  entries: Array<{ key: string; label: string; reason: string }>;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
        {title}
      </div>
      <div className="overflow-hidden rounded-lg border border-xyne-success-border bg-xyne-success-bg/30 divide-y divide-xyne-success-border/40">
        {entries.map((e) => (
          <div key={e.key} className="flex items-start gap-2 px-3 py-2">
            <CheckIcon size={12} className="mt-0.5 shrink-0 text-xyne-success-fg" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11.5px] text-xyne-fg-primary">{e.label}</div>
              {e.reason && (
                <div className="mt-0.5 text-[11px] text-xyne-fg-tertiary">{e.reason}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
