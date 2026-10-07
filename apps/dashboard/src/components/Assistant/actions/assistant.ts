import type { ActionDefinition } from './action';

export const ASSISTANT_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'what_i_can_do',
    title: 'See what I can do',
    intent: {
      description:
        'Ask what this assistant can do or help with, which features there are, or what to do first or next, without naming a task.',
      examples: [
        'What can you do?',
        'What can you help me with?',
        'What features are there?',
        'What can I do here?',
        'What should I try first?',
        'What are the next steps?',
        "I'm new here, show me around",
        'Help',
        'tum kya kya kar sakte ho',
      ],
      notFor: [
        {
          when: 'asking what something is or how it works, like what a channel or an agent is',
          instead: 'none of these: the AI assistant explains it',
        },
        {
          when: 'asking for help with one task, like creating a channel or writing an email',
          instead: 'that task, or none of these when no action does it',
        },
      ],
    },
    effect: 'read',
    fields: {},
    plan: [{ op: 'list_actions' }],
  },
];
