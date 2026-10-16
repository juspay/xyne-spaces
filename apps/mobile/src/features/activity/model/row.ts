import {
  ChannelScopeType,
  getMostRecentEmoji,
  parseReactionsMd,
  parseRepliesMd,
  type Channel,
} from '@xyne/shared';

import type { ActivityWithRelated } from '@/src/types/activity';

import type { ActivityNavigationTarget } from '../presentation/activityRowAssembler';

/**
 * What the badge on the avatar says the activity is. Presentation-free: the
 * row component maps a kind to an icon and a tone, so this file stays plain
 * data that can be tested without React.
 */
export type ActivityBadgeKind =
  | 'mention'
  | 'reply'
  | 'reaction'
  | 'message'
  | 'ticket'
  | 'assignment'
  | 'eta'
  | 'call'
  | 'workflow'
  | 'canvas'
  | 'default';

/** The pill after the verb: a channel or a ticket key. */
export type ActivitySubject =
  | { readonly kind: 'channel'; readonly label: string }
  | { readonly kind: 'dm'; readonly label: string }
  | { readonly kind: 'ticket'; readonly label: string };

/** The slice of a message attachment the grid needs; mirrors `MessageAttachment`. */
export type ActivityAttachment = {
  readonly id: string;
  readonly mimetype: string;
  readonly originalFilename?: string;
  readonly size?: number;
  readonly metadata?: { duration?: number } | null;
};

export type ActivityBody =
  /**
   * A chat message: rich text, then its attachments. `content` is the raw
   * message HTML and may be empty when the message is only attachments.
   */
  | {
      readonly kind: 'message';
      readonly content: string;
      readonly senderId: string;
      readonly conversationId: string;
      readonly attachments: readonly ActivityAttachment[];
    }
  /** A sentence the app composed. */
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'none' };

export type ActivityTarget =
  | ActivityNavigationTarget
  | { readonly kind: 'calls' }
  | {
      readonly kind: 'canvas';
      readonly canvasId: string;
      readonly channelId?: string | undefined;
      readonly blockId?: string | undefined;
    };

/**
 * One feed row, flattened to what is drawn.
 *
 * Plain strings and numbers on purpose. The classic row held the whole Zero
 * result and resolved the actor, channel and description inside React; this
 * resolves them once, off the render path, so a row slot subscribes to a
 * primitive instead of a relation graph.
 */
export type ActivityRowData = {
  readonly id: string;
  readonly isUnread: boolean;
  readonly actorId: string;
  readonly actorName: string;
  readonly verb: string;
  readonly subject: ActivitySubject | null;
  readonly timeMs: number;
  readonly badge: ActivityBadgeKind;
  /** Only for `badge: 'reaction'`, the emoji name to draw in the badge. */
  readonly reactionEmoji: string | null;
  readonly body: ActivityBody;
  readonly target: ActivityTarget;
};

type ActivityUser = {
  id: string;
  name?: string;
  displayName?: string | null;
  email?: string | null;
};

export type ActivityRowContext = {
  currentUserId: string;
  users: readonly ActivityUser[];
  usersById: ReadonlyMap<string, ActivityUser>;
  channelsById: ReadonlyMap<string, Channel>;
  /**
   * The two lookups that need the app's navigation and channel-naming
   * modules, injected so this file stays plain data and logic that runs under
   * the unit-test runner without the native stack.
   */
  channelLabel: (channel: Channel) => string;
  navigationTarget: (activity: ActivityWithRelated) => ActivityNavigationTarget;
};

type Described = {
  badge: ActivityBadgeKind;
  verb: string;
  body: ActivityBody;
  /** `undefined` takes the activity's channel; `null` shows no pill. */
  subject?: ActivitySubject | null;
  actorId?: string;
  actorName?: string;
  target?: ActivityTarget;
  reactionEmoji?: string;
};

const NONE: ActivityBody = { kind: 'none' };

const text = (value: string): ActivityBody => ({ kind: 'text', text: value });

