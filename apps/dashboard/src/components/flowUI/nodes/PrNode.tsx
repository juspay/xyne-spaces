import React, { useContext, useState } from 'react';
import { GitBranch } from '@xyne/icons';
import type { FlowComponent, PrProps, PrStatus, PrProvider } from '@xyne/shared';
import { useFlow } from '../FlowContext';
import { PrPreview, InsidePrPreviewContext } from './PrPreview';
import { cn } from '../../../utils/classNames';

/**
 * PR artifact — an agent-authored, read-only status card for a pull request.
 *
 * `props.status` is a flat enum (created | merged | reverted | deleted | declined),
 * NOT a discriminated union: every status carries the same fields, and the only thing
 * that varies by status is presentation (badge colour + label), which is derived
 * here in STATUS_META — never shipped on the wire. There is no illegal field
 * combination to prevent, so a union would be four identical branches.
 *
 * Status → badge (colour tokens live in global.css, all three themes):
 *   created  → green  (--pr-badge-created-*)
 *   merged   → purple (--pr-badge-merged-*)
 *   reverted → red    (--pr-badge-danger-*)
 *   deleted  → red    (--pr-badge-danger-*)
 *   declined → red    (--pr-badge-danger-*)   (webhook-driven: closed unmerged)
 * One GitBranch glyph for every status/provider, recoloured via the badge
 * fg (currentColor). `provider` drives only the "Open in <Provider>" link label
 * (text), not the icon.
 *
 * The card reads conversationId/messageId from useFlow (to feed the detail
 * preview's thread panel) and has no flow-action — all display data comes from
 * props. The only local state is the detail preview's open/close, held in a
 * plain useState (ephemeral UI state, NOT flow state — nothing to persist).
 *
 * Footer:
 *   "View Details" (bordered <button>) opens PrPreview — the SAME split-screen
 *     shell the plan preview / attachment viewer use (PreviewSplitDialog): LEFT =
 *     the PR detail (status badge + ticketId/title + full markdown description +
 *     the PR/ticket links), RIGHT = the live thread. Hidden when the card is
 *     rendered INSIDE that preview's own thread panel (InsidePrPreviewContext),
 *     so a nested preview can't be stacked.
 *   "Open in <Provider>" (plain <a target="_blank">) renders only when `url`
 *     is present — a direct external link, no preview.
 * Optional URLs mean "no link" is `undefined` (honest), never "".
 *
 * PrPreview (via PreviewSplitDialog → Radix, portals to <body>) renders OUTSIDE
 * the `.jp-message-html` container, so the global underline/blue link rule does
 * not reach its links. The card's own PR link IS inside that container, so it
 * carries the `!text-foreground !no-underline` override to beat that rule.
 *
 * ── Wire contract (backend emits this) ───────────────────────────────────────
 * The PR is one component inside a FlowJSON FlowDefinition. Source of truth +
 * zod validation: shared/src/validation/flowSchema.ts (`prComponentSchema`).
 * The whole FlowDefinition is JSON-stringified, `"`→`&quot;` escaped, and stored
 * in messages.content as: <div data-flow-json="…">Flow JSON</div>. The backend
 * posts once with a screenId keyed on PR identity, then `updateMessage`s the
 * SAME screenId to advance status (one evolving card per PR).
 *
 *   { version: '2.0', screenId: 'agent-pr-<identity>', title: 'Pull Request',
 *     state: { values:{}, touched:{}, errors:{}, submitting:false,
 *              submitted:false, history:[], loadingComponentIds:[] },  // always empty
 *     components: [{
 *       id: 'pr', type: 'pr',
 *       props: {
 *         status: 'created' | 'merged' | 'reverted' | 'deleted' | 'declined', // required
 *         provider: 'github' | 'bitbucket' | 'gitlab' | 'other',   // required
 *         title: string,                                           // required
 *         ticketId?: string,                                       // optional
 *         desc?: string,                                           // optional
 *         detailsUrl?: string,                                     // optional (ticket)
 *         url?: string,                                            // optional (the PR)
 *       },
 *     }] }
 *
 * props is .strict() — unknown keys are rejected at chatController validation.
 */
interface PrNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

// provider → external-link label only. The badge glyph is a single GitBranch for
// every provider (no per-provider icons); `provider` still drives the "Open in
// <Provider>" text so the link reads correctly across hosts.
const PROVIDER_OPEN_LABEL: Record<PrProvider, string> = {
  github: 'Open in GitHub',
  bitbucket: 'Open in Bitbucket',
  gitlab: 'Open in GitLab',
  other: 'Open pull request',
};

const STATUS_META: Record<PrStatus, { label: string; bgVar: string; fgVar: string }> = {
  created: {
    label: 'PR Created',
    bgVar: 'var(--pr-badge-created-bg)',
    fgVar: 'var(--pr-badge-created-fg)',
  },
  merged: {
    label: 'PR Merged',
    bgVar: 'var(--pr-badge-merged-bg)',
    fgVar: 'var(--pr-badge-merged-fg)',
  },
  reverted: {
    label: 'PR Reverted',
    bgVar: 'var(--pr-badge-danger-bg)',
    fgVar: 'var(--pr-badge-danger-fg)',
  },
  deleted: {
    label: 'PR Deleted',
    bgVar: 'var(--pr-badge-danger-bg)',
    fgVar: 'var(--pr-badge-danger-fg)',
  },
  // Webhook-driven: a PR closed without merging. Shares the danger palette with
  // reverted/deleted (no new CSS var needed).
  declined: {
    label: 'PR Declined',
    bgVar: 'var(--pr-badge-danger-bg)',
    fgVar: 'var(--pr-badge-danger-fg)',
  },
};

