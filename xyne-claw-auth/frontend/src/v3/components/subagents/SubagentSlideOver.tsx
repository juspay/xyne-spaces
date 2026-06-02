import {
  LockIcon,
  PencilSimpleIcon,
  TrashIcon,
  SparkleIcon,
  WrenchIcon,
  BookOpenIcon,
  BracketsCurlyIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import type { SubagentDef } from "../../../lib/api";
import { SidePanel } from "../ui/SidePanel";
import { Badge } from "../ui/Badge";
import { Avatar } from "../ui/Avatar";

/* ─────────────────────────────────────────────────────────────────────
 * Shared visual primitives — mirror the agent / MCP slide-overs:
 * small uppercase captions for sections, white surface cards with
 * dividers between rows. Duplicated intentionally (small, isolated)
 * rather than extracted to a shared file.
 * ───────────────────────────────────────────────────────────────────── */

function SectionCaption({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary mb-2">
      {children}
    </div>
  );
}

function MetaCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-xyne-surface border border-xyne-border-subtle rounded-xl overflow-hidden divide-y divide-xyne-border-subtle">
      {children}
    </div>
  );
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="flex items-center gap-2.5 text-[13px] text-xyne-fg-tertiary">
        <span className="w-[16px] h-[16px] flex items-center justify-center text-xyne-fg-tertiary">
          {icon}
        </span>
        {label}
      </span>
      <span className="text-[14px] text-xyne-fg-primary text-right min-w-0 truncate">
        {children}
      </span>
    </div>
  );
}

/* CapabilityRow — matches the agent slide-over's capability row exactly:
   icon + label (top) + hint or chip lane (below) + count + chevron (right). */
