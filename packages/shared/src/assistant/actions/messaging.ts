import type { ActionArea } from '../core/action.js';

/** Sending words to people. Describe only what exists: the intent model reads it. */
export const MESSAGING = {
  id: 'messaging',
  description: 'Sending a message to a specific person in a direct message.',
  actions: [
    {
      id: 'send_dm',
      title: 'Send a direct message',
      intent: {
        description:
          'Send a direct message with the user’s words to one named person or app, starting the DM if needed.',
        examples: [
          'Tell Priya hi',
          'Message Arjun, I will pick it up later',
          'Create a DM with Daniel and message hello',
          'Let Sam know the build is green',
          'Message Ask AI that this ticket needs to be done',
        ],
        notFor: [
          {
            when: 'posting in a thread, a channel, or the conversation on screen ("in that thread", "in the design channel", "#design", "here")',
            instead: 'that is a post in that conversation',
          },
          {
            when: 'opening a DM without saying what to send ("open my DM with Priya")',
            instead: 'that only opens the conversation',
          },
        ],
      },
      effect: 'send',
      fields: {
        recipient: {
          kind: 'person',
          required: true,
          ask: 'Who should I message?',
          describe: 'the one person or app the message goes to',
        },
        message: {
          kind: 'text',
          required: true,
          ask: 'What should I say[ to {recipient}]?',
          describe:
            'the exact words to send, without the request around them ("tell Priya hi" → "hi")',
        },
      },
      summarize: 'Send “{message}” to {recipient}',
      plan: [
        { op: 'open_or_create_dm', user: '$recipient' },
        { op: 'send_message', target: { fromStep: 0 }, text: '$message' },
        { op: 'navigate', target: { fromStep: 0 } },
      ],
      done: 'Sent to {recipient}.',
    },
  ],
} satisfies ActionArea;
