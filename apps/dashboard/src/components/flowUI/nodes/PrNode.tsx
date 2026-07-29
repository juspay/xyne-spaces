import React, { useState } from 'react';
import { GitBranch, MultipleCrossCancelDefault } from '@xyne/icons';
import type { FlowComponent, PrProps, PrStatus } from '@xyne/shared';
import Dialog from '../../ui/Dialog';
import { cn } from '../../../utils/classNames';

/**
 * PR artifact — an agent-authored, read-only status card for a pull request.
 *
 * `props.status` is a flat enum (created | merged | reverted | deleted), NOT a
 * discriminated union: every status carries the same fields, and the only thing
 * that varies by status is presentation (badge colour + label), which is derived
 * here in STATUS_META — never shipped on the wire. There is no illegal field
 * combination to prevent, so a union would be four identical branches.
 *
 * Status → badge (colour tokens live in global.css, all three themes):
 *   created  → green  (--pr-badge-created-*)
 *   merged   → purple (--pr-badge-merged-*)
 *   reverted → red    (--pr-badge-danger-*)
 *   deleted  → red    (--pr-badge-danger-*)
 * One GitBranch glyph for all four, recoloured via the badge fg (currentColor).
 *
 * The card reads nothing from useFlow and has no flow-action — all data comes
 * from props. The only local state is the detail dialog's open/close, held in a
 * plain useState (ephemeral UI state, NOT flow state — nothing to persist).
 *
 * Footer:
 *   "View Details" (bordered <button>) ALWAYS renders — it opens an in-app
 *     centered dialog built from the card's own props (full title + un-clamped
 *     desc + the two URLs as link-buttons). There is always detail to show, so
 *     this is not gated on any URL. detailsUrl is instead an optional link
 *     INSIDE the dialog.
 *   "Open in Bitbucket" (plain <a target="_blank">) renders only when
 *     bitbucketUrl is present — a direct external link, no dialog.
 * Optional URLs mean "no link" is `undefined` (honest), never "".
 *
 * The dialog (shared ui/Dialog → Radix, portals to <body>) renders OUTSIDE the
 * `.jp-message-html` container, so the global underline/blue link rule does not
 * reach its links. The card's own Bitbucket link IS inside that container, so it
 * carries the `!text-foreground !no-underline` override to beat that rule.
 *
 * ── Wire contract (backend emits this) ───────────────────────────────────────
 * The PR is one component inside a FlowJSON FlowDefinition. Source of truth +
 * zod validation: shared/src/validation/flowSchema.ts (`prComponentSchema`).
 * The whole FlowDefinition is JSON-stringified, `"`→`&quot;` escaped, and stored
 * in messages.content as: <div data-flow-json="…">Flow JSON</div>. Each status is
 * a FRESH post with a UNIQUE screenId — the card never updates in place.
 *
 *   { version: '2.0', screenId: 'agent-pr-<unique>', title: 'Pull Request',
 *     state: { values:{}, touched:{}, errors:{}, submitting:false,
 *              submitted:false, history:[], loadingComponentIds:[] },  // always empty
 *     components: [{
 *       id: 'pr', type: 'pr',
 *       props: {
 *         status: 'created' | 'merged' | 'reverted' | 'deleted',  // required
 *         title: string,                                          // required
 *         ticketId?: string,                                      // optional
 *         desc?: string,                                          // optional
 *         detailsUrl?: string,                                    // optional
 *         bitbucketUrl?: string,                                  // optional
 *       },
 *     }] }
 *
 * props is .strict() — unknown keys are rejected at chatController validation.
 */
interface PrNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

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
};

export const PrNode: React.FC<PrNodeProps> = ({ node }) => {
  const props = node.props as PrProps | undefined;
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!props) return null;

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-3 p-4'>
        <StatusBadge status={props.status} />
        <TitleBlock ticketId={props.ticketId} title={props.title} desc={props.desc} />
      </div>

      <div className='flex items-center gap-2 border-t border-border bg-foreground/[0.03] px-4 py-3'>
        <button
          type='button'
          onClick={() => setDetailsOpen(true)}
          className='rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-medium leading-[1.2] text-foreground'
          data-track-category='PR_ARTIFACT'
          data-track-name='OPEN_DETAILS_DIALOG'
        >
          View Details
        </button>
        {props.bitbucketUrl && <FooterLink href={props.bitbucketUrl}>Open in Bitbucket</FooterLink>}
      </div>

      <PrDetailsDialog open={detailsOpen} onOpenChange={setDetailsOpen} props={props} />
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

// Card-footer "Open in Bitbucket" link. This lives INSIDE the `.jp-message-html`
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
    data-track-name='CLICK_OPEN_BITBUCKET'
  >
    {children}
  </a>
);

// ── Detail dialog ─────────────────────────────────────────────────────────
// Centered modal (shared ui/Dialog → Radix, portals to <body>, mobile→Drawer).
// Shows the full, un-clamped PR detail built entirely from props. Its links are
// outside `.jp-message-html`, so plain `text-foreground no-underline` suffice.
const PrDetailsDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  props: PrProps;
}> = ({ open, onOpenChange, props }) => {
  const heading = props.ticketId ? `${props.ticketId} ${props.title}` : props.title;
  const hasActions = Boolean(props.detailsUrl) || Boolean(props.bitbucketUrl);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={heading}
      description={props.desc ?? 'Pull request details'}
      className='max-w-lg overflow-hidden'
    >
      <div className='flex flex-col'>
        {/* Header: status badge + close */}
        <div className='flex items-center justify-between gap-3 px-5 py-4 pb-0'>
          <StatusBadge status={props.status} />
          <button
            type='button'
            onClick={() => onOpenChange(false)}
            aria-label='Close'
            className='rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            data-track-category='PR_ARTIFACT'
            data-track-name='CLOSE_DETAILS_DIALOG'
          >
            <MultipleCrossCancelDefault size={18} />
          </button>
        </div>

        {/* Body: full title + un-clamped description */}
        <div className='flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-5 py-4'>
          <p className='text-base font-semibold leading-[1.35] text-foreground'>
            {props.ticketId && <span className='text-muted-foreground'>{props.ticketId} </span>}
            {props.title}
          </p>
          {props.desc && (
            <p className='whitespace-pre-wrap text-sm leading-[1.55] text-muted-foreground'>
              {props.desc}
            </p>
          )}
        </div>

        {/* Footer: the two URLs as link-buttons, each only if present */}
        {hasActions && (
          <div className='flex items-center gap-2 border-t border-border bg-foreground/[0.03] px-5 py-4'>
            {props.detailsUrl && (
              <DialogLink href={props.detailsUrl} bordered>
                {props.ticketId ? 'Open ticket' : 'View details'}
              </DialogLink>
            )}
            {props.bitbucketUrl && (
              <DialogLink href={props.bitbucketUrl}>Open in Bitbucket</DialogLink>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
};

// Link-button inside the dialog. Portaled to <body>, i.e. outside
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
    data-track-name={bordered ? 'DIALOG_OPEN_DETAILS_URL' : 'DIALOG_OPEN_BITBUCKET'}
  >
    {children}
  </a>
);
