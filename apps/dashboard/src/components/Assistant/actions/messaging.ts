import { hasValue, type ActionDefinition } from './action';

export const MESSAGING_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'start_chat',
    starter: 1,
    title: 'Start a chat',
    hint: 'Message a person directly',
    guide: [
      'Click Add direct message in the sidebar, pick one or more people, and say something to start.',
    ],
    intent: {
      description:
        'Start a direct message (DM) with one or more people, bots or agents; with several, a group chat.',
      examples: [
        'Start a group chat with Priya, Rahul and Sara',
        'Message a teammate',
        'Start a chat with someone',
        'How do I DM a person?',
        'Send a direct message',
        'I want to chat with Priya',
        'How can I message someone privately?',
        'dm priya',
        'Open a chat with Rahul',
        'Chat with Xyne Doctor',
        'Open a chat with the support agent',
      ],
      notFor: [
        {
          when: 'sending a message that says something, to a person, a group or a channel, even in a new chat',
          instead: 'that is send_message',
        },
        {
          when: 'creating a channel for a team or topic',
          instead: 'that is create_channel',
        },
        {
          when: 'adding someone to a channel that already exists',
          instead: 'that is add_to_channel',
        },
        {
          when: 'inviting people to the workspace',
          instead: 'none of these: a chat is not an invitation',
        },
      ],
    },
    effect: 'navigate',
    fields: {
      person: {
        kind: 'people',
        required: true,
        ask: 'Who do you want to chat with?',
        label: 'with',
        describe: 'the person, bot or agent to chat with, or the people of a group chat',
      },
    },
    // Asked only for a group, which this makes: a chat with one person just opens.
    summary: ({ person }): string => `Start a chat with ${person?.trim()}`,
    plan: [{ op: 'perform', task: 'openChat', page: 'chat_new_message' }],
    done: 'Opened your chat with {person}.',
  },
  {
    id: 'send_message',
    starter: 4,
    title: 'Send a message',
    hint: 'Say something to a person, a channel or this thread',
    guide: [
      'Open the channel, chat or thread, type in the box at the bottom, and press Enter; type @ to mention someone.',
    ],
    intent: {
      description:
        'Send a message that says something: to a person directly, in a channel, or as a reply in the thread the user is looking at, optionally mentioning a person, bot or agent.',
      examples: [
        'Send a message to Panju saying the deploy is done',
        'Tell #payments the build is green',
        'Message Priya that I will be late',
        'Post in #general that the meeting moved to 4pm',
        'Mention Xyne AI in this thread and ask it to do an RCA',
        'Mention Ask AI in #general and ask it to do an RCA',
        'Tag Ask AI here and ask it to check the logs',
        'Mention Sara here and ask what the conclusion is',
        'Start a chat with Priya and say hello',
        'Write a message to Priya saying hi',
        'dm Neha saying the deck is ready',
        'dm Priya and Rahul saying the build passed',
        'Start a group chat with Neha and Ankit saying standup is moved',
        'Share this here: the demo is at 3',
        'Ask Xyne Doctor why the build failed',
        'Ask the ReviewBot agent to review my PR',
        'Let the team in #design know the mocks are ready',
        'Panju ko bolo deploy ho gaya',
      ],
      notFor: [
        {
          when: 'asking for a message to be written, drafted or reworded',
          instead: 'none of these: the AI assistant writes the text',
        },
        {
          when: 'opening a chat with someone without saying anything yet',
          instead: 'that is start_chat',
        },
        {
          when: 'searching past messages',
          instead: 'that is find_messages',
        },
      ],
    },
    effect: 'send',
    fields: {
      person: {
        kind: 'people',
        ask: 'Who should get it?',
        label: 'to',
        describe:
          'the person, or people together, to message directly; leave out when it goes to a channel or thread',
      },
      channel: {
        kind: 'channel',
        ask: 'Which channel or thread?',
        label: 'in',
        describe:
          'the channel to post in, just its name, or "this thread" or "this channel" for the conversation the user is in; never the message itself',
      },
      mention: {
        kind: 'person',
        ask: 'Who should I mention?',
        label: 'mentioning',
        describe:
          'the full name, as said, of a person, bot or agent the user asks to @mention or tag, like "Ask AI" or "Xyne AI"; never who the message is sent to',
      },
      message: {
        kind: 'longtext',
        required: true,
        ask: 'What should it say?',
        content: true,
        label: 'message',
        parse: 'message',
        describe:
          'the words to send, or what the mentioned bot or agent is asked to do; not who it is for, which channel, or who is mentioned',
      },
    },
    requireOneOf: ['person', 'channel'],
    // The whole text, with the @mention it will start with: this is what gets sent. A person named
    // alongside a channel is mentioned there, as the task does.
    summary: ({ person, channel, mention, message }): string => {
      const tagged = hasValue(mention) ? mention : hasValue(channel) ? person : null;
      const said = [hasValue(tagged) && `@${tagged.trim()}`, message?.trim()]
        .filter(Boolean)
        .join(' ');
      return `Send to ${(channel ?? person)?.trim()}: “${said}”`;
    },
    plan: [{ op: 'perform', task: 'sendMessage' }],
    done: 'Sent.',
  },
  {
    id: 'create_channel',
    starter: 3,
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
          when: 'creating a user group, or any named set of people that share access',
          instead:
            'not create_channel: that is create_user_group when it is listed, otherwise none of these; a channel is a conversation, not a user group',
        },
        {
          when: 'saying a channel was already made, or that someone else made one',
          instead: 'none of these: nothing is asked to be done',
        },
        {
          when: 'messaging one person directly',
          instead: 'that is start_chat',
        },
        {
          when: 'sending a message in a channel that already exists',
          instead: 'that is send_message',
        },
        {
          when: 'adding someone to a channel',
          instead: 'that is add_to_channel',
        },
      ],
    },
    effect: 'change',
    fields: {
      name: {
        kind: 'text',
        required: true,
        ask: 'What should the channel be called?',
        label: 'name',
        describe: 'the name of the new channel',
      },
      visibility: {
        kind: 'choice',
        required: true,
        ask: 'Should it be public or private?',
        label: 'visibility',
        describe: 'public (anyone in the workspace can join) or private (only invited people)',
        options: [
          { id: 'public', label: 'Public' },
          { id: 'private', label: 'Private' },
        ],
      },
      // Optional with no offer: it is only filled in when the user says it.
      description: {
        kind: 'longtext',
        label: 'description',
        ask: 'What is the channel about?',
        content: true,
        describe:
          "what the channel is about, in the user's words; not its name, nor a request of its own",
      },
      project: {
        kind: 'text',
        ask: 'Which project should it be in?',
        label: 'project',
        describe: 'the project to put the channel in, named after the word "project", or "none"',
      },
      tags: {
        kind: 'text',
        ask: 'Which topic tags should it have?',
        label: 'tags',
        describe: 'the topic tags to add to the channel',
      },
    },
    plan: [
      { op: 'fill', form: 'channel_create' },
      { op: 'submit', form: 'channel_create' },
    ],
    done: 'Done — {name} is created. Add people in the dialog that just opened, or ask me to add them.',
  },
  {
    id: 'add_to_channel',
    title: 'Add someone to a channel',
    guide: [
      "Open the channel's details and click Add People; only its admins may when the channel says so.",
    ],
    intent: {
      description: 'Add a person, bot or agent to a channel that already exists.',
      examples: [
        'Add Sara to #design',
        'Add Daniel in it',
        'Put Rahul in the testing channel',
        'Add Xyne Doctor to this channel',
        'Can you add Priya to #launch?',
        'Add Sara and Rahul to it',
      ],
      notFor: [
        {
          when: 'inviting someone new to the workspace, or by email as a guest to a channel',
          instead: 'that is invite_people',
        },
        {
          when: 'starting a direct chat with someone',
          instead: 'that is start_chat',
        },
        {
          when: 'seeing, editing or removing the members of the workspace',
          instead: 'that is manage_members',
        },
        {
          when: 'removing someone from a channel',
          instead: 'none of these: removing people is not one of these actions',
        },
      ],
    },
    effect: 'change',
    fields: {
      person: {
        kind: 'people',
        required: true,
        ask: 'Who should I add?',
        label: 'adding',
        describe: 'the person, bot or agent to add, or several of them',
      },
      channel: {
        kind: 'channel',
        required: true,
        ask: 'Which channel?',
        label: 'to',
        describe:
          'the channel to add them to, just its name, or "it" or "this channel" for the one the user is in or just created',
      },
    },
    summary: ({ person, channel }): string => `Add ${person?.trim()} to ${channel?.trim()}`,
    plan: [{ op: 'perform', task: 'addToChannel' }],
    done: 'Added {person} to {channel}.',
  },
  {
    id: 'browse_channels',
    title: 'Browse channels',
    hint: 'Find channels to join',
    guide: ['Click Browse channels in the sidebar, search, and join the one you want.'],
    intent: {
      description: 'Find or browse the channels that exist, to join one or see what is there.',
      examples: [
        'Where can I find channels to post in?',
        'Show me all the channels',
        'Which channels can I join?',
        'Browse channels',
        'Is there a channel for design?',
      ],
      notFor: [
        {
          when: 'sending a message, to a channel or a person',
          instead: 'that is send_message',
        },
        {
          when: 'creating a new channel',
          instead: 'that is create_channel',
        },
        {
          when: 'searching for messages that were said',
          instead: 'that is find_messages',
        },
      ],
    },
    effect: 'navigate',
    fields: {},
    plan: [{ op: 'open_page', page: 'chat_browse_channels' }],
  },
  {
    id: 'find_messages',
    starter: 5,
    title: 'Find messages',
    hint: 'Search conversations by topic, person, channel or date',
    guide: ['Type in the search bar at the top, then narrow by person, channel or date.'],
    intent: {
      description:
        'Search past messages and conversations for something that was said, by topic, person, channel or date.',
      examples: [
        'find the thread where me and Punch discussed mobile perf',
        'search messages about the checkout outage',
        'what did Rahul say about the deploy',
        'find messages from Ankit last week',
        'look for the pricing conversation in #sales',
        'where did we talk about the offsite dates',
        'any messages from priya about the invoice yesterday',
        'search for the budget in the marketing channel',
        'find something about SSO',
        'look up messages about performance reviews in #hr',
        'Ankit ne release ke baare mein kya kaha tha',
      ],
      notFor: [
        {
          when: 'summarising, explaining or answering from what was discussed, such as summarising the messages from someone',
          instead: 'none of these: the AI assistant reads and answers',
        },
        {
          when: 'sending a message to someone',
          instead: 'that is send_message',
        },
      ],
    },
    effect: 'read',
    fields: {
      topic: {
        kind: 'longtext',
        ask: 'What was it about?',
        label: 'about',
        describe: 'the topic words to search for, without people, channels or dates',
      },
      person: {
        kind: 'person',
        ask: 'Who was it with?',
        label: 'with',
        describe: 'a person the messages were with or from, other than the user',
      },
      channel: {
        kind: 'channel',
        ask: 'Which channel?',
        label: 'in',
        describe: 'the channel the messages are in',
      },
      when: {
        kind: 'date',
        ask: 'When was it?',
        label: 'when',
        describe: 'when it was said, e.g. yesterday or last week',
      },
    },
    plan: [
      {
        op: 'open_page',
        page: 'search_results',
        params: {
          query: '{topic}',
          with: '{person.id}',
          in: '{channel.id}',
          range: '{when}',
        },
      },
    ],
    done: 'Here is what I found.',
    outcome: 'list',
  },
];