const NO_ATTACHMENTS: readonly ActivityAttachment[] = [];

function messageBody(activity: ActivityWithRelated): ActivityBody | null {
  const message = activity.message;
  if (!message || !message.conversation) return null;

  const attachments = message.attachments;
  return {
    kind: 'message',
    content: message.content ?? '',
    senderId: message.senderId,
    conversationId: message.conversation.conversationId,
    attachments:
      attachments && attachments.length > 0
        ? attachments.map(a => ({
            id: a.id,
            mimetype: a.mimetype ?? 'application/octet-stream',
            ...(a.originalFilename ? { originalFilename: a.originalFilename } : {}),
            ...(a.size !== null && a.size !== undefined ? { size: a.size } : {}),
            ...(a.metadata ? { metadata: a.metadata as { duration?: number } } : {}),
          }))
        : NO_ATTACHMENTS,
  };
}

function pluralOthers(count: number): string {
  return count === 2 ? 'and 1 other' : `and ${count - 1} others`;
}

function describeMention(activity: ActivityWithRelated): Described | null {
  if (activity.actorAction === 'mentioned_user' && activity.canvasId) {
    if (!activity.canvas) return null;
    const channelId = activity.channelId ?? undefined;
    return {
      badge: 'canvas',
      verb: 'mentioned',
      subject: null,
      actorId: activity.actorId ?? activity.canvas.lastEditedBy ?? '',
      body: text(`Canvas: ${activity.canvas.title ?? 'Untitled'}`),
      target: {
        kind: 'canvas',
        canvasId: activity.canvasId,
        channelId,
        blockId: activity.blockId ?? undefined,
      },
    };
  }

  const body = messageBody(activity);
  return body ? { badge: 'mention', verb: 'mentioned', body } : null;
}

function describeDirectMessage(activity: ActivityWithRelated): Described | null {
  const body = messageBody(activity);
  return body ? { badge: 'message', verb: 'sent you a message in', body } : null;
}

function describeReply(activity: ActivityWithRelated): Described | null {
  const body = messageBody(activity);
  if (!body) return null;

  // The v1 shape carries no reply roll-up; it is only ever "replied in".
  if (activity.actorAction === 'replied') {
    return { badge: 'reply', verb: 'replied in', body };
  }

  const conversation = activity.message?.conversation;
  if (!conversation) return null;
  const { repliers } = parseRepliesMd(conversation.replies_md);
  if (repliers.length === 0) return null;

  const recipientId = activity.userId;
  const isThreadStarter = conversation.createdBy === recipientId;
  const recipientIndex = recipientId ? repliers.indexOf(recipientId) : -1;
  const isRecipientOwner = isThreadStarter || recipientIndex >= 0;
  const after = isThreadStarter
    ? repliers
    : repliers.slice(recipientIndex >= 0 ? recipientIndex + 1 : 0);
  const unique = new Set(after);
  if (recipientId) unique.delete(recipientId);

  // const lead = unique.size <= 1 ? '' : `${pluralOthers(unique.size)} `;
  // const verb = isRecipientOwner
  //   ? `${lead}replied on your message in`
  //   : `${lead}replied in a thread you're following in`;
  const verb = isRecipientOwner ? `replied` : `replied`;
  return { badge: 'reply', verb, body };
}

function describeReaction(activity: ActivityWithRelated): Described | null {
  const body = messageBody(activity);
  if (!body) return null;

  if (activity.actorAction === 'added' || activity.actorAction === 'removed') {
    const reaction = activity.reaction;
    if (!reaction || !reaction.userId) return null;
    return {
      badge: 'reaction',
      verb:
        activity.actorAction === 'added' ? 'reacted' : 'removed a reaction from your message in',
      actorId: reaction.userId,
      reactionEmoji: reaction.emojiName,
      body,
    };
  }

  const reactions = parseReactionsMd(activity.message?.reactions_md);
  const latest = getMostRecentEmoji(reactions);
  if (!latest) return null;

  const reactors = new Set(Object.values(reactions).flat());
  if (activity.userId) reactors.delete(activity.userId);

  let verb: string;
  if (activity.actorAction === 'removed_v2') verb = 'removed a reaction from your message in';
  else if (reactors.size <= 1) verb = 'reacted';
  else verb = `${pluralOthers(reactors.size)} reacted`;

  return { badge: 'reaction', verb, reactionEmoji: latest, body };
}

