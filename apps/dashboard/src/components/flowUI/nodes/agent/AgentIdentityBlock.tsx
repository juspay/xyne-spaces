import React, { useLayoutEffect, useRef, useState } from 'react';
import { MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import type { AgentCapability, AgentIdentity } from '@xyne/shared';
import { cn } from '../../../../utils/classNames';
import useMeasure from '../../../../hooks/useMeasure';
import { useNavigate } from 'react-router-dom';
import { CapabilityIcon } from './CapabilityIcon';

/**
 * The agent identity — the INVARIANT core of every `agent` artifact variant.
 *
 * A draft awaiting approval, a live agent's profile and (later) an editor all
 * render this exact block; only the surrounding chrome differs. Keeping it in
 * one component is what makes "show me this agent" and "approve this draft"
 * look like the same object rather than two cards that happen to share fields.
 *
 * Interactivity is injected, not branched on: pass `interactive` and the
 * capability chips become toggles whose state the caller owns (it lives in
 * flow-state, so the backend reads it back on submit). Omit it and the same
 * chips render read-only.
 */

/**
 * Capability chip — two states, exactly as the design draws them:
 *
 *   granted → filled pill, SOLID border, `×` to drop it.
 *   dropped → the "suggestion" look: card-coloured pill, DASHED border, `+` to
 *             put it back.
 *
 * Both states apply to MCP-backed subagents and built-in tools alike; only the
 * brand logo is subagent-only. Read-only cards (a live agent's profile) render
 * the granted pill as a static span with no trailing control.
 */
const CapabilityChip: React.FC<{
  capability: AgentCapability;
  selected: boolean;
  onToggle?: (() => void) | undefined;
  disabled?: boolean;
}> = ({ capability, selected, onToggle, disabled }) => {
  const interactive = Boolean(onToggle);
  // Subagents wrap an integration and get its brand tile; built-in tools are
  // label-only pills with roomier leading padding, exactly as the design splits
  // its "MCP" and "Built in tools" rows.
  const withIcon = capability.kind === 'subagent';

  const content = (
    <>
      {withIcon && <CapabilityIcon iconKey={capability.iconKey} label={capability.label} />}
      <span
        className={cn(
          'truncate text-sm font-medium leading-none',
          selected ? 'text-foreground' : 'text-foreground/60',
        )}
      >
        {capability.label}
      </span>
      {interactive &&
        (selected ? (
          <MultipleCrossCancelDefault size={12} className='shrink-0 text-muted-foreground' />
        ) : (
          <PlusDefault size={16} className='shrink-0 text-muted-foreground' />
        ))}
    </>
  );

  const className = cn(
    'inline-flex max-w-full items-center gap-1.5 overflow-hidden rounded-[10px]',
    'border-[0.8px] border-border py-1',
    selected ? 'bg-foreground/[0.06]' : 'border-dashed bg-card',
    withIcon ? 'pl-1 pr-2' : 'h-9 pl-3 pr-2',
    interactive && !disabled && 'hover:bg-foreground/[0.09]',
    disabled && 'cursor-not-allowed opacity-60',
  );

  if (!interactive) {
    return <span className={className}>{content}</span>;
  }
  return (
    <button
      type='button'
      onClick={onToggle}
      aria-pressed={selected}
      disabled={disabled}
      title={selected ? `Remove ${capability.label}` : `Add ${capability.label} back`}
      className={className}
      data-track-category='AGENT_ARTIFACT'
      data-track-name='TOGGLE_CAPABILITY'
    >
      {content}
    </button>
  );
};

/** Selection wiring for the capability chips. Owned by the caller so the compact
 *  card and the expanded dialog drive ONE state — a chip toggled in either place
 *  is the same edit, because both write the same flow-state key. */
export interface AgentCapabilityInteraction {
  selected: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
}

/** Section title row — the design's 14px label with room for a trailing control. */
const SectionHeader: React.FC<{ label: string; trailing?: React.ReactNode }> = ({
  label,
  trailing,
}) => (
  <div className='flex items-center justify-between gap-2'>
    <p className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>{label}</p>
    {trailing}
  </div>
);

/** Horizontal gap between chips, in px. Must match the `gap-x-*` utility on the
 *  chip row — the fit maths measures widths itself and has to add the gaps. */
const CHIP_GAP = 10;

/**
 * One capability group, collapsed to a SINGLE row by default.
 *
 * An agent with every integration attached produced a wall of ~35 chips that
 * pushed the card's own controls off-screen. So the row shows as many chips as
 * actually fit on one line and hides the rest behind "Show all N tools".
 *
 * Fit is measured, not guessed: an off-screen twin renders every chip at its
 * natural width plus a worst-case toggle, and we walk it counting what fits in
 * the live track — the approach ContextPillRow uses for the composer's context
 * pills. That is what makes the "do they all fit?" answer correct, so a group
 * that fits on one line shows no toggle at all.
 */
const CapabilityGroup: React.FC<{
  label: string;
  items: AgentCapability[];
  interactive?: AgentCapabilityInteraction | undefined;
}> = ({ label, items, interactive }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const { width: trackWidth } = useMeasure({ ref: trackRef, observeResize: true });
  // The twin is `w-max`, so its width changes whenever a label does — using it
  // as a dep re-runs the maths on content changes, not just container resizes.
  const { width: measuredWidth } = useMeasure({ ref: measureRef, observeResize: true });

  const [visibleCount, setVisibleCount] = useState(items.length);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el || trackWidth <= 0) {
      return;
    }
    const widths = (Array.from(el.children) as HTMLElement[]).map(
      child => child.getBoundingClientRect().width,
    );

    // The toggle lives in the header, not the row, so every pixel of the track is
    // available to chips and no reserve has to be subtracted.
    let used = 0;
    let count = 0;
    for (const width of widths) {
      const next = used + width + (count > 0 ? CHIP_GAP : 0);
      if (next > trackWidth) {
        break;
      }
      used = next;
      count += 1;
    }

    setVisibleCount(count);
  }, [trackWidth, measuredWidth, items.length]);

  const shownCount = expanded ? items.length : Math.min(visibleCount, items.length);
  const overflowing = shownCount < items.length;
  const kept = interactive
    ? items.filter(item => interactive.selected.has(item.id)).length
    : items.length;

  const chip = (capability: AgentCapability): React.ReactNode => (
    <CapabilityChip
      key={capability.id}
      capability={capability}
      selected={interactive ? interactive.selected.has(capability.id) : true}
      {...(interactive ? { onToggle: (): void => interactive.onToggle(capability.id) } : {})}
      {...(interactive?.disabled ? { disabled: true } : {})}
    />
  );

  const toggle = (text: string): React.ReactElement => (
    <button
      type='button'
      onClick={(): void => setExpanded(!expanded)}
      className='shrink-0 whitespace-nowrap text-xs font-medium leading-[1.2] text-muted-foreground underline underline-offset-2 hover:text-foreground'
      aria-expanded={expanded}
      data-track-category='AGENT_ARTIFACT'
      data-track-name='TOGGLE_CAPABILITY_OVERFLOW'
    >
      {text}
    </button>
  );

  return (
    <div className='flex flex-col gap-1.5'>
      {/* The toggle replaces the count in the header row, so the chip row itself
          stays purely chips — nothing steals width from what fits. */}
      <SectionHeader
        label={label}
        trailing={
          overflowing || expanded ? (
            toggle(expanded ? 'Show less' : `Show all ${items.length} tools`)
          ) : (
            <span className='text-xs leading-[1.2] text-muted-foreground tabular-nums'>
              {interactive ? `${kept} of ${items.length}` : String(items.length)}
            </span>
          )
        }
      />
      <div
        ref={trackRef}
        className={cn(
          'relative flex min-w-0 items-center gap-x-2.5',
          expanded ? 'flex-wrap gap-y-2.5' : 'flex-nowrap overflow-hidden',
        )}
      >
        {/* Off-screen twin: every chip at natural width plus a worst-case toggle,
            so the reserve is never under-measured. `invisible` rather than
            `hidden` — it still needs layout to be measurable — and absolute so it
            contributes nothing to the track's size. */}
        <div
          ref={measureRef}
          aria-hidden
          className='pointer-events-none invisible absolute left-0 top-0 flex w-max flex-nowrap items-center gap-x-2.5'
        >
          {items.map(chip)}
        </div>

        {items.slice(0, shownCount).map(chip)}
      </div>
    </div>
  );
};