function CapabilityRow({
  icon,
  label,
  count,
  hint,
  chips,
  onNavigate,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  hint: string;
  chips?: React.ReactNode;
  onNavigate?: () => void;
}) {
  const isEmpty = count === 0;
  return (
    <button
      type="button"
      onClick={onNavigate}
      disabled={!onNavigate}
      className="group/cap w-full text-left flex items-center gap-2.5 px-4 py-3 hover:bg-xyne-surface-sunken/40 transition-colors disabled:hover:bg-transparent disabled:cursor-default"
    >
      <span className="w-[16px] h-[16px] flex items-center justify-center text-xyne-fg-tertiary flex-shrink-0">
        {icon}
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="text-[13px] text-xyne-fg-secondary">{label}</span>
        {isEmpty ? (
          <span className="text-[12px] text-xyne-fg-tertiary">{hint}</span>
        ) : (
          chips && <div className="flex flex-wrap gap-1.5">{chips}</div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className={`text-[12px] tabular-nums ${
            count > 0 ? "text-xyne-fg-primary font-medium" : "text-xyne-fg-tertiary"
          }`}
        >
          {count}
        </span>
        {onNavigate && (
          <CaretRightIcon
            size={12}
            className="text-xyne-fg-tertiary group-hover/cap:text-xyne-fg-primary transition-colors"
          />
        )}
      </div>
    </button>
  );
}

interface SubagentSlideOverProps {
  subagent: SubagentDef | null;
  isBuiltIn: boolean;
  userId: string;
  onClose: () => void;
  onToggleEnabled: (subagent: SubagentDef, value: boolean) => void;
  onEdit: (name: string) => void;
  onDelete: (subagent: SubagentDef) => void;
}

export function SubagentSlideOver({
  subagent,
  isBuiltIn,
  userId,
  onClose,
  onToggleEnabled,
  onEdit,
  onDelete,
}: SubagentSlideOverProps) {
  if (!subagent) return null;

  const toolCount =
    (subagent.tools?.direct?.length ?? 0) +
    (subagent.tools?.custom?.length ?? 0);

  const footer = !isBuiltIn && (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onEdit(subagent.name)}
        title="Configure subagent"
        className="group inline-flex items-center overflow-hidden rounded-full border border-xyne-border bg-xyne-surface p-1.5 text-xyne-fg-secondary transition-all duration-150 hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
      >
        <PencilSimpleIcon size={14} className="shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap text-[12px] font-medium opacity-0 transition-all duration-150 group-hover:ml-1.5 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:pr-0.5">
          Configure
        </span>
      </button>
      {subagent.createdByUserId === userId && (
        <button
          type="button"
          onClick={() => onDelete(subagent)}
          title="Delete subagent"
          className="group inline-flex items-center overflow-hidden rounded-full border border-xyne-border bg-xyne-surface p-1.5 text-xyne-error-fg transition-all duration-150 hover:bg-xyne-error-bg"
        >
          <TrashIcon size={14} className="shrink-0" />
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-[12px] font-medium opacity-0 transition-all duration-150 group-hover:ml-1.5 group-hover:max-w-[64px] group-hover:opacity-100 group-hover:pr-0.5">
            Delete
          </span>
        </button>
      )}
    </div>
  );

  return (
    <SidePanel
      onClose={onClose}
      icon={
        <Avatar
          name={subagent.name}
          size={40}
          shape="circle"
          className={
            isBuiltIn
              ? "!bg-xyne-surface-sunken !text-xyne-fg-secondary border border-xyne-border"
              : "!bg-xyne-brand/10 !text-xyne-brand border border-xyne-brand/20"
          }
        />
      }
      title={subagent.name}
      badge={
        /* Header meta: status dot + source pill — replaces the previous
           DETAILS table. Built-in subagents show a static dot; custom
           subagents get a clickable dot that flips enabled/disabled (the
           toggle that used to live in the table). Source pill stays as the
           secondary chip so users can still see at a glance whether it's
           platform- or user-provided. */
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!isBuiltIn) onToggleEnabled(subagent, !subagent.enabled);
            }}
            disabled={isBuiltIn}
            title={
              isBuiltIn
                ? `Status: ${subagent.enabled ? "Active" : "Disabled"}`
                : `Click to ${subagent.enabled ? "disable" : "enable"}`
            }
            aria-label={subagent.enabled ? "Active" : "Disabled"}
            className={`inline-flex items-center justify-center w-[14px] h-[14px] rounded-full transition-colors ${
              isBuiltIn
                ? "cursor-default"
                : "hover:bg-xyne-surface-sunken cursor-pointer"
            }`}
          >
            <span
              className={`w-[8px] h-[8px] rounded-full ${
                subagent.enabled ? "bg-xyne-success" : "bg-xyne-warning"
              }`}
            />
          </button>
          {isBuiltIn ? (
            <Badge as="span" label="built-in" variant="neutral" size="sm" />
          ) : (
            <span className="text-[11px] font-medium px-[8px] py-[1px] rounded-full bg-xyne-brand/10 text-xyne-brand border border-xyne-brand/20">
              custom
            </span>
          )}
        </div>
      }
      width={520}
      footer={footer || undefined}
      floating
    >
      <div className="flex flex-col gap-5">
        {/* Built-in banner */}
        {isBuiltIn && (
          <div className="px-3 py-2 bg-xyne-warning-bg border border-xyne-warning-border rounded-lg flex items-center gap-2">
            <LockIcon size={14} className="text-xyne-warning-fg shrink-0" />
            <span className="text-[12px] text-xyne-warning-fg">
              Built-in subagent — provided by the platform and cannot be edited
            </span>
          </div>
        )}

        {/* DESCRIPTION — matches the agent slide-over: caption + body text
            or italic empty hint. */}
        <div>
          <SectionCaption>Description</SectionCaption>
          {subagent.description ? (
            <p className="text-[14px] text-xyne-fg-primary leading-[1.6]">
              {subagent.description}
            </p>
          ) : (
            <span className="text-[13px] italic text-xyne-fg-tertiary">
              No description
            </span>
          )}
        </div>

        {/* Status + Source moved into the header badge slot — see the
            `badge={...}` prop on SidePanel above. The old DETAILS card
            that held both rows is intentionally gone. */}

        {/* CAPABILITIES — mirrors the agent's Capabilities card. Each row
            shows icon + label + count + chip lane below when populated,
            empty hint when count = 0. */}
        <div>
          <SectionCaption>Capabilities</SectionCaption>
          <MetaCard>
            <CapabilityRow
              icon={<BookOpenIcon size={14} />}
              label="Skills"
              count={subagent.skills?.length ?? 0}
              hint="Reference material this specialist consults"
              chips={
                subagent.skills && subagent.skills.length > 0
                  ? subagent.skills.map((skill) => (
                      <span
                        key={skill.id}
                        className="text-[12px] px-2.5 py-1 rounded-full bg-xyne-surface-sunken border border-xyne-border text-xyne-fg-secondary"
                      >
                        {skill.name}
                      </span>
                    ))
                  : null
              }
            />
            <CapabilityRow
              icon={<WrenchIcon size={14} />}
              label="Tools"
              count={toolCount}
              hint="Actions this specialist can perform"
              chips={
                toolCount > 0
                  ? [
                      ...(subagent.tools?.direct ?? []).map((t) => (
                        <span
                          key={`d-${t}`}
                          className="text-[12px] px-2.5 py-1 rounded-full bg-xyne-surface-sunken border border-xyne-border text-xyne-fg-secondary"
                        >
                          {t}
                        </span>
                      )),
                      ...(subagent.tools?.custom ?? []).map((t) => (
                        <span
                          key={`c-${t}`}
                          className="text-[12px] px-2.5 py-1 rounded-full bg-xyne-surface-sunken border border-xyne-border text-xyne-fg-secondary"
                        >
                          {t}
                        </span>
                      )),
                    ]
                  : null
              }
            />
            {/* Parameter — the contract the parent agent must satisfy when
                delegating: a single argument with a name + description.
                Shown as one chip (the paramName, mono) over a hint
                line (paramDescription). High signal for "should I use
                this specialist?" decisions. */}
            <CapabilityRow
              icon={<BracketsCurlyIcon size={14} />}
              label="Parameter"
              count={subagent.paramName ? 1 : 0}
              hint={
                subagent.paramDescription ||
                "What the parent agent passes in when delegating"
              }
              chips={
                subagent.paramName ? (
                  <span
                    className="font-mono text-[12px] px-2.5 py-1 rounded-full bg-xyne-surface-sunken border border-xyne-border text-xyne-fg-secondary"
                    title={subagent.paramDescription || undefined}
                  >
                    {subagent.paramName}
                  </span>
                ) : null
              }
            />
          </MetaCard>
        </div>

        {/* SYSTEM PROMPT — at the bottom as a collapsible block. Tech-user
            surface; matches the MCP slide-over's Configuration collapsible. */}
        {subagent.systemPrompt && (
          <details className="group/sp">
            <summary className="flex items-center gap-2 cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary hover:text-xyne-fg-secondary transition-colors list-none [&::-webkit-details-marker]:hidden">
              <CaretRightIcon
                size={11}
                weight="bold"
                className="transition-transform group-open/sp:rotate-90"
              />
              <SparkleIcon size={11} weight="fill" />
              System prompt
            </summary>
            <pre className="mt-2 max-h-[260px] overflow-y-auto rounded-lg border border-xyne-border-subtle bg-xyne-surface-sunken p-3 font-mono text-[11px] leading-relaxed text-xyne-fg-secondary whitespace-pre-wrap">
              {subagent.systemPrompt}
            </pre>
          </details>
        )}
      </div>
    </SidePanel>
  );
}
