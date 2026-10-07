import type { ActionDefinition } from './action';

export const AGENT_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'create_agent',
    starter: 2,
    title: 'Create an agent',
    hint: 'Build an agent that does a job for you',
    guide: [
      'Enter a name under Name your agent and pick a Color.',
      'Add a Description and fill in What it does, or use Improve with AI.',
      'Choose the tools, skills and knowledge it may use.',
      'Click Create.',
    ],
    intent: {
      description: 'Create a new AI agent with its own instructions, tools and knowledge.',
      examples: [
        'Create an agent',
        'I want to build an agent',
        'Make a new AI assistant for support',
        'How do I set up an agent?',
        'Add a custom agent',
        'Build a bot for my team',
      ],
      notFor: [
        {
          when: 'describing an agent that already exists or that someone else built, such as "Rahul built an agent for sales"',
          instead: 'none of these: nothing is asked to be done',
        },
      ],
    },
    effect: 'change',
    fields: {
      name: {
        kind: 'text',
        required: true,
        ask: 'What should we call it?',
        label: 'name',
        describe:
          "a name the user gave the agent (often after 'called' or 'named'), not a description of it or its purpose",
      },
      instructions: {
        kind: 'longtext',
        required: true,
        ask: 'What should it do?',
        content: true,
        label: 'instructions',
        describe: "what the agent should do, in the user's words",
      },
      improve: {
        kind: 'boolean',
        ask: 'Should I improve the instructions with AI?',
        label: 'improved by AI before saving',
        offer: 'Want me to improve these instructions with AI?',
        describe:
          'whether the user wants the instructions improved with AI (yes if they agree, no if they decline)',
      },
    },
    plan: [
      { op: 'fill', form: 'agent_create' },
      { op: 'run_action', form: 'agent_create', action: 'improve', if: 'improve' },
      { op: 'submit', form: 'agent_create' },
    ],
    done: 'Done — {name} is ready.',
  },
  {
    id: 'browse_agents',
    starter: 6,
    title: 'Browse agents',
    hint: 'Find an agent to use',
    guide: ['In the AI library, open the Agents tab and search by name or what it does.'],
    intent: {
      description: 'Look through the agents that already exist, to find one to use.',
      examples: [
        'show my agents',
        'which agents do we have',
        'find an agent for code review',
        'open the agent library',
        'is there an agent for support tickets',
      ],
      notFor: [
        {
          when: 'creating a new agent',
          instead: 'that is create_agent',
        },
        {
          when: 'talking to an agent or asking it something',
          instead: 'that is start_chat or send_message',
        },
        {
          when: 'mentioning an agent in a channel or thread',
          instead: 'that is send_message',
        },
      ],
    },
    effect: 'navigate',
    fields: {
      query: {
        kind: 'longtext',
        ask: 'What kind of agent are you looking for?',
        label: 'about',
        describe:
          'what the agent should do or its name, to search by; without words like agent or find',
      },
    },
    plan: [{ op: 'open_page', page: 'ai_library_agents', params: { q: '{query}' } }],
    done: 'Here are the agents.',
  },
];