/**
 * The capability list, grouped the way the agent design groups them: integration
 * -backed subagents under "MCP" (brand tile + name), custom tools under
 * "Built in tools" (label-only pills). Exported so the expanded view
 * (AgentPreview) renders the SAME chips with the SAME selection rather than a
 * roomier lookalike that drifts.
 */
export const AgentCapabilities: React.FC<{
  capabilities: AgentCapability[];
  interactive?: AgentCapabilityInteraction | undefined;
}> = ({ capabilities, interactive }) => {
  if (capabilities.length === 0) {
    return null;
  }

  const groups: Array<{ key: string; label: string; items: AgentCapability[] }> = [
    { key: 'mcp', label: 'MCP', items: capabilities.filter(c => c.kind === 'subagent') },
    { key: 'builtin', label: 'Built in tools', items: capabilities.filter(c => c.kind === 'tool') },
  ].filter(group => group.items.length > 0);

  return (
    <div className='flex flex-col gap-4'>
      {groups.map(group => (
        <CapabilityGroup
          key={group.key}
          label={group.label}
          items={group.items}
          interactive={interactive}
        />
      ))}
    </div>
  );
};

/**
 * Footer prompt for capabilities whose integration the viewer hasn't connected.
 *
 * `requiresConnection` is computed per-viewer from their user_mcp_connections, so
 * this counts what YOU would need to connect for the agent's tools to actually
 * run. Clicking goes to where that's fixed:
 *
 *   created / profile → that agent's Connections tab
 *   pending draft     → the MCP list, because the agent does not exist yet and
 *                       its detail route would 404
 *
 * Renders nothing when everything is connected, so a fully-wired agent shows no
 * footer noise.
 */
