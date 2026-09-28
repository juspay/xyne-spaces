import type { ActionArea } from '../core/action.js';

/** Creating and opening channels. Describe only what exists: the intent model reads it. */
export const CHANNELS = {
  id: 'channels',
  description:
    'Channels: going to or opening an existing channel ("open …", "take me to …", "go to …"), or creating a new one with its name, visibility, members, and a first message.',
  actions: [
    {
      id: 'create_channel',
      title: 'Create a channel',
      intent: {
        description:
          'Create a new channel, even when details are missing; missing details are asked for, never guessed.',
        examples: [
          'Create a channel',
          'Make a private channel for the launch team',
          'Create a public channel named Release Planning and add Priya',
          'Create a channel ABC and message hello',
          'Set up a channel called design review',
        ],
        notFor: [
          {
            when: 'opening, searching, or posting in a channel that already exists',
            instead: 'those use the existing channel',
          },
        ],
      },
      effect: 'change',
      fields: {
        name: {
          kind: 'text',
          required: true,
          ask: 'What should I name the channel?',
          describe:
            'the new channel’s name exactly as the user gave it, without "named" or "called"',
        },
        visibility: {
          kind: 'choice',
          required: true,
          ask: 'Should it be public or private?',
          options: [
            { id: 'public', label: 'Public', detail: 'Anyone in the workspace can join' },
            { id: 'private', label: 'Private', detail: 'Only invited members' },
          ],
          describe: 'public (anyone in the workspace) or private (invited members only)',
        },
        members: {
          kind: 'person',
          many: true,
          required: false,
          ask: 'Who should I add?',
          offer: 'Want to add anyone? Say their names, or say no.',
          describe: 'people to add to the channel',
        },
        firstMessage: {
          kind: 'text',
          required: false,
          ask: 'What should I post first?',
          describe:
            'a message to post in the channel right after creating it ("…and message hello" → "hello")',
        },
      },
      summarize:
        'Create a {visibility} channel named “{name}”[ with {members}][ and post “{firstMessage}”]',
      plan: [
        { op: 'create_channel', name: '$name', visibility: '$visibility', members: '$members' },
        { op: 'send_message', if: 'firstMessage', target: { fromStep: 0 }, text: '$firstMessage' },
        { op: 'navigate', target: { fromStep: 0 } },
      ],
      done: 'Created “{name}”[ and posted “{firstMessage}”]. It’s open now.',
    },
    {
      id: 'open_channel',
      title: 'Open a channel',
      intent: {
        description: 'Open an existing channel the user can access, by its name or part of it.',
        examples: ['Open the Android channel', 'Take me to release planning', 'Go to design review'],
        notFor: [
          {
            when: 'creating a new channel, or posting a message or @mentioning someone in one',
            instead: 'those are different actions, even when they say “open” or “go to” the channel',
          },
        ],
      },
      effect: 'navigate',
      fields: {
        channel: {
          kind: 'channel',
          required: true,
          ask: 'Which channel should I open?',
          describe: 'the name of the existing channel to open',
        },
      },
      summarize: 'Open {channel}',
      plan: [{ op: 'navigate', target: '$channel' }],
      done: 'Opened {channel}.',
    },
  ],
} satisfies ActionArea;
