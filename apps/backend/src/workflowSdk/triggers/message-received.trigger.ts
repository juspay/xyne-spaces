// MESSAGE_RECEIVED trigger for the v2 workflow engine.
//
// Fires when a message is posted in a space/channel. The host dispatches the
// event (see dispatchMessageReceived in ../events.ts); the runtime then matches
// it against every ACTIVE workflow whose trigger type is MESSAGE_RECEIVED,
// applies matchFilters(), and enqueues one execution per match.

import { z } from 'zod';
import { EventTrigger, TriggerCategory } from '@xyne/workflow-sdk';
import { db } from '@/database/client';

export const MESSAGE_RECEIVED_EVENT = 'MESSAGE_RECEIVED';

const ConfigSchema = z.object({
  /** Restrict to specific spaces/channels. Leave empty to run in every space. */
  channelIds: z.array(z.string()).optional(),
});

const OutputSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  channelId: z.string(),
  channelName: z.string().nullable(),
  authorId: z.string(),
  authorName: z.string().nullable(),
  content: z.string(),
});

export class MessageReceivedTrigger extends EventTrigger<typeof ConfigSchema> {
  readonly type = MESSAGE_RECEIVED_EVENT;
  readonly configSchema = ConfigSchema;
  readonly outputSchema = OutputSchema;
  readonly name = 'Message received';
  readonly description = 'Runs when a message is posted in a space.';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'MessageSquare';

  /**
   * Turn the dispatcher's id-only payload into the values steps read. The
   * runtime calls this only for workflows that listen for MESSAGE_RECEIVED, so
   * a workspace not using them does no work here.
   *
   * `isHuman` is used by matchFilters below (which runs after this) and is not
   * part of the output schema — it is a routing decision, not workflow data.
   */
  async hydratePayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const messageId = String(payload['messageId'] ?? '');
    const authorId = String(payload['authorId'] ?? '');

    const [row, author] = await Promise.all([
      db.message.findUnique({ where: { messageId }, select: { content: true } }).catch(() => null),
      db.user
        .findUnique({ where: { id: authorId }, select: { name: true, userType: true } })
        .catch(() => null),
    ]);

    return {
      ...payload,
      authorName: author?.name ?? null,
      content: row?.content ?? '',
      // Unknown author counts as non-human: safer to skip than to risk a loop.
      isHuman: author?.userType === 'USER' && payload['msgType'] === 'USER',
    };
  }

  matchFilters(filter: Record<string, unknown>, payload: Record<string, unknown>): boolean {
    // Only human messages fire workflows. NOT a configurable option: a reply
    // workflow posts a message, which would re-trigger the same workflow and
    // reply again forever. This is the loop guard, so it is unconditional.
    if (payload['isHuman'] !== true) return false;

    const channelIds = filter['channelIds'] as string[] | undefined;
    if (channelIds?.length) return channelIds.includes(String(payload['channelId']));

    return true;
  }
}
