import type { ActionArea } from './action';

export const AGENTS = {
  id: 'agents',
  description:
    'Agents: creating an agent that does a job for you or your team ("create an agent", "build a bot", "make an assistant for support").',
  actions: [
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
      effect: 'navigate',
      fields: {},
      summarize: 'Open Create agent',
      plan: [{ op: 'open_page', page: 'ai_agent_create' }],
      done: 'Opened Create agent.',
    },
  ],
} satisfies ActionArea;
