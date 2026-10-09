import {
  buildPollMessageSummary,
  MessageType,
  type PollDraft,
  type PollSchedule,
} from '@xyne/shared';
import type { ConversationRef } from '@xyne/shared/messages';

type ScheduledPollInput = {
  id: string;
  channelId: string;
  content: string;
  poll: PollDraft;
  pollSchedule: PollSchedule;
  scheduledFor: number;
  timestamp: number;
};

type ImmediatePollPayload = {
  content: string;
  type: MessageType;
  messageId: string;
  conversationId: string;
  timestamp: number;
  poll: PollDraft;
  pollSchedule: PollSchedule;
};

type PublishPollDependencies = {
  createId: () => string;
  schedule: (input: ScheduledPollInput) => Promise<unknown>;
  send: (ref: ConversationRef, payload: ImmediatePollPayload) => unknown;
};

export async function publishPollToChannel(
  input: { poll: PollDraft; pollSchedule: PollSchedule; channelId: string; timestamp?: number },
  dependencies: PublishPollDependencies,
): Promise<void> {
  const timestamp = input.timestamp ?? Date.now();
  const content = buildPollMessageSummary(input.poll);

  if (input.pollSchedule.publishAt) {
    await dependencies.schedule({
      id: dependencies.createId(),
      channelId: input.channelId,
      content,
      poll: input.poll,
      pollSchedule: input.pollSchedule,
      scheduledFor: Date.parse(input.pollSchedule.publishAt),
      timestamp,
    });
    return;
  }

  await dependencies.send(
    { kind: 'channel', channelId: input.channelId },
    {
      content,
      type: MessageType.USER,
      messageId: dependencies.createId(),
      conversationId: dependencies.createId(),
      timestamp,
      poll: input.poll,
      pollSchedule: input.pollSchedule,
    },
  );
}
