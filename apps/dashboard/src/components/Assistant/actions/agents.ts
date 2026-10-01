import type { ActionDefinition } from './action';

export const AGENT_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'create_agent',
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
    },
    summarize: 'Open Create agent',
    page: 'ai_agent_create',
  },
];
