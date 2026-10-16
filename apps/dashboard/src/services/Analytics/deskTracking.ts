import { globalClickTracker } from './globalClickTracker';
import { ticketTrackingMetadata, type TrackableTicket } from './ticketTracking';

/**
 * Desk-only dimensions layered on top of the ticket helper. Everything is
 * optional: the inbox row has the ticket and the mailbox overlay, the detail
 * view also has the emails, the draft and the label mappings, and the
 * composer has only what its host passed down.
 */
export interface DeskTrackingContext {
  /** EmailChannelPreference.deskType — EMAIL · DL · SLACK · APP · CALL · SOCIAL_MEDIA. */
  deskType?: string | null | undefined;
  /** Per-user TicketUserMailbox overlay; absent means INBOX / not starred. */
  mailbox?:
    | { state?: string | null | undefined; starred?: boolean | null | undefined }
    | null
    | undefined;
  /** EmailDraft row for the conversation, for the auto-draft flags. */
  draft?: { autoDraftStatus?: string | null | undefined } | null | undefined;
  /** Loaded emails, when the thread is on screen. Overrides ticket.emailCount. */
  emailCount?: number | null | undefined;
  /** Ticket.lastEmailAt. */
  lastEmailAt?: number | string | Date | null | undefined;
  /** Ticket.firstRespondedAt. */
  firstRespondedAt?: number | string | Date | null | undefined;
  /** Unread state from EmailRead / the list row. */
  isUnread?: boolean | null | undefined;
  /** classificationData.isManualOverride. */
  isManualOverride?: boolean | null | undefined;
  /** Ticket.aiSubCategory. */
  aiSubCategory?: string | null | undefined;
  /** Whether any TicketReferenceRelation.MERGED_INTO reference exists. */
  isMerged?: boolean | null | undefined;
  /** ConversationLabelMapping count. */
  labelCount?: number | null | undefined;
}

const HOUR_MS = 3_600_000;

function toMs(value: number | string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Coarse thread-length dimension. */
export function emailCountBucket(count: number): '0' | '1' | '2-5' | '6-20' | '20+' {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  return '20+';
}

/**
 * Desk ticket dimensions for `data-track-metadata` / `trackManualEvent`.
 *
 * Ids, enums, booleans, counts and buckets only. Subjects, bodies, addresses,
 * recipient names, label names and draft text never enter the event store.
 */
export function deskTicketTrackingMetadata(
  ticket:
    | (TrackableTicket & {
        emailCount?: number | null;
        lastEmailAt?: number | string | Date | null;
        firstRespondedAt?: number | string | Date | null;
        aiSubCategory?: string | null;
      })
    | null
    | undefined,
  ctx: DeskTrackingContext = {},
): Record<string, unknown> {
  const base = ticketTrackingMetadata(ticket);
  const emailCount = ctx.emailCount ?? ticket?.emailCount ?? null;
  const lastEmailMs = toMs(ctx.lastEmailAt ?? ticket?.lastEmailAt);
  const firstResponded = ctx.firstRespondedAt ?? ticket?.firstRespondedAt;
  const aiSubCategory = ctx.aiSubCategory ?? ticket?.aiSubCategory;
  return {
    ...base,
    ...(ctx.deskType && { deskType: ctx.deskType }),
    ...(ctx.mailbox !== undefined && {
      mailboxState: ctx.mailbox?.state ?? 'INBOX',
      starred: !!ctx.mailbox?.starred,
    }),
    ...(typeof emailCount === 'number' && { emailCountBucket: emailCountBucket(emailCount) }),
    ...(firstResponded !== undefined && { hasFirstResponse: !!firstResponded }),
    ...(lastEmailMs !== null && {
      hoursSinceLastEmail: Math.max(0, Math.round((Date.now() - lastEmailMs) / HOUR_MS)),
    }),
    ...(typeof ctx.isUnread === 'boolean' && { isUnread: ctx.isUnread }),
    ...(ctx.draft !== undefined && {
      hasAiDraft: ctx.draft?.autoDraftStatus === 'READY',
      aiDraftGenerating: ctx.draft?.autoDraftStatus === 'GENERATING',
    }),
    ...(aiSubCategory && { aiSubCategory }),
    ...(typeof ctx.isManualOverride === 'boolean' && { isManualOverride: ctx.isManualOverride }),
    ...(typeof ctx.isMerged === 'boolean' && { isMerged: ctx.isMerged }),
    ...(typeof ctx.labelCount === 'number' && { labelCount: ctx.labelCount }),
  };
}

/**
 * One id per composer mount so COMPOSER_OPENED, AUTO_DRAFT_SHOWN, the AIDraft
 * run events, SEND_EMAIL_* and COMPOSER_ABANDONED join exactly, even when a
 * compose modal and a reply composer are open on the same ticket at once.
 */
export function newComposerSessionId(): string {
  // A correlation key, not a secret — but Math.random() trips CodeQL on every
  // event the id flows into, so the fallback uses the CSPRNG too. No crypto at
  // all (never the case in the browsers we ship to) degrades to a timestamp.
  // Typed as possibly-undefined so the runtime checks below don't narrow to
  // `never` (lib.dom declares both methods as always present).
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  let rnd: string;
  if (c && typeof c.randomUUID === 'function') {
    rnd = c.randomUUID();
  } else if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    rnd = `${Date.now().toString(36)}-${hex}`;
  } else {
    rnd = `${Date.now().toString(36)}-no-crypto`;
  }
  return `cs-${rnd}`;
}

