import type { FlowAction } from '@xyne/shared';

import type { FlowActionButton } from '@/src/utils/flowAction';
import type {
  FlowComponentLike,
  FlowDefinitionLike,
  FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';

/**
 * View model for the FlowJSON `ticket` artifact (packages/shared flowSchema
 * `ticketComponentSchema`). Claw emits it in two phases:
 *  - `proposed`: the approval card for `spaces-create-ticket`
 *    (`buildTicketProposalFlow`), carrying approve / approve-continue / decline
 *    submit actions and `data.actionType = 'write'`.
 *  - `created` (or no phase): the card the server swaps in after approval
 *    (`buildTicketFlow`), linking to the real ticket.
 * Mirrors apps/dashboard/src/components/flowUI/nodes/TicketNode.tsx.
 */

export type TicketStatus = 'TODO' | 'STARTED' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TicketPhase = 'proposed' | 'created';

export type TicketCardLink = {
  channelId: string;
  conversationId: string;
  ticketId: string;
  workspaceId?: string;
};

export type TicketCardViewModel = {
  phase: TicketPhase;
  idLabel: string;
  xyneId?: string;
  title: string;
  status: TicketStatus;
  statusLabel: string;
  priority: TicketPriority;
  priorityLabel: string;
  stageName?: string;
  etaLabel?: string;
  assigneeId?: string;
  buttons: FlowActionButton[];
  link?: TicketCardLink;
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  TODO: 'Todo',
  STARTED: 'Started',
  PAUSED: 'Paused',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const parseStatus = (value: unknown): TicketStatus =>
  typeof value === 'string' && value in STATUS_LABEL ? (value as TicketStatus) : 'TODO';

const parsePriority = (value: unknown): TicketPriority =>
  typeof value === 'string' && value in PRIORITY_LABEL ? (value as TicketPriority) : 'MEDIUM';

const parseAction = (value: unknown): FlowAction | null => {
  if (!isRecord(value)) return null;
  if (value['type'] !== 'submit') return null;
  const actionId = optionalString(value['actionId']);
  if (!actionId) return null;
  return value as unknown as FlowAction;
};

export const formatTicketEta = (eta: string | undefined): string | undefined => {
  if (!eta) return undefined;
  const parsed = new Date(eta);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const month = parsed.toLocaleString('en-US', { month: 'short' });
  return `${parsed.getDate()} ${month}`;
};

/** `/<workspaceId>/chat/dir/<channelId>?...` → workspaceId (see claw-auth ticket-card.ts). */
export const workspaceIdFromTicketUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  const path = url.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0] ?? '';
  const segments = path.split('/').filter(Boolean);
  const chatIndex = segments.indexOf('chat');
  if (chatIndex < 1 || segments[chatIndex + 1] !== 'dir') return undefined;
  const raw = segments[chatIndex - 1];
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export const isTicketComponent = (component: FlowComponentLike | undefined): boolean =>
  !!component && component.type === 'ticket';

/** True when the flow is a ticket artifact (proposal or created card). */
export const isTicketFlow = (flow: FlowDefinitionLike): boolean =>
  Array.isArray(flow.components) && flow.components.some(isTicketComponent);

export const createTicketCardViewModel = (
  component: FlowComponentLike,
): TicketCardViewModel | null => {
  if (component.type !== 'ticket') return null;
  const props = isRecord(component.props) ? component.props : undefined;
  const title = optionalString(props?.['title']);
  if (!props || !title) return null;

  const phase: TicketPhase = props['phase'] === 'proposed' ? 'proposed' : 'created';
  const status = parseStatus(props['status']);
  const priority = parsePriority(props['priority']);
  const xyneId = optionalString(props['xyneId']);
  const stageName = optionalString(props['stageName']);
  const etaLabel = formatTicketEta(optionalString(props['eta']));
  const assigneeId = optionalString(props['assigneeId']);
  const key = optionalString(component.id) ?? 'ticket';

  const buttons: FlowActionButton[] = [];
  if (phase === 'proposed') {
    const decline = parseAction(props['declineAction']);
    const approve = parseAction(props['approveAction']);
    const approveContinue = parseAction(props['approveContinueAction']);
    if (decline) {
      buttons.push({
        key: `${key}-decline`,
        label: 'Decline',
        variant: 'secondary',
        action: decline,
      });
    }
    if (approve) {
      buttons.push({
        key: `${key}-approve`,
        label: 'Approve',
        variant: approveContinue ? 'secondary' : 'primary',
        action: approve,
      });
    }
    if (approveContinue) {
      buttons.push({
        key: `${key}-approve-continue`,
        label: 'Accept & start task',
        variant: 'primary',
        action: approveContinue,
      });
    }
  }

  const ticketId = optionalString(props['ticketId']);
  const channelId = optionalString(props['channelId']);
  const conversationId = optionalString(props['conversationId']);
  const workspaceId = workspaceIdFromTicketUrl(optionalString(props['url']));
  const link: TicketCardLink | undefined =
    phase === 'created' && ticketId && channelId && conversationId
      ? { ticketId, channelId, conversationId, ...(workspaceId ? { workspaceId } : {}) }
      : undefined;

  return {
    phase,
    idLabel: xyneId ?? (phase === 'proposed' ? 'Draft' : 'Ticket'),
    ...(xyneId ? { xyneId } : {}),
    title,
    status,
    statusLabel: STATUS_LABEL[status],
    priority,
    priorityLabel: PRIORITY_LABEL[priority],
    ...(stageName ? { stageName } : {}),
    ...(etaLabel ? { etaLabel } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    buttons,
    ...(link ? { link } : {}),
  };
};

/** Plain-text/markdown form used for chat previews, copy and notifications. */
export const ticketComponentToMarkdown = (
  component: FlowComponentLike,
  _options: FlowTextNormalizationOptions = {},
): string => {
  const viewModel = createTicketCardViewModel(component);
  if (!viewModel) return '';
  const heading =
    viewModel.phase === 'proposed'
      ? `**Ticket draft** · awaiting approval`
      : `**${viewModel.idLabel}** · ticket created`;
  const meta = [
    viewModel.statusLabel,
    `${viewModel.priorityLabel} priority`,
    viewModel.etaLabel ? `Due ${viewModel.etaLabel}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return [heading, viewModel.title, meta].join('\n\n');
};
