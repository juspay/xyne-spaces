import type { ActionArea } from '../core/action.js';

/** Messages: sending, posting, and finding them. Describe only what exists: the intent model reads it. */
export const MESSAGING = {
  id: 'messaging',
  description:
    'Messages: sending or opening a direct message with a person, a post in an existing channel or a reply in a thread (with @mentions of people or agents), forwarding a message, or finding past messages and threads by what they were about.',
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
          'I want to send a message',
          'Create a DM with Daniel',
        ],
        notFor: [
          {
            when: 'posting in a thread, a channel, or the conversation on screen ("in that thread", "in the design channel", "#design", "here")',
            instead: 'that is a post in that conversation',
          },
          {
            when: 'opening a DM without saying what to send ("open my DM with Priya")',
            instead: 'that opens the DM',
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
          preserveText: true,
          required: true,
          ask: 'What should I say[ to {recipient}]?',
          describe:
            'the exact words to send, without the request around them and never the name of who it goes to ("tell Priya hi" → "hi"; "let Daniel know the meeting moved to 4" → "the meeting moved to 4"; "tell Meera Iyer the doc is ready" → "the doc is ready")',
        },
      },
      summarize: 'Send “{message}” to {recipient}',
      plan: [
        { op: 'open_or_create_dm', user: '$recipient' },
        { op: 'navigate', target: { fromStep: 0 } },
        { op: 'send_message', target: { fromStep: 0 }, text: '$message' },
      ],
      done: 'Sent to {recipient}.',
    },
    {
      id: 'open_dm',
      title: 'Open a direct message',
      intent: {
        description:
          'Open the direct message conversation with one named person or app, without sending anything.',
        examples: [
          'Open my DM with Priya',
          'Go to my chat with Daniel',
          'Show my messages with Meera',
          'Take me to my conversation with Sam',
        ],
        notFor: [
          {
            when: 'saying what to send ("tell Priya hi", "message Daniel that …")',
            instead: 'that sends a direct message',
          },
        ],
      },
      effect: 'navigate',
      fields: {
        person: {
          kind: 'person',
          required: true,
          ask: 'Whose DM should I open?',
          describe: 'the one person or app whose direct messages to open',
        },
      },
      summarize: 'Open your DM with {person}',
      plan: [
        { op: 'open_or_create_dm', user: '$person' },
        { op: 'navigate', target: { fromStep: 0 } },
      ],
      done: 'Here’s your DM with {person}.',
    },
    {
      id: 'post_message',
      title: 'Post in a channel',
      intent: {
        description:
          'Post a message in an existing channel, or in the one open on screen ("here"), optionally @mentioning people or agents.',
        examples: [
          'I want to post something',
          'Post in general that the build is green',
          'In release planning, tell everyone the release is on Friday',
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
            'the name of the existing channel to post in: the words right after “in”, “to”, “go to”, or “open”, even without “channel” (“in release planning, tell everyone …” → “release planning”; “the one in the ios channel” → “ios”), even before a colon (“post in ios: …” → “ios”), or “here” for the one on screen',
        },
        mentions: {
          kind: 'person',
          many: true,
          required: false,
          ask: 'Who should I mention?',
          describe:
            'only people or agents explicitly named for an @mention; “tell everyone” is message wording, not a person to mention',
        },
        message: {
          kind: 'text',
          preserveText: true,
          required: true,
          ask: 'What should I post[ in {channel}]?',
          describe:
            'the exact words to post: never the channel’s name, “here”, or the names being mentioned (“mention Priya to check the logs” → “check the logs”; “in release planning, tell everyone the release is on Friday” → “the release is on Friday”)',
        },
      },
      summarize: 'Post “{message}” in {channel}[ mentioning {mentions}]',
      plan: [
        { op: 'navigate', target: '$channel' },
        { op: 'send_message', target: '$channel', text: '$message', mentions: '$mentions' },
      ],
      done: 'Posted in {channel}.',
    },
    {
      id: 'reply_in_thread',
      title: 'Reply in a thread',
      intent: {
        description:
          'Reply inside an existing thread: the one open on screen ("here", "this thread") or one found by what it was about. When a thread is open, asking an agent to do work in it means mention the agent in a reply there.',
        examples: [
          'Reply here saying looks good',
          'Reply in this thread that I will check it today',
          'Reply to the thread about the release notes saying it is done',
          'In this thread, tell them the fix is live',
          'Mention Build Bot in this thread and ask it to check the latest crash',
          'Invoke Review Bot and ask it to summarize this thread',
          'Mention Review Bot and ask it to explain who owns this',
        ],
        notFor: [
          {
            when: 'a new message in a channel, not inside a thread',
            instead: 'that is a post in the channel',
          },
          {
            when: 'messaging one person directly',
            instead: 'that is a direct message',
          },
        ],
      },
      effect: 'send',
      fields: {
        thread: {
          kind: 'thread',
          required: true,
          ask: 'Which thread should I reply in?',
          choose: 'Which thread do you mean by “{mention}”?',
          describe:
            'the destination thread topic, without wrapper words such as “thread about” or reply text (“reply to the thread about release notes draft saying it is done” → “release notes draft”). Use the thread open on screen when the user says “here” or “this thread”, or asks an agent to act without naming another thread.',
          onScreen:
            'the thread already open on screen, when the user means “here” or asks an agent to act there without naming another thread',
        },
        mentions: {
          kind: 'person',
          many: true,
          required: false,
          ask: 'Who should I mention?',
          describe:
            'only the exact names of the people, apps, or agents the user asks to @mention; leave their requested task in the message',
        },
        message: {
          kind: 'text',
          preserveText: true,
          required: true,
          ask: 'What should I reply?',
          describe:
            'the exact reply body in the user’s own words. For a normal reply, keep what follows the reply cue (“reply here saying looks good” → “looks good”); for an agent request, keep what the agent should do (“invoke Review Bot and ask it to summarize this thread” → “summarize this thread”). Remove only the wording that asks to mention or invoke the named person or agent. Preserve task words such as “channel”, “message”, or “to”.',
        },
      },
      summarize: 'Reply “{message}” in {thread}[ mentioning {mentions}]',
      plan: [
        { op: 'navigate', target: '$thread' },
        { op: 'send_message', target: '$thread', text: '$message', mentions: '$mentions' },
      ],
      done: 'Replied in {thread}.',
    },
    {
      id: 'forward_message',
      title: 'Forward a message',
      intent: {
        description:
          'Forward a message that already exists, the one on screen ("this message", "this", "it"), to one person or app.',
        examples: [
          'Forward this message to Priya',
          'Forward this to Daniel',
          'Share this message with Meera',
          'Send this to Sam',
        ],
        notFor: [
          {
            when: 'forwarding to a channel ("forward this to #design", "share this in general")',
            instead: 'that forwards to the channel',
          },
          {
            when: 'new words to send ("tell Priya the build is green")',
            instead: 'that is a direct message',
          },
        ],
      },
      effect: 'send',
      confirm: 'always',
      fields: {
        message: {
          kind: 'message',
          required: true,
          ask: 'Which message? Use Ask AI on it, or open its thread, then ask me again.',
          describe: 'the message to forward: “this”, “this message”, or “it” for the one on screen',
        },
        recipient: {
          kind: 'person',
          required: true,
          ask: 'Who should I forward it to?',
          describe: 'the one person or app to forward it to',
        },
      },
      summarize: 'Forward {message} to {recipient}',
      plan: [
        { op: 'open_or_create_dm', user: '$recipient' },
        { op: 'navigate', target: { fromStep: 0 } },
        { op: 'forward_message', message: '$message', target: { fromStep: 0 } },
      ],
      done: 'Forwarded to {recipient}.',
    },
    {
      id: 'forward_to_channel',
      title: 'Forward a message to a channel',
      intent: {
        description:
          'Forward a message that already exists, the one on screen ("this message", "this", "it"), into an existing channel.',
        examples: [
          'Forward this to the design channel',
          'Share this message in general',
          'Forward this message to android',
          'Post this in release planning',
        ],
        notFor: [
          {
            when: 'forwarding to a person ("forward this to Priya")',
            instead: 'that forwards to the person',
          },
          {
            when: 'new words to post ("post in general that the build is green")',
            instead: 'that is a post in the channel',
          },
        ],
      },
      effect: 'send',
      confirm: 'always',
      fields: {
        message: {
          kind: 'message',
          required: true,
          ask: 'Which message? Use Ask AI on it, or open its thread, then ask me again.',
          describe: 'the message to forward: “this”, “this message”, or “it” for the one on screen',
        },
        channel: {
          kind: 'channel',
          required: true,
          ask: 'Which channel should I forward it to?',
          describe: 'the name of the existing channel to forward it to',
        },
      },
      summarize: 'Forward {message} to {channel}',
      plan: [
        { op: 'navigate', target: '$channel' },
        { op: 'forward_message', message: '$message', target: '$channel' },
      ],
      done: 'Forwarded to {channel}.',
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
          'Show me the conversation about the pricing change',
          'Find the login errors thread, then narrow it to the one in ios',
          'Find the release notes thread with Meera',
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
          searchFilter: true,
          required: false,
          ask: 'Who was in it?',
          describe:
            'only participant names, such as after “with” or “me and”; never a channel phrase such as “the one in ios” or the user themselves (“find the messages where Meera and I discussed the offsite” → Meera)',
        },
        in: {
          kind: 'channel',
          searchFilter: true,
          required: false,
          ask: 'Which channel was it in?',
          describe:
            'only the name of a channel the user says it was in (“in the android channel” or “the one in the ios channel” → “android” or “ios”), never the topic of the conversation',
        },
      },
      summarize: 'Open the conversation “{conversation}”',
      plan: [{ op: 'navigate', target: '$conversation' }],
      done: 'Here it is.',
    },
  ],
} satisfies ActionArea;
