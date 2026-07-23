import React, { useState } from 'react';
import { ExternalLink, Spinner, CheckTickSingle, MultipleCrossCancelDefault } from '@xyne/icons';
import { useFlow } from '../FlowContext';
import type {
  FlowComponent,
  PrApprovalProps,
  PrApprovalMeta,
  PrApprovalOutcome,
} from '@xyne/shared';
import { cn } from '../../../utils/classNames';

/**
 * PR approval artifact — an interactive human-in-the-loop (HITL) gate.
 *
 * The agent wants to perform a gated write (merge a PR) and asks the human to
 * Approve or Deny. Unlike the read-only `pr` status card, this one has a real
 * flow-action round-trip.
 *
 * `props.phase` is the discriminant and picks the layout:
 *   pending  → meta row + Approve/Deny buttons (real submit actions).
 *   resolved → outcome badge (approved ✓ / denied ✗), NO buttons.
 * `outcome` exists EXACTLY when resolved (enforced by the zod discriminated
 * union), so the renderer branches once on phase.
 *
 * ── Action wiring ────────────────────────────────────────────────────────────
 * Approve/Deny are universal, so the actionIds are BAKED here (`pr-approve` /
 * `pr-deny`) — nothing about the action is on the wire. Each button calls
 * useFlow().executeAction({ type:'submit', actionId }); `state.values` stays
 * `{}` (no user-authored form state). The backend keys off actionId + the
 * flow's top-level `data` (prId/repo/targetBranch/signature — carried in
 * FlowDefinition.data, NOT in these props), performs the merge, and flips the
 * card by `updateMessage`-ing the SAME screenId to phase:'resolved'.
 *
 * ── v1 IS DISPLAY-ONLY (read carefully) ──────────────────────────────────────
 * The buttons are wired to the REAL executeAction round-trip, but there is NO
 * backend handler yet — clicking POSTs to /apps/flow/action and the backend does
 * NOT merge or updateMessage. So the card legitimately CANNOT self-transition to
 * resolved in v1; that pending → resolved flip is future backend work (mirrors
 * the plan's proposed → executing, same-screenId updateMessage).
 *
 * Freeze-bug discipline: the resolved outcome is agent-authoritative → it is
 * read from PROPS, never written into client state. The ONLY local state is
 * ephemeral `inFlight` (which button was pressed) + useFlow().state.submitting,
 * used to spinner the pressed button. FlowRenderer.executeAction owns error
 * toasts — we don't swallow them.
 *
 * ── Wire contract ────────────────────────────────────────────────────────────
 * Source of truth + zod: shared/src/validation/flowSchema.ts
 * (`prApprovalComponentSchema`). One component in a FlowJSON FlowDefinition,
 * JSON-stringified + `"`→`&quot;` escaped inside <div data-flow-json="…">.
 *
 *   { version:'2.0', screenId:'agent-pr-approval-<id>', title:'PR Approval',
 *     data: { prId, repo, targetBranch, signature },   // backend execute-context
 *     state: { …empty… },
 *     components: [{ id:'pr-approval', type:'pr_approval', props:
 *       // phase 'pending'
 *       { phase:'pending', title, url?, meta?:{ ci?, diff?:{added,removed}, reviewsPending? } }
 *       // phase 'resolved'
 *       { phase:'resolved', title, url?, meta?, outcome:'approved'|'denied' }
 *     }] }
 *
 * props is .strict(); `diff` is atomic (both-or-neither); presentation
 * (colours/labels) is derived below from `ci`/`diff`/`outcome`, never on the wire.
 */
interface PrApprovalNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

const APPROVE_ACTION_ID = 'pr-approve';
const DENY_ACTION_ID = 'pr-deny';

export const PrApprovalNode: React.FC<PrApprovalNodeProps> = ({ node }) => {
  const props = node.props as PrApprovalProps | undefined;
  if (!props) return null;

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-4 p-4'>
        <div className='flex flex-col gap-1.5'>
          <TitleRow title={props.title} url={props.url} />
          {props.meta && <MetaRow meta={props.meta} />}
        </div>

        {props.phase === 'pending' ? <Actions /> : <OutcomeBadge outcome={props.outcome} />}
      </div>
    </CardShell>
  );
};

const CardShell: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties | undefined;
}> = ({ children, style }) => (
  <div
    className='flex w-full max-w-[450px] flex-col overflow-hidden rounded-xl border border-border bg-card'
    style={style}
  >
    {children}
  </div>
);

