import type { ActionArea } from '../core/action.js';

/** Messages: sending, posting, and finding them. Describe only what exists: the intent model reads it. */
export const MESSAGING = {
  id: 'messaging',
  description:
    'Messages: a direct message to a person, a post in an existing channel (with @mentions of people or agents), or finding past messages and threads by what they were about.',
  actions: [
    {
      id: 'send_dm',
      title: 'Send a direct message',
      intent: {
        description:
          'Send a direct message with new words the user says to one named person or app, starting the DM if needed.',
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
          {
            when: 'forwarding or sharing a message that already exists ("forward this message to …", "share that with …"); "this message" is not the words to send',
            instead: 'that is a forward, which copies the existing message',
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
            'the exact words to send, without the request around them and never the name of who it goes to ("tell Priya hi" → "hi")',
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
    {
      id: 'post_message',
      title: 'Post in a channel',
      intent: {
        description:
          'Post a message in an existing channel, or in the one open on screen ("here"), optionally @mentioning people or agents.',
        examples: [
          'Post in general that the build is green',
          'Go to the release channel and mention the on-call agent to check the logs',
          'Say hello here',
          'Tell the design channel that the review moved to 3',
          'Open the general channel and mention the reviewer to check the crash',
        ],
        notFor: [
          {
            when: 'messaging one person directly',
            instead: 'that is a direct message',
          },
          {
            when: 'creating a new channel',
            instead: 'that creates the channel first',
          },
        ],
      },
      effect: 'send',
      fields: {
        channel: {
          kind: 'channel',
          required: true,
          ask: 'Which channel should I post in?',
          describe:
            'the name of the existing channel to post in, like “general” or “design review”, or “here” for the one on screen',
        },
        mentions: {
          kind: 'person',
          many: true,
          required: false,
          ask: 'Who should I mention?',
          describe: 'the people or agents to @mention in the message',
        },
        message: {
          kind: 'text',
          required: true,
          ask: 'What should I post[ in {channel}]?',
          describe:
            'the exact words to post: never the channel’s name, “here”, or the names being mentioned (“mention Priya to check the logs” → “check the logs”)',
        },
      },
      summarize: 'Post “{message}” in {channel}[ mentioning {mentions}]',
      plan: [
        { op: 'send_message', target: '$channel', text: '$message', mentions: '$mentions' },
        { op: 'navigate', target: '$channel' },
      ],
      done: 'Posted in {channel}.',
    },
    {
      id: 'find_conversation',
      title: 'Find a conversation',
      intent: {
        description:
          'Find past messages or a thread by what they were about, and open it. The user remembers the topic, not where it is.',
        examples: [
          'Find the messages where we discussed the launch',
          'Open the thread about the release plan',
          'Where did we talk about login errors?',
          'Show me the conversation about mobile performance',
        ],
        notFor: [
          {
            when: 'opening a channel by its name',
            instead: 'that opens the channel',
          },
          {
            when: 'asking for an answer, a summary, or a decision from messages ("what did we decide about …")',
            instead: 'that is a question for Xyne AI',
          },
        ],
      },
      effect: 'navigate',
      fields: {
        conversation: {
          kind: 'thread',
          required: true,
          ask: 'What was the conversation about?',
          choose:
            'Here are the closest matches for “{mention}”. Tap one, or tell me who was in it or which channel.',
          describe:
            'only the topic words of what it was about, like “login errors”, never who was in it and never words like “messages” or “discussing”',
        },
        with: {
          kind: 'person',
          many: true,
          required: false,
          ask: 'Who was in it?',
          describe: 'the other people who were in the conversation, never the user themselves (“me”, “I”)',
        },
        in: {
          kind: 'channel',
          required: false,
          ask: 'Which channel was it in?',
          describe: 'the channel the conversation was in',
        },
      },
      summarize: 'Open the conversation “{conversation}”',
      plan: [{ op: 'navigate', target: '$conversation' }],
      done: 'Here it is.',
    },
  ],
} satisfies ActionArea;
