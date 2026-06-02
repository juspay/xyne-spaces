/**
 * AgentPreviewPanel — live preview of the agent under configuration.
 *
 * Default content of the right column. Mirrors the slide-over's summary
 * format but renders against the *draft* state (name, description, system
 * prompt, tool selections, skill selections, behavior fields) so the user
 * sees their in-flight edits before saving.
 *
 * Structure mirrors the four left-column tabs so reading top-to-bottom
 * matches the user's mental model:
 *   1. Identity   — avatar + name + slug + scope + status + description
 *   2. Persona    — system prompt preview (collapsed by default)
 *   3. Knowledge  — attached skills
 *   4. Toolbox    — capability counts by category
 *   5. Behavior   — reminders + reactions summaries
 *   6. Footer     — provider + creation date
 */

import { useState } from "react";
import {
  CaretDownIcon,
  CaretRightIcon,
  RobotIcon,
  WrenchIcon,
  PlugIcon,
  GearSixIcon,
  BookOpenIcon,
  SparkleIcon,
  LightningIcon,
} from "@phosphor-icons/react";
import type { Agent } from "../../../lib/types";
import type { AgentToolSelection } from "../ToolPickerDialog";
import type { AgentProvider } from "../../hooks/useAgents";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";


interface AgentPreviewPanelProps {
  agent: Agent;
  draftName: string;
  draftDescription: string;
  draftPrompt: string;
  draftTools: AgentToolSelection;
  /** Names of skills selected — matched against availableSkills for chips. */
  draftSkillNames: string[];
  draftReminder: string;
  draftReactionsCount: number;
  draftProvider: AgentProvider;
}