const TitleRow: React.FC<{ title: string; url?: string | undefined }> = ({ title, url }) => (
  <div className='flex items-center gap-[5px]'>
    <p className='min-w-0 flex-1 break-words text-sm font-semibold leading-[1.2] text-foreground'>
      {title}
    </p>
    {url && (
      // Inside `.jp-message-html`, so `!text-* !no-underline` beat the global
      // link rule (blue + underline) that otherwise wins by specificity.
      <a
        href={url}
        target='_blank'
        rel='noopener noreferrer'
        aria-label='Open pull request'
        className='shrink-0 !text-muted-foreground !no-underline hover:!text-foreground'
        data-track-category='PR_APPROVAL_ARTIFACT'
        data-track-name='OPEN_PR_LINK'
      >
        <ExternalLink size={16} className='block' />
      </a>
    )}
  </div>
);

const MetaRow: React.FC<{ meta: PrApprovalMeta }> = ({ meta }) => {
  const reviews = meta.reviewsPending;
  return (
    <div className='flex flex-wrap items-center gap-1.5 font-mono text-sm leading-[1.2] text-muted-foreground'>
      {meta.ci && <CiStat ci={meta.ci} />}
      {meta.diff && <DiffStat added={meta.diff.added} removed={meta.diff.removed} />}
      {!!reviews && reviews > 0 && (
        <span className='tabular-nums'>
          {reviews} review{reviews === 1 ? '' : 's'} pending
        </span>
      )}
    </div>
  );
};

const CI_META: Record<PrApprovalMeta['ci'] & string, { label: string; className: string }> = {
  passing: { label: 'CI passing', className: '' },
  failing: { label: 'CI failing', className: 'text-[var(--status-failure)]' },
  pending: { label: 'CI pending', className: 'text-[var(--status-pending)]' },
};

const CiStat: React.FC<{ ci: NonNullable<PrApprovalMeta['ci']> }> = ({ ci }) => {
  const { label, className } = CI_META[ci];
  return <span className={className}>{label}</span>;
};

const DiffStat: React.FC<{ added: number; removed: number }> = ({ added, removed }) => (
  <span className='tabular-nums'>
    <span className='text-[var(--status-success)]'>+{added}</span>
    <span>/</span>
    <span className='text-[var(--status-failure)]'>&#8722;{removed}</span>
    <span>{' lines'}</span>
  </span>
);

const Actions: React.FC = () => {
  const { state, executeAction } = useFlow();
  const [inFlight, setInFlight] = useState<PrApprovalOutcome | null>(null);

  const run = async (which: PrApprovalOutcome, actionId: string): Promise<void> => {
    if (state.submitting) return;
    setInFlight(which);
    try {
      await executeAction({ type: 'submit', actionId });
    } finally {
      setInFlight(null);
    }
  };

  return (
    <div className='flex items-center gap-1.5'>
      <button
        type='button'
        disabled={state.submitting}
        onClick={() => void run('approved', APPROVE_ACTION_ID)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5',
          'text-sm font-medium leading-[1.2] text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='PR_APPROVAL_ARTIFACT'
        data-track-name='CLICK_APPROVE'
      >
        {inFlight === 'approved' && <Spinner size={14} className='animate-spin' />}
        Approve
      </button>
      <button
        type='button'
        disabled={state.submitting}
        onClick={() => void run('denied', DENY_ACTION_ID)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5',
          'text-sm font-medium leading-[1.2] text-foreground/80',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='PR_APPROVAL_ARTIFACT'
        data-track-name='CLICK_DENY'
      >
        {inFlight === 'denied' && <Spinner size={14} className='animate-spin' />}
        Deny
      </button>
    </div>
  );
};

const OUTCOME_META: Record<
  PrApprovalOutcome,
  {
    label: string;
    bgVar: string;
    fgVar: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
  }
> = {
  approved: {
    label: 'Approved',
    bgVar: 'var(--pr-badge-created-bg)',
    fgVar: 'var(--pr-badge-created-fg)',
    Icon: CheckTickSingle as React.ComponentType<{ size?: number; className?: string }>,
  },
  denied: {
    label: 'Denied',
    bgVar: 'var(--pr-badge-danger-bg)',
    fgVar: 'var(--pr-badge-danger-fg)',
    Icon: MultipleCrossCancelDefault as React.ComponentType<{ size?: number; className?: string }>,
  },
};

const OutcomeBadge: React.FC<{ outcome: PrApprovalOutcome }> = ({ outcome }) => {
  const { label, bgVar, fgVar, Icon } = OUTCOME_META[outcome];
  return (
    <span
      className='inline-flex h-6 w-fit items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium leading-none'
      style={{ backgroundColor: bgVar, color: fgVar }}
    >
      <Icon size={14} className='shrink-0' />
      {label}
    </span>
  );
};