export const AgentConnectPrompt: React.FC<{
  agent: AgentIdentity;
  /** True once the agent exists and has a detail screen to link to. */
  agentExists?: boolean;
  className?: string;
}> = ({ agent, agentExists = false, className }) => {
  const navigate = useNavigate();
  const unconnected = (agent.capabilities ?? []).filter(c => c.requiresConnection);
  if (unconnected.length === 0) {
    return null;
  }
  const target = agentExists
    ? `/claw-agents/agents/${agent.slug}?tab=connections`
    : '/claw-agents/mcp';

  return (
    <div className={cn('min-w-0 shrink-0', className)}>
      <button
        type='button'
        onClick={(): void => void navigate(target)}
        className='whitespace-nowrap text-xs font-medium leading-[1.2] text-blue-500 underline underline-offset-2 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300'
        data-track-category='AGENT_ARTIFACT'
        data-track-name='CLICK_CONNECT_UNCONNECTED'
      >
        Connect {unconnected.length} unconnected {unconnected.length === 1 ? 'tool' : 'tools'}
      </button>
    </div>
  );
};

/** Connect-account links for capabilities whose integration isn't wired up yet. */
export const AgentConnectLinks: React.FC<{ agent: AgentIdentity }> = ({ agent }) => {
  const links = agent.connectLinks ?? [];
  if (links.length === 0) {
    return null;
  }
  return (
    <div className='flex flex-wrap gap-2'>
      {links.map(link => (
        <a
          key={link.serverType}
          href={link.authUrl}
          target='_blank'
          rel='noreferrer'
          className='text-xs font-medium leading-[1.3] text-foreground underline underline-offset-2 hover:text-foreground/80'
          data-track-category='AGENT_ARTIFACT'
          data-track-name='CLICK_CONNECT'
        >
          Connect {link.displayName}
        </a>
      ))}
    </div>
  );
};

/**
 * Name row + the agent's identifiers — the header block that replaces the old
 * "Agent" header bar. `trailing` carries whatever chrome the card needs on the
 * right (the expand control), so no separate row exists just to hold it.
 *
 * The sub-line is the slug and the model together: the two things that identify
 * WHICH agent this is and what runs it. Both are already in `details`, but a
 * key/value row buries them — here they read at a glance.
 */
export const AgentIdentityHeader: React.FC<{
  agent: AgentIdentity;
  statePill?: React.ReactNode;
  trailing?: React.ReactNode;
}> = ({ agent, statePill, trailing }) => (
  <div className='flex items-start gap-3'>
    <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
      <div className='flex items-center gap-2'>
        <p className='truncate text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
          {agent.name}
        </p>
        {statePill}
      </div>
      {/* `@slug` in the mention colour — it IS the handle you type to reach this
          agent, so it reads the same here as it does in a message. */}
      <p className='flex min-w-0 items-center gap-2 text-sm leading-[22px]'>
        <span className='truncate text-blue-500 dark:text-blue-400'>@{agent.slug}</span>
        {agent.modelId && (
          <>
            <span aria-hidden className='shrink-0 text-foreground/30'>
              ·
            </span>
            <span className='truncate text-foreground/70'>{agent.modelId}</span>
          </>
        )}
      </p>
    </div>
    {trailing}
  </div>
);

/** Labelled description block — "Description", matching the created-agent card. */
export const AgentDescription: React.FC<{ description?: string | undefined }> = ({
  description,
}) => {
  if (!description) {
    return null;
  }
  return (
    <div className='flex flex-col gap-1'>
      <p className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
        Description
      </p>
      <p className='text-sm leading-[22px] text-foreground/70'>{description}</p>
    </div>
  );
};

export const AgentIdentityBlock: React.FC<{
  agent: AgentIdentity;
  /** Present ⇒ capability chips are toggles. Absent ⇒ read-only. */
  interactive?: AgentCapabilityInteraction;
  note?: string | undefined;
  statePill?: React.ReactNode;
  trailing?: React.ReactNode;
}> = ({ agent, interactive, note, statePill, trailing }) => {
  const capabilities = agent.capabilities ?? [];
  const details = agent.details ?? [];

  return (
    <div className='flex flex-col gap-6'>
      <AgentIdentityHeader agent={agent} statePill={statePill} trailing={trailing} />

      <AgentDescription description={agent.description} />

      {details.length > 0 && (
        <div className='flex flex-col gap-1'>
          {details.map(detail => (
            <div key={detail.label} className='flex items-baseline gap-2 text-xs leading-[1.4]'>
              <span className='w-20 shrink-0 text-muted-foreground'>{detail.label}</span>
              <span className='truncate text-foreground/80'>{detail.value || '—'}</span>
            </div>
          ))}
        </div>
      )}

      <AgentCapabilities capabilities={capabilities} interactive={interactive} />

      <AgentConnectLinks agent={agent} />

      {note && <p className='text-xs leading-[1.4] text-muted-foreground'>{note}</p>}
    </div>
  );
};