export function AgentPreviewPanel({
  agent,
  draftName,
  draftDescription,
  draftPrompt,
  draftTools,
  draftSkillNames,
  draftReminder,
  draftReactionsCount,
  draftProvider,
}: AgentPreviewPanelProps) {
  const [promptExpanded, setPromptExpanded] = useState(false);

  const name = draftName.trim() || agent.name;
  const description = draftDescription.trim();
  const hasPrompt = draftPrompt.trim().length > 0;

  return (
    <div className="flex flex-col gap-5 p-6 max-w-[640px] mx-auto w-full">
      {/* Preview banner — reminds the user that this view reflects in-flight
          edits, not just the persisted agent. */}
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary">
        <EyeBadge />
        Live preview · reflects unsaved changes
      </div>

      {/* Identity card */}
      <div className="flex items-start gap-3 rounded-2xl border border-xyne-border bg-xyne-surface p-4">
        <Avatar
          name={name}
          color={agent.color}
          size={44}
          shape="circle"
        />
        <div className="flex flex-1 min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[18px] font-semibold text-xyne-fg-primary leading-tight truncate">
              {name}
            </h2>
            <span className="font-mono text-[12px] text-xyne-fg-tertiary">
              {agent.slug}
            </span>
            <Badge
              as="span"
              label={agent.scope === "global" ? "global" : "personal"}
              variant={agent.scope === "global" ? "info" : "neutral"}
              size="sm"
            />
            <Badge
              as="span"
              label={agent.enabled ? "Active" : "Paused"}
              variant={agent.enabled ? "success" : "warning"}
              size="sm"
            />
          </div>
          {description ? (
            <p className="text-[13px] text-xyne-fg-secondary leading-relaxed">
              {description}
            </p>
          ) : (
            <p className="text-[12px] italic text-xyne-fg-tertiary">
              No description added
            </p>
          )}
          {/* Created date sits inline with the identity card as a muted
                meta line — answers "when was this set up?" at first
                glance without taking up a dedicated footer row. */}
          <p className="mt-0.5 text-[11px] text-xyne-fg-tertiary">
            Created{" "}
            {new Date(agent.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      {/* Persona — system prompt preview (collapsed). */}
      <PreviewSection
        icon={<SparkleIcon size={14} weight="fill" />}
        title="Persona"
        technical="system prompt"
      >
        {hasPrompt ? (
          <div className="rounded-lg border border-xyne-border bg-xyne-surface">
            <button
              type="button"
              onClick={() => setPromptExpanded((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 text-[12px] text-xyne-fg-tertiary hover:text-xyne-fg-secondary transition-colors w-full"
            >
              {promptExpanded ? (
                <CaretDownIcon size={11} />
              ) : (
                <CaretRightIcon size={11} />
              )}
              <span>{promptExpanded ? "Hide" : "Show"} prompt</span>
              <span className="ml-auto text-xyne-fg-tertiary">
                {draftPrompt.length.toLocaleString()} chars
              </span>
            </button>
            {promptExpanded && (
              <pre className="px-3 pb-3 pt-0 font-mono text-[11px] leading-relaxed text-xyne-fg-primary whitespace-pre-wrap max-h-[280px] overflow-y-auto border-t border-xyne-border-subtle">
                {draftPrompt}
              </pre>
            )}
          </div>
        ) : (
          <EmptyHint text="No persona defined yet" />
        )}
      </PreviewSection>

      {/* Toolbox — capability counts. */}
      <PreviewSection
        icon={<LightningIcon size={14} weight="fill" />}
        title="Toolbox"
        technical="tools"
      >
        <div className="rounded-lg border border-xyne-border bg-xyne-surface divide-y divide-xyne-border-subtle">
          <CapabilityCountRow
            icon={<RobotIcon size={14} />}
            label="Helpers"
            technical="subagents"
            count={draftTools.subagents.length}
          />
          <CapabilityCountRow
            icon={<PlugIcon size={14} />}
            label="Direct actions"
            technical="write tools"
            count={draftTools.direct.length}
          />
          <CapabilityCountRow
            icon={<GearSixIcon size={14} />}
            label="Integrations"
            technical="MCP tools"
            count={draftTools.custom.length}
          />
        </div>
      </PreviewSection>

      {/* Knowledge — skills */}
      <PreviewSection
        icon={<BookOpenIcon size={14} weight="fill" />}
        title="Knowledge"
        technical="skills"
      >
        {draftSkillNames.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {draftSkillNames.map((skillName) => (
              <span
                key={skillName}
                className="text-[12px] px-2.5 py-1 rounded-full bg-xyne-surface-sunken border border-xyne-border text-xyne-fg-secondary"
              >
                {skillName}
              </span>
            ))}
          </div>
        ) : (
          <EmptyHint text="No skills attached" />
        )}
      </PreviewSection>

      {/* Behavior — reminders + reactions summary */}
      <PreviewSection
        icon={<WrenchIcon size={14} weight="fill" />}
        title="Behavior"
        technical="reminders + reactions"
      >
        <div className="flex flex-col gap-2">
          <div className="rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12px] font-medium text-xyne-fg-primary">
                Constant Reminders
              </span>
              <span className="text-[11px] text-xyne-fg-tertiary">
                {draftReminder.trim().length > 0 ? "1 active" : "none"}
              </span>
            </div>
            {draftReminder.trim().length > 0 && (
              <p className="mt-1.5 text-[12px] text-xyne-fg-secondary leading-relaxed line-clamp-3">
                {draftReminder}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12px] font-medium text-xyne-fg-primary">
                Contextual Responses
              </span>
              <span className="text-[11px] text-xyne-fg-tertiary">
                {draftReactionsCount} configured
              </span>
            </div>
          </div>
        </div>
      </PreviewSection>

      {/* Footer removed: Provider chip dropped per design (it's surfaced
            elsewhere); Created date moved up into the identity card as a
            meta line. */}
    </div>
  );
}

/* ── subcomponents ─────────────────────────────────────────────────── */

function PreviewSection({
  icon,
  title,
  technical,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  technical: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-1">
        <span className="text-xyne-fg-tertiary">{icon}</span>
        <span className="text-[13px] font-semibold text-xyne-fg-primary">{title}</span>
        <span className="text-xyne-fg-tertiary">•</span>
        <span className="text-[13px] font-normal text-xyne-fg-tertiary">{technical}</span>
      </div>
      {children}
    </div>
  );
}

function CapabilityCountRow({
  icon,
  label,
  technical,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  technical: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <span className="text-xyne-fg-tertiary">{icon}</span>
      <span className="text-[13px] text-xyne-fg-primary">{label}</span>
      <span className="text-xyne-fg-tertiary">•</span>
      <span className="text-[13px] text-xyne-fg-tertiary">{technical}</span>
      <span
        className={`ml-auto text-[13px] tabular-nums ${
          count > 0 ? "text-xyne-fg-primary font-medium" : "text-xyne-fg-tertiary"
        }`}
      >
        {count}
      </span>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-xyne-border-subtle px-3 py-4 text-center text-[12px] text-xyne-fg-tertiary">
      {text}
    </div>
  );
}

function EyeBadge() {
  return (
    <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-xyne-success-bg text-xyne-success-fg">
      <span className="w-[6px] h-[6px] rounded-full bg-xyne-success" />
    </span>
  );
}