type TicketUpdate = { verb: string; label: string };

const TICKET_UPDATES: ReadonlyMap<string, TicketUpdate> = new Map<string, TicketUpdate>([
  ['ticket_status', { verb: 'updated the status of', label: 'Status' }],
  ['ticket_eta', { verb: 'updated the due date of', label: 'Due Date' }],
  ['ticket_board', { verb: 'moved to another board', label: 'Board' }],
  ['ticket_assigned_to', { verb: 'changed the assignee of', label: 'Assignee' }],
  ['ticket_pr_created', { verb: 'raised a PR for', label: 'PR Raised' }],
  ['ticket_pr_updated', { verb: 'updated a PR for', label: 'PR Updated' }],
  ['ticket_pr_merged', { verb: 'merged a PR for', label: 'PR Merged' }],
  ['ticket_pr_declined', { verb: 'declined a PR for', label: 'PR Declined' }],
  [
    'ticket_pr_reviewer_assigned',
    { verb: 'assigned you as PR reviewer for', label: 'PR Reviewer' },
  ],
  ['ticket_qa_assigned', { verb: 'assigned you as QA for', label: 'QA Assigned' }],
]);

const FALLBACK_TICKET_UPDATE: TicketUpdate = { verb: 'updated', label: 'Ticket' };

function ticketKey(activity: ActivityWithRelated): string {
  return activity.ticket?.xyneId ?? activity.ticketId ?? activity.actionSourceId ?? '';
}

function ticketSubject(activity: ActivityWithRelated): ActivitySubject | null {
  const key = ticketKey(activity);
  return key ? { kind: 'ticket', label: key } : null;
}

function ticketActivityTarget(activity: ActivityWithRelated): ActivityTarget | undefined {
  const ticketId = activity.ticketId ?? activity.actionSourceId ?? activity.ticket?.id;
  return ticketId ? { kind: 'ticket', ticketId, selectedTab: 'activity' } : undefined;
}

function systemActor(activity: ActivityWithRelated): Pick<Described, 'actorId' | 'actorName'> {
  return activity.actorId
    ? { actorId: activity.actorId }
    : { actorId: 'system', actorName: 'Xyne' };
}

function describeTicketUpdate(activity: ActivityWithRelated): Described | null {
  const ticket = activity.ticket;
  if (!ticket) return null;

  const update = TICKET_UPDATES.get(activity.actorAction) ?? FALLBACK_TICKET_UPDATE;
  const isPr = activity.actorAction.startsWith('ticket_pr_');
  const sentence = isPr ? update.label.toLowerCase() : `${update.label} updated`;
  const target = ticketActivityTarget(activity);

  return {
    badge: 'ticket',
    verb: update.verb,
    subject: ticketSubject(activity),
    body: text(`${sentence} for ticket “${ticket.title}”`),
    ...systemActor(activity),
    ...(target ? { target } : {}),
  };
}

function describeTicketAssigned(
  activity: ActivityWithRelated,
  ctx: ActivityRowContext,
): Described | null {
  const ticket = activity.ticket;
  if (!ticket) return null;

  const isRecipient = ticket.assignedTo === activity.userId;
  const assignee = ticket.assignedTo ? ctx.usersById.get(ticket.assignedTo) : undefined;
  const assigneeName = assignee?.name ?? 'Unknown';
  const target = ticketActivityTarget(activity);

  return {
    badge: 'assignment' as const,
    verb: isRecipient ? 'assigned you to' : 'changed the assignee of',
    subject: ticketSubject(activity),
    body: text(
      isRecipient
        ? `You have been assigned to ticket “${ticket.title}”`
        : `${assigneeName} has been assigned to ticket “${ticket.title}”`,
    ),
    ...systemActor(activity),
    ...(target ? { target } : {}),
  };
}

