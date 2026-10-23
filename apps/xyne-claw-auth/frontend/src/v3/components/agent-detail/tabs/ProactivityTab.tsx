import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatCircleDotsIcon } from "@phosphor-icons/react";
import { regenerateRoutingCard, updateAgent } from "../../../../lib/api";
import type { Agent } from "../../../../lib/types";
import { useSnackbar } from "../../ui/Snackbar";

/** Same limit as the server's validator (agent-proactivity/config.ts). */
const DESCRIPTION_MAX = 500;

export interface ProactivitySettings {
  description: string;
  /** Written from the prompt and tools; routing reads it unless `description` is set. */
  card: string;
}

export function readProactivity(config: Record<string, unknown> | null | undefined): ProactivitySettings {
  const raw = (config?.["proactivity"] ?? {}) as Record<string, unknown>;
  const generated = (raw["generated"] ?? {}) as Record<string, unknown>;
  return {
    description: typeof raw["description"] === "string" ? raw["description"] : "",
    card: typeof generated["text"] === "string" ? generated["text"] : "",
  };
}

export function summarizeProactivity(s: ProactivitySettings): string {
  return s.description ? "Scope written by you" : s.card ? "Scope written from the agent" : "No scope yet";
}

interface Props {
  agent: Agent;
  canEdit: boolean;
  onAgentUpdated?: (agent: Agent) => void;
}

/**
 * The card Spaces picks this agent by for a channel question nobody tagged it in, and
 * the owner's own text that replaces it. Channel admins choose whether a channel allows it.
 */
export function ProactivityTab({ agent, canEdit, onAgentUpdated }: Props) {
  const { show: showSnackbar } = useSnackbar();
  const saved = useMemo(() => readProactivity(agent.config), [agent.config]);
  const [draft, setDraft] = useState(saved);
  const [card, setCard] = useState(saved.card);
  useEffect(() => setCard(saved.card), [saved.card]);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const dirty = draft.description !== saved.description;

  const persist = useCallback(async () => {
    setSaving(true);
    // Spread first: the server replaces `config` wholesale.
    const nextConfig: Record<string, unknown> = {
      ...agent.config,
      proactivity: { ...(agent.config?.["proactivity"] as object ?? {}), description: draft.description.trim() },
    };
    try {
      const updated = await updateAgent(agent.slug, { config: nextConfig });
      onAgentUpdated?.(updated);
      showSnackbar({ variant: "success", title: "Saved" });
    } catch (err) {
      showSnackbar({ variant: "error", title: "Failed to save", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }, [agent.config, agent.slug, draft, onAgentUpdated, showSnackbar]);

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      setCard((await regenerateRoutingCard(agent.slug)).text);
    } catch (err) {
      showSnackbar({ variant: "error", title: "Could not write the scope", description: err instanceof Error ? err.message : undefined });
    } finally {
      setRegenerating(false);
    }
  }, [agent.slug, showSnackbar]);

  return (
    <div className="flex flex-col gap-5 p-4 pb-24">
      <div className="flex gap-3 rounded-xl border border-xyne-border bg-xyne-surface p-4">
        <ChatCircleDotsIcon size={20} weight="bold" className="mt-0.5 shrink-0 text-xyne-brand" />
        <div>
          <h3 className="text-[13px] font-semibold text-xyne-fg-primary">Answer in channels without a mention</h3>
          <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-xyne-fg-tertiary">
            When someone asks something in a channel this agent is in and nobody answers, Spaces can ask this
            agent for a reply. It answers read-only, as its own bot, from this channel, public channels and its own
            knowledge bases and connectors, and only if the question is still open when the draft is ready. Channel
            admins choose whether a channel allows it.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-xyne-fg-primary">Scope</span>
          {canEdit && (
            <button
              type="button"
              disabled={regenerating}
              onClick={() => void regenerate()}
              className="text-[12px] font-medium text-xyne-brand disabled:opacity-50"
            >
              {regenerating ? "Writing…" : "Regenerate"}
            </button>
          )}
        </div>
        <span className="text-[12px] text-xyne-fg-tertiary">
          What this agent answers, the problems it handles, and what it is not for. Spaces picks an agent for a
          question nobody tagged by its scope. Written from the agent's prompt, tools and skills, and from what people
          asked it in public channels; rewritten when those change, and weekly as new questions come in.
        </span>
        <pre className="whitespace-pre-wrap rounded-lg border border-xyne-border bg-xyne-surface p-3 text-[12px] leading-relaxed text-xyne-fg-secondary">
          {card || "Not written yet. Regenerate to write it now."}
        </pre>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-xyne-fg-primary">Your own scope (optional)</span>
        <span className="text-[12px] text-xyne-fg-tertiary">
          Used instead of the written one when set. Name the product, what it answers and what it is not for, for
          example: “Incidents, deploys and alerts for Xyne Spaces, from Grafana and the runbooks. Not for: app bugs or
          code changes”.
        </span>
        <textarea
          className="min-h-[80px] rounded-lg border border-xyne-border bg-xyne-surface p-2 text-[13px] text-xyne-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-xyne-border-focus disabled:opacity-60"
          value={draft.description}
          maxLength={DESCRIPTION_MAX}
          disabled={!canEdit}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        />
      </label>

      {canEdit && (
        <div>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void persist()}
            className="rounded-lg bg-xyne-brand px-3 py-1.5 text-[12px] font-medium text-xyne-fg-inverse disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