/**
 * What happened to the AI draft before the email went out. The only
 * dimension that answers "did the auto-draft feature write this reply".
 */
export type AiDraftState =
  | 'none'
  | 'accepted_unedited'
  | 'accepted_edited'
  | 'rejected'
  | 'auto_unedited'
  | 'auto_edited';

/**
 * ±5% of the inserted length counts as unedited: signature append, a trailing
 * newline and citation-mark stripping all move the length a little without
 * anyone having touched the text.
 */
export function resolveAiDraftState(args: {
  acceptedLength: number | null;
  rejected: boolean;
  hadAutoDraft: boolean;
  autoDraftLength: number | null;
  sentLength: number;
}): AiDraftState {
  const unedited = (reference: number): boolean =>
    reference > 0 && Math.abs(args.sentLength - reference) / reference <= 0.05;
  if (args.acceptedLength !== null) {
    return unedited(args.acceptedLength) ? 'accepted_unedited' : 'accepted_edited';
  }
  if (args.rejected) return 'rejected';
  if (args.hadAutoDraft && args.autoDraftLength !== null) {
    return unedited(args.autoDraftLength) ? 'auto_unedited' : 'auto_edited';
  }
  return 'none';
}

/** Which UI a desk triage change was made from. */
export type DeskChangeSurface =
  | 'detail'
  | 'row_chip'
  | 'bulk'
  | 'picker'
  | 'sidebar'
  | 'auto_rule'
  | 'desk_detail';

/**
 * Outcome event after a desk mutation resolved. Success only — the click that
 * asked for it is already captured by the element's own `data-track-*`.
 * Names deliberately differ from the server's ActivityType values
 * (EMAIL_SENT, TICKET_CREATED, CSAT_RECEIVED) so nothing double-counts.
 */
export function trackDeskOutcome(
  eventName:
    | 'MAILBOX_STATE_CHANGED'
    | 'TICKET_STARRED'
    | 'READ_STATE_CHANGED'
    | 'LABEL_APPLIED'
    | 'LABEL_REMOVED'
    | 'TICKETS_MERGED'
    | 'EMAIL_DEMERGED'
    | 'EMAIL_SUMMARY_GENERATED'
    | 'EMAIL_SUMMARY_FAILED'
    | 'SEND_EMAIL_SUCCEEDED'
    | 'SEND_EMAIL_FAILED'
    | 'COMPOSER_OPENED'
    | 'COMPOSER_ABANDONED'
    | 'SUBJECT_SUGGESTED',
  ticket: Parameters<typeof deskTicketTrackingMetadata>[0],
  ctx: DeskTrackingContext,
  extra: Record<string, unknown>,
): void {
  globalClickTracker.trackManualEvent('Support', eventName, undefined, {
    ...deskTicketTrackingMetadata(ticket, ctx),
    ...extra,
  });
}

// ── Arrival timestamps ────────────────────────────────────────────────────────
// SUPPORT_LIST_VIEWED and SUPPORT_TICKET_VIEWED stamp these so later funnel
// rows (ticket open → reply sent) can carry a duration without a shared store.
let deskListViewedAt: number | null = null;
const deskTicketViewedAt = new Map<string, number>();

export function markDeskListViewed(): void {
  deskListViewedAt = Date.now();
}

export function msSinceDeskListViewed(): number | null {
  return deskListViewedAt === null ? null : Date.now() - deskListViewedAt;
}

export function markDeskTicketViewed(ticketId: string): void {
  deskTicketViewedAt.set(ticketId, Date.now());
}

export function msSinceDeskTicketViewed(ticketId: string | null | undefined): number | null {
  if (!ticketId) return null;
  const at = deskTicketViewedAt.get(ticketId);
  return at === undefined ? null : Date.now() - at;
}