function describeEta(activity: ActivityWithRelated): Described | null {
  const action = activity.actorAction;
  const key = ticketKey(activity);
  const stageName = activity.ticket?.stageName ?? '';

  let sentence: string;
  if (action === 'eta_warning') {
    sentence = `Ticket ${key} is due today. Please ensure it's completed or updated.`;
  } else if (action === 'stage_eta_breach') {
    sentence = `Ticket ${key} stage “${stageName}” is overdue. Please update the status or its deadline.`;
  } else {
    sentence = `Ticket ${key} is overdue. Please update the ticket's status or ETA.`;
  }

  const channelId = activity.channelId ?? activity.ticket?.channelId;
  return {
    badge: 'eta',
    verb: action === 'eta_warning' ? 'flagged a due date on' : 'flagged an overdue',
    subject: ticketSubject(activity),
    actorId: 'system',
    actorName: 'Xyne',
    body: text(sentence),
    ...(channelId ? { target: { kind: 'channel', channelId } as const } : {}),
  };
}

type CallCopy = { verb: string; body: string };

const CALL_COPY: ReadonlyMap<string, CallCopy> = new Map<string, CallCopy>([
  [
    'call_reminder',
    {
      verb: 'reminded you about a call in',
      body: 'Your call is starting in 10 min',
    },
  ],
  ['call_updated', { verb: 'updated a call in', body: 'A scheduled call was updated' }],
  [
    'meeting_accepted',
    {
      verb: 'accepted your invite in',
      body: 'Accepted your meeting invitation',
    },
  ],
  [
    'meeting_declined',
    {
      verb: 'declined your invite in',
      body: 'Declined your meeting invitation',
    },
  ],
  ['scheduled_call', { verb: 'scheduled a call in', body: 'You have a new scheduled call' }],
]);

const FALLBACK_CALL_COPY: CallCopy = {
  verb: 'scheduled a call in',
  body: 'You have a new scheduled call',
};

function describeCall(activity: ActivityWithRelated): Described {
  const copy = CALL_COPY.get(activity.actorAction) ?? FALLBACK_CALL_COPY;
  return {
    badge: 'call',
    verb: copy.verb,
    body: text(copy.body),
    target: { kind: 'calls' },
    ...systemActor(activity),
  };
}

function describeWorkflowQuestion(activity: ActivityWithRelated): Described {
  const ticket = activity.ticket;
  const detail = ticket?.title
    ? ` Ticket: ${ticket.xyneId ? `${ticket.xyneId} — ` : ''}${ticket.title}`
    : '';
  return {
    badge: 'workflow',
    verb: 'asked',
    subject: ticketSubject(activity),
    body: text(`A workflow needs your input to continue.${detail}`),
    ...systemActor(activity),
  };
}

function describeAssignmentPause(
  activity: ActivityWithRelated,
  ctx: ActivityRowContext,
): Described | null {
  const userId = activity.actionSourceId ?? '';
  const user = ctx.usersById.get(userId);
  if (!user) return null;

  const name = user.name ?? user.email ?? 'Unknown';
  const isPaused = activity.actorAction === 'paused_from_assignment';
  return {
    badge: 'assignment',
    verb: isPaused ? 'paused ticket assignment' : 'resumed ticket assignment',
    subject: null,
    actorId: userId,
    actorName: name,
    body: text(
      isPaused
        ? `${name} has paused from ticket assignment`
        : `${name} has resumed from ticket assignment`,
    ),
  };
}

/**
 * One describer per `actorAction`.
 *
 * A table rather than a component per action: what differs between a mention
 * and a ticket update is a badge, a verb and a body, not a layout. Adding an
 * activity type is one entry here and, if it has a new look, one badge tone in
 * the row.
 */
type Describer = (activity: ActivityWithRelated, ctx: ActivityRowContext) => Described | null;

