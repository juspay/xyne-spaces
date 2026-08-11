/**
 * Handles the `call_start` card's two actions.
 *
 * These are handled NATIVELY rather than proxied to an app webhook, because
 * starting a call is a Spaces operation, not an agent one. The agent's job ended
 * when it proposed; execution belongs here, where the call APIs and the user's
 * permissions already live. It also means the card needs no `data-flow-appid`.
 *
 * Both actions rewrite the SAME message to a terminal phase, mirroring the
 * proposed → executing discipline in PlanNode: the card never self-transitions
 * client-side, the server is what moves it.
 *
 * See services/intentSuggestionService.ts and apps/dashboard/docs/ON_DEVICE_INTENT.md
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { livekitService } from '@/services/liveKitService';
import { callSideEffectService } from '@/services/callSideEffectService';
import {
  CallOrigin,
  CallType,
  validateFlowDefinition,
  type FlowDefinition,
} from '@xyne/shared';

export const CALL_START_ACTION_ID = 'call-start';
export const CALL_DISMISS_ACTION_ID = 'call-dismiss';

export function isIntentCallAction(actionId: string): boolean {
  return actionId === CALL_START_ACTION_ID || actionId === CALL_DISMISS_ACTION_ID;
}

interface HandleParams {
  actionId: string;
  messageId: string;
  flowJSON: FlowDefinition;
  userId: string;
  workspaceId: string;
}

/**
 * Returns the updated FlowDefinition so the caller can answer the action with an
 * `update_screen_data`, and persists the same JSON back onto the message so a
 * reload (and every other viewer) sees the terminal phase too.
 */
export async function handleIntentCallAction(
  params: HandleParams,
): Promise<{ ok: true; flowJSON: FlowDefinition } | { ok: false; error: string }> {
  const { actionId, messageId, flowJSON, userId, workspaceId } = params;

  const card = findCallStartComponent(flowJSON);
  if (!card) return { ok: false, error: 'No call_start component in flowJSON' };

  const props = card.props as { phase: string; title: string; attendees: string[] };
  if (props.phase !== 'proposed') {
    // Already resolved — a double-click or a second viewer racing the first.
    // Idempotent: hand back what is already stored rather than erroring.
    return { ok: true, flowJSON };
  }

  if (actionId === CALL_DISMISS_ACTION_ID) {
    const next = withPhase(flowJSON, card.id, {
      phase: 'dismissed',
      title: props.title,
      attendees: props.attendees,
    });
    await persist(messageId, next);
    logger.info('[intent] call suggestion dismissed', { messageId, userId });
    return { ok: true, flowJSON: next };
  }

  const started = await startCall({
    messageId,
    title: props.title,
    attendees: props.attendees,
    initiatorUserId: userId,
    workspaceId,
  });
  if (!started) return { ok: false, error: 'Failed to start call' };

  const next = withPhase(flowJSON, card.id, {
    phase: 'started',
    title: props.title,
    attendees: props.attendees,
    callId: started.callId,
    joinUrl: started.roomLink,
  });
  await persist(messageId, next);

  logger.info('[intent] call started from suggestion', {
    messageId,
    callId: started.callId,
    invited: props.attendees.length,
  });
  return { ok: true, flowJSON: next };
}

/**
 * Mirrors automations/steps/make-call.step.ts: create the LiveKit room BEFORE the
 * DB transaction so a crash can never leave an ACTIVE call row pointing at a room
 * that does not exist. A rolled-back transaction leaves an orphan room instead,
 * which expires on its own via emptyTimeout.
 */
async function startCall(input: {
  messageId: string;
  title: string;
  attendees: string[];
  initiatorUserId: string;
  workspaceId: string;
}): Promise<{ callId: string; roomLink: string } | null> {
  const message = await db.message.findUnique({
    where: { messageId: input.messageId },
    select: { conversation: { select: { channelId: true } } },
  });
  const channelId = message?.conversation?.channelId;
  if (!channelId) return null;

  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { projectId: true },
  });

  // The initiator is always invited implicitly by being the joining user; keep
  // them out of the invitee list so they are not double-counted or rung.
  const invitedUserIds = [...new Set(input.attendees)].filter(id => id !== input.initiatorUserId);

  const externalId = uuidv4();
  const callId = uuidv4();
  const conversationId = uuidv4();
  const messageId = uuidv4();
  const roomLink = `${livekitService.getClientUrl()}/call/${externalId}?type=${CallType.VIDEO}`;
  const now = new Date();

  await livekitService.createRoom({
    name: externalId,
    maxParticipants: Math.max(100, invitedUserIds.length + 1),
    emptyTimeout: 120,
    metadata: JSON.stringify({
      channelId,
      projectId: channel?.projectId,
      callOrigin: CallOrigin.CHANNEL,
      callType: CallType.VIDEO,
      createdBy: input.initiatorUserId,
      ...(invitedUserIds.length > 0 && { invitedUserIds }),
    }),
  });

  const result = await repositories.calls.createCallWithParticipantsAndMessage({
    callId,
    roomName: externalId,
    channelId,
    workspaceId: input.workspaceId,
    createdBy: input.initiatorUserId,
    callType: CallType.VIDEO,
    roomLink,
    joiningUserId: input.initiatorUserId,
    channelParticipants: invitedUserIds.map(userId => ({ userId })),
    conversationId,
    messageId,
    now,
    callOrigin: CallOrigin.CHANNEL,
  });

  // Ring everyone. Normally the LiveKit webhook does this when the first
  // participant joins; here the initiator has not entered the room yet, so a
  // ring has to be issued explicitly or nobody is notified.
  const rings = await Promise.allSettled(
    result.invitedParticipantIds.map(participantId =>
      callSideEffectService.handleParticipantInvited(participantId, { throwOnFailure: true }),
    ),
  );
  const failed = rings.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    logger.warn('[intent] some invitees could not be rung', { callId, failed });
  }

  return { callId, roomLink };
}

function findCallStartComponent(
  flow: FlowDefinition,
): { id: string; props: Record<string, unknown> } | null {
  const components = (flow as unknown as { components?: Array<Record<string, unknown>> })
    .components;
  if (!Array.isArray(components)) return null;
  const found = components.find(c => c['type'] === 'call_start');
  if (!found) return null;
  return { id: String(found['id']), props: found['props'] as Record<string, unknown> };
}

/** Replace the card's props, leaving every other component untouched. */
function withPhase(
  flow: FlowDefinition,
  componentId: string,
  props: Record<string, unknown>,
): FlowDefinition {
  const clone = JSON.parse(JSON.stringify(flow)) as unknown as {
    components: Array<Record<string, unknown>>;
  };
  clone.components = clone.components.map(c =>
    c['id'] === componentId ? { ...c, props } : c,
  );
  return clone as unknown as FlowDefinition;
}

/**
 * Persist the new phase onto the message. Validated first — a card that fails the
 * shared schema must never be written, or the renderer will drop it on reload.
 */
async function persist(messageId: string, flow: FlowDefinition): Promise<void> {
  const result = validateFlowDefinition(flow);
  if (!result.success) {
    throw new Error('Refusing to persist an invalid call_start FlowJSON');
  }
  const escaped = JSON.stringify(result.data).replace(/"/g, '&quot;');
  await repositories.messages.update(messageId, {
    content: `<div data-flow-json="${escaped}">Flow JSON</div>`,
  });
}
