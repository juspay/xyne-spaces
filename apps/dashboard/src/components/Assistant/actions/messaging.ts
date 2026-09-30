import type { ActionArea } from './action';

export const MESSAGING = {
  id: 'messaging',
  description:
    'Messaging: starting a direct message with a person, creating a channel, and posting in a channel ("message Priya", "start a chat", "make a channel for the team", "send something in #general").',
  actions: [
    {
      id: 'start_chat',
      title: 'Start a chat',
      hint: 'Message a person directly',
      guide: [
        'Search for a person by name or email and select them.',
        'Type your message in the box at the bottom.',
        'Press Enter to send.',
      ],
      intent: {
        description: 'Start a direct message (DM) with one or more people.',
        examples: [
          'Message a teammate',
          'Start a chat with someone',
          'How do I DM a person?',
          'Send a direct message',
          'I want to chat with Priya',
          'How can I message someone privately?',
        ],
        notFor: [
          {
            when: 'posting in a channel that already exists',
            instead: 'that is post_in_channel',
          },
          {
            when: 'creating a channel for a team or topic',
            instead: 'that is create_channel',
          },
          {
            when: 'adding someone to a channel that already exists',
            instead:
              'none of these: changing who is in an existing channel is not one of these actions',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open New Message',
      plan: [{ op: 'open_page', page: 'chat_new_message' }],
      done: 'Opened New Message.',
    },
    {
      id: 'create_channel',
      title: 'Create a channel',
      hint: 'A shared space for a team or topic',
      guide: [
        'Type a Channel Name.',
        'Choose Channel Visibility: Public (anyone in the organization can join) or Private (only invited members).',
        'Click Create Channel, then add the people who should be in it.',
      ],
      intent: {
        description: 'Create a new channel, a shared conversation for a team or a topic.',
        examples: [
          'Create a channel',
          'Make a new channel for my team',
          'How do I add a channel?',
          'Set up a private channel',
          'I want a channel for the launch',
          'Start a new channel',
        ],
        notFor: [
          {
            when: 'creating a named set of people that share access',
            instead: 'that is create_user_group; a channel is a conversation, not a user group',
          },
          {
            when: 'messaging one person directly',
            instead: 'that is start_chat',
          },
          {
            when: 'sending a message in a channel that already exists',
            instead: 'that is post_in_channel',
          },
          {
            when: 'adding someone to a channel',
            instead:
              'none of these: changing who is in an existing channel is not one of these actions',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open the Create a channel form',
      plan: [{ op: 'open_dialog', dialog: 'add_channel' }],
      done: 'Opened the Create a channel form.',
    },
    {
      id: 'post_in_channel',
      title: 'Post in a channel',
      hint: 'Send a message in an existing channel',
      guide: [
        'Search for the channel by name and click it.',
        'Type your message in the box at the bottom.',
        'Press Enter to send.',
      ],
      intent: {
        description: 'Send a message in a channel that already exists.',
        examples: [
          'Post a message in a channel',
          'Send something in #general',
          'How do I write in a channel?',
          'Tell the team in their channel',
          'Announce something to a channel',
          'Where can I find channels to post in?',
        ],
        notFor: [
          {
            when: 'messaging one person directly',
            instead: 'that is start_chat',
          },
          {
            when: 'creating a new channel',
            instead: 'that is create_channel',
          },
          {
            when: 'adding someone to a channel that already exists',
            instead:
              'none of these: changing who is in an existing channel is not one of these actions',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open Browse Channels',
      plan: [{ op: 'open_page', page: 'chat_browse_channels' }],
      done: 'Opened Browse Channels.',
    },
  ],
} satisfies ActionArea;