const TICKET_UPDATE_ACTIONS = [...TICKET_UPDATES.keys()];
const CALL_ACTIONS = [...CALL_COPY.keys()];

const DESCRIBERS: ReadonlyMap<string, Describer> = new Map<string, Describer>([
  ['mentioned_user', describeMention],
  ['group_mention', describeMention],
  ['direct_message', describeDirectMessage],
  ['replied', describeReply],
  ['replied_v2', describeReply],
  ['added', describeReaction],
  ['added_v2', describeReaction],
  ['removed', describeReaction],
  ['removed_v2', describeReaction],
  ...TICKET_UPDATE_ACTIONS.map((action): [string, Describer] => [action, describeTicketUpdate]),
  ['ticket_assigned', describeTicketAssigned],
  ['eta_warning', describeEta],
  ['eta_breach', describeEta],
  ['stage_eta_breach', describeEta],
  ...CALL_ACTIONS.map((action): [string, Describer] => [action, describeCall]),
  ['workflow_question', describeWorkflowQuestion],
  ['paused_from_assignment', describeAssignmentPause],
  ['resumed_from_assignment', describeAssignmentPause],
]);

function resolveActorName(actorId: string, hasActor: boolean, ctx: ActivityRowContext): string {
  const actor = ctx.usersById.get(actorId);
  const name = actor?.displayName || actor?.name || actor?.email;
  if (name) return name;
  return hasActor ? 'Loading…' : 'Xyne';
}

/**
 * Builds the row for one activity, or `null` when it has nothing to show — the
 * message it points at has not synced, say. The classic list rendered those as
 * zero-height rows; dropping them here keeps them out of the list entirely.
 */
export function buildActivityRow(
  activity: ActivityWithRelated,
  ctx: ActivityRowContext,
): ActivityRowData | null {
  const describe = DESCRIBERS.get(activity.actorAction);
  if (!describe) return null;
  const described = describe(activity, ctx);
  if (!described) return null;

  const actorId = described.actorId ?? activity.actorId ?? activity.message?.senderId ?? 'system';
  const actorName =
    described.actorName ?? resolveActorName(actorId, Boolean(activity.actorId), ctx);

  const channelId =
    activity.message?.conversation?.channelId ?? activity.ticket?.channelId ?? activity.channelId;
  const channel = channelId ? (ctx.channelsById.get(channelId) ?? null) : null;

  let subject: ActivitySubject | null;
  if (described.subject !== undefined) {
    subject = described.subject;
  } else if (channel && ctx.currentUserId) {
    const label = ctx.channelLabel(channel);
    subject = {
      kind: channel.scopeType === ChannelScopeType.DM ? 'dm' : 'channel',
      label,
    };
  } else {
    subject = null;
  }

  return {
    id: activity.id,
    isUnread: !activity.isRead,
    actorId,
    actorName,
    verb: described.verb,
    subject,
    timeMs: activity.updatedAt ?? activity.createdAt,
    badge: described.badge,
    reactionEmoji: described.reactionEmoji ?? null,
    body: described.body.kind === 'none' ? NONE : described.body,
    target: described.target ?? ctx.navigationTarget(activity),
  };
}

/**
 * Builds the rows for a page, remembering each by its source activity.
 *
 * Zero hands back the same object for an activity that did not change, so a
 * sync that touches one row rebuilds one row. `cache` belongs to one
 * `ActivityRowContext`: when the users or channels change the cache is
 * dropped with it, because names and labels may have moved.
 */
export function buildActivityRows(
  activities: readonly ActivityWithRelated[],
  ctx: ActivityRowContext,
  cache: WeakMap<ActivityWithRelated, ActivityRowData | null>,
): ActivityRowData[] {
  const rows: ActivityRowData[] = [];
  for (const activity of activities) {
    let row = cache.get(activity);
    if (row === undefined) {
      row = buildActivityRow(activity, ctx);
      cache.set(activity, row);
    }
    if (row !== null) rows.push(row);
  }
  return rows;
}
