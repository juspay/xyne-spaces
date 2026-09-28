import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { channelService } from '../../services/Chat/channelService';
import { sendConversationWithAttachments } from '../Chat/AddDmForm/useExistingDmChannel';
import { processMessageForSending } from '../Chat/ChatInput/ChatInput.utils';
import type { ChannelRef } from '@xyne/shared/assistant';
import { userToMentionResult } from '@xyne/shared/utils';
import type { AppActions } from './planRunner';

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
          void zero.mutate(mutators.channel.reopenDm({ channelId: dm.id, updatedAt: Date.now() }));
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
          void zero.mutate(
            mutators.channel.addParticipants({
              channelId: channel.id,
              userIds,
              timestamp: Date.now(),
              participantIds: Object.fromEntries(userIds.map(id => [id, uuidv4()])),
              userStatusIds: Object.fromEntries(userIds.map(id => [id, uuidv4()])),
            }),
          );
        }
        return { kind: 'channel', id: channel.id, name: channel.name || name };
      },

      // Same as sending from the compose-DM panel: resolves once the server has the message,
      // and leaves any draft the user is typing in that conversation alone. "@Name" becomes a
      // real mention the way the composer does it, which is also what makes an agent answer.
      sendMessage: (channelId, text, mentions): Promise<void> => {
        const said = [...mentions.map(person => `@${person.name}`), text].join(' ');
        const people = mentions.map(person => userToMentionResult(person, false));
        const html = processMessageForSending(plainTextToHtml(said), people);
        return sendConversationWithAttachments(channelId, html, []);
      },

      navigate: ({ channelId, threadId }): void => {
        void navigate(threadId ? `/chat/dir/${channelId}/${threadId}` : `/chat/dir/${channelId}`);
      },
    }),
    [zero, navigate],
  );
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