export const PrNode: React.FC<PrNodeProps> = ({ node }) => {
  const props = node.props as PrProps | undefined;
  // conversationId/messageId feed the preview's thread panel (same as PlanNode).
  const { conversationId, messageId } = useFlow();
  // True when this card is re-rendered inside the preview's own thread panel —
  // hide the "View Details" affordance (and skip mounting a nested preview).
  const insidePreview = useContext(InsidePrPreviewContext);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!props) return null;

  const hasActions = Boolean(props.detailsUrl) || Boolean(props.url);

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-3 p-4'>
        <StatusBadge status={props.status} />
        <TitleBlock ticketId={props.ticketId} title={props.title} desc={props.desc} />
      </div>

      <div className='flex items-center gap-2 border-t border-border bg-foreground/[0.03] px-4 py-3'>
        {!insidePreview && (
          <button
            type='button'
            onClick={() => setDetailsOpen(true)}
            className='rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-medium leading-[1.2] text-foreground'
            data-track-category='PR_ARTIFACT'
            data-track-name='OPEN_DETAILS_PREVIEW'
          >
            View Details
          </button>
        )}
        {props.url && (
          <FooterLink href={props.url}>{PROVIDER_OPEN_LABEL[props.provider]}</FooterLink>
        )}
      </div>

      {!insidePreview && (
        <PrPreview
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          messageId={messageId ?? ''}
          conversationId={conversationId ?? undefined}
          title={props.title}
          ticketId={props.ticketId}
          desc={props.desc}
          badge={<StatusBadge status={props.status} />}
          footer={hasActions ? <PrPreviewFooter props={props} /> : undefined}
        />
      )}
    </CardShell>
  );
};

const CardShell: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties | undefined;
}> = ({ children, style }) => (
  <div
    className='flex w-full max-w-[450px] flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
    style={style}
  >
    {children}
  </div>
);

const StatusBadge: React.FC<{ status: PrStatus }> = ({ status }) => {
  const { label, bgVar, fgVar } = STATUS_META[status];
  return (
    <span
      className='inline-flex h-6 w-fit items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium leading-none'
      style={{ backgroundColor: bgVar, color: fgVar }}
    >
      <GitBranch size={16} className='shrink-0' />
      {label}
    </span>
  );
};

const TitleBlock: React.FC<{
  ticketId?: string | undefined;
  title: string;
  desc?: string | undefined;
}> = ({ ticketId, title, desc }) => (
  <div className='flex flex-col gap-1.5'>
    <p className='text-[15px] font-semibold leading-[1.3] text-foreground'>
      {ticketId && <span className='text-muted-foreground'>{ticketId} </span>}
      {title}
    </p>
    {desc && <p className='line-clamp-2 text-sm leading-[1.4] text-muted-foreground'>{desc}</p>}
  </div>
);

// Card-footer "Open in <Provider>" link. This lives INSIDE the `.jp-message-html`
// container, so `!text-foreground !no-underline` are needed to beat the global
// `.jp-message-html a` rule (blue + underline) that otherwise wins by specificity.
const FooterLink: React.FC<{
  href: string;
  children: React.ReactNode;
}> = ({ href, children }) => (
  <a
    href={href}
    target='_blank'
    rel='noopener noreferrer'
    className='rounded-lg px-2 py-1.5 text-sm font-medium leading-[1.2] !text-foreground !no-underline hover:!text-foreground'
    data-track-category='PR_ARTIFACT'
    data-track-name='CLICK_OPEN_PR'
  >
    {children}
  </a>
);

// ── Preview footer ──────────────────────────────────────────────────────────
// The PR / ticket link-buttons shown in the PrPreview left-panel footer, passed
// into PrPreview as `footer`. Only rendered when at least one URL is present
// (PrNode gates on hasActions). Portaled (outside `.jp-message-html`), so plain
// `text-foreground no-underline` tokens suffice.
const PrPreviewFooter: React.FC<{ props: PrProps }> = ({ props }) => (
  <div className='flex items-center gap-2'>
    {props.detailsUrl && (
      <DialogLink href={props.detailsUrl} bordered>
        {props.ticketId ? 'Open ticket' : 'View details'}
      </DialogLink>
    )}
    {props.url && <DialogLink href={props.url}>{PROVIDER_OPEN_LABEL[props.provider]}</DialogLink>}
  </div>
);

// Link-button inside the preview footer. Portaled to <body>, i.e. outside
// `.jp-message-html`, so the global link rule does not apply — plain tokens work.
const DialogLink: React.FC<{
  href: string;
  bordered?: boolean;
  children: React.ReactNode;
}> = ({ href, bordered, children }) => (
  <a
    href={href}
    target='_blank'
    rel='noopener noreferrer'
    className={cn(
      'rounded-lg px-2 py-1.5 text-sm font-medium leading-[1.2] text-foreground no-underline',
      bordered && 'border border-border bg-background',
    )}
    data-track-category='PR_ARTIFACT'
    data-track-name={bordered ? 'DIALOG_OPEN_DETAILS_URL' : 'DIALOG_OPEN_PR'}
  >
    {children}
  </a>
);
