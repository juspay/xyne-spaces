import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { channelService } from '../../services/Chat/channelService';
import { sendConversationWithAttachments } from '../Chat/AddDmForm/useExistingDmChannel';
import { processMessageForSending } from '../Chat/ChatInput/ChatInput.utils';
import { MessageType } from '@xyne/shared';
import type { ChannelRef, PersonRef } from '@xyne/shared/assistant';
import { userToMentionResult } from '@xyne/shared/utils';
import type { AppActions } from './planRunner';
import { requireServerMutation } from './serverMutation';

/**
 * The app's own actions, as the plan runner needs them. Each one is the path the normal UI
 * uses for the same thing, so the assistant behaves exactly like the user clicking through.
 */
export function useAppActions(): AppActions {
  const zero = useZero();
  const navigate = useNavigate();

  return useMemo<AppActions>(
    () => ({
      // Same as starting a DM from the directory: the server returns the existing DM if there
      // is one, and a DM the user had closed is reopened so it shows in the sidebar again.
      openOrCreateDm: async (user): Promise<ChannelRef> => {
        const dm = await channelService.createDm({ participantIds: [user.id] });
        if (dm.isExisting) {
          await requireServerMutation(
            zero.mutate(mutators.channel.reopenDm({ channelId: dm.id, updatedAt: Date.now() })),
            'Could not reopen the existing direct message.',
          );
        }
        return { kind: 'channel', id: dm.id, name: user.name, isDirect: true };
      },

      // Same as the new-channel dialog, followed by the add-people form for the members.
      createChannel: async ({ name, visibility, members }): Promise<ChannelRef> => {
        const channel = await channelService.createChannel({
          name,
          visibility,
          topicTags: [],
          projectId: '',
        });
        if (members.length > 0) {
          const userIds = members.map(member => member.id);
          await requireServerMutation(
            zero.mutate(
              mutators.channel.addParticipants({
                channelId: channel.id,
                userIds,
                timestamp: Date.now(),
                participantIds: Object.fromEntries(userIds.map(id => [id, uuidv4()])),
                userStatusIds: Object.fromEntries(userIds.map(id => [id, uuidv4()])),
              }),
            ),
            'The channel was created, but its members could not be added.',
          );
        }
        return { kind: 'channel', id: channel.id, name: channel.name || name };
      },

      // Same as sending from the compose-DM panel: resolves once the server has the message,
      // and leaves any draft the user is typing in that conversation alone. "@Name" becomes a
      // real mention the way the composer does it, which is also what makes an agent answer.
      sendMessage: (channelId, text, mentions): Promise<void> => {
        return sendConversationWithAttachments(channelId, messageContent(text, mentions), []);
      },

      // Thread replies use the same Zero mutator as the thread composer. Passing the thread's
      // conversation id and no attachments keeps this reply isolated from any user draft.
      replyInThread: async (threadId, text, mentions): Promise<void> => {
        await requireServerMutation(
          zero.mutate(
            mutators.messages.send({
              conversationId: threadId,
              content: messageContent(text, mentions),
              type: MessageType.USER,
              showInChannel: false,
              timestamp: Date.now(),
              messageId: uuidv4(),
              attachmentIds: [],
            }),
          ),
          'Could not reply in the thread.',
        );
      },

      // Use the existing forwarding mutator so server-side membership and source access checks
      // remain authoritative. The runner waits for its server result before marking the step done.
      forwardMessage: async (messageId, channelId): Promise<void> => {
        await requireServerMutation(
          zero.mutate(
            mutators.conversations.forwardMessage({
              targetChannelId: channelId,
              originalMessageId: messageId,
              conversationId: uuidv4(),
              messageId: uuidv4(),
              timestamp: Date.now(),
              conversationParticipantId: uuidv4(),
            }),
          ),
          'Could not forward the message.',
        );
      },

      navigate: ({ channelId, threadId }): void => {
        void navigate(threadId ? `/chat/dir/${channelId}/${threadId}` : `/chat/dir/${channelId}`);
      },
    }),
    [zero, navigate],
  );
}

/** Builds composer-ready HTML, preserving real mention nodes for users and agents. */
function messageContent(text: string, mentions: readonly PersonRef[]): string {
  const said = [...mentions.map(person => `@${person.name}`), text].join(' ');
  const people = mentions.map(person => userToMentionResult(person, false));
  return processMessageForSending(plainTextToHtml(said), people);
}

/** Message bodies are HTML; the assistant's text is plain, so it is escaped first. */
function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
  return `<p>${escaped}</p>`;
}
