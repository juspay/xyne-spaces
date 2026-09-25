export interface HubKnowledgeDefinition {
  id: string;
  title: string;
  instructions: string;
  sections: readonly { title: string; instructions: string }[];
}

/** Seeded into each step's task, where admins can edit it. */
const HUB_KNOWLEDGE_POLICY = `This document is Hub Knowledge: standing context the SDLC agent receives, ahead of the
user's question, on every chat and channel request in this hub. Write for an agent that has not seen the
code, is about to act on it, and pays for every token you spend.

- Cover every repository in the hub. List them with spaces-sdlc-list-repositories first, and say how they
  relate where it matters.
- Stay under about 800 words.
- Prefer what stays true: module boundaries, entry points, where a kind of thing lives, the conventions a
  change has to follow, the invariants that bite. Leave out line numbers, file counts, version strings and
  progress notes.
- Ground claims in the repositories and name the path or symbol that proves them, in plain text. Name the
  few files that orient someone rather than listing many. Skip generated code, vendored dependencies and
  trivial helpers.
- Read the Repository Wikis and the Hub Wiki (spaces-sdlc-list-artifacts, kind "WIKI") and point to a
  page instead of restating it.
- If something does not exist in the hub, say so in one line with the evidence rather than inventing it.`;

export const HUB_KNOWLEDGE_DEFINITIONS: readonly HubKnowledgeDefinition[] = [
  {
    id: 'system_overview',
    title: 'System Overview',
    instructions: `${HUB_KNOWLEDGE_POLICY}

Write the System Overview: what the system does, the role of each repository, and how the repositories
connect at runtime and at build and deploy time.`,
    sections: [
      { title: 'What the system does', instructions: 'The product and its main users, in a few lines.' },
      { title: 'Repositories', instructions: 'One entry per repository: its role and main runtime.' },
      {
        title: 'How they connect',
        instructions: 'Calls, events, shared data and deploy dependencies between repositories.',
      },
    ],
  },
  {
    id: 'code_map',
    title: 'Code Map',
    instructions: `${HUB_KNOWLEDGE_POLICY}

Write the Code Map: for each repository, its entry points, module boundaries and where each kind of thing
lives.`,
    sections: [
      { title: 'Entry points', instructions: 'Application, server, worker and CLI entry points per repository.' },
      { title: 'Module boundaries', instructions: 'The major modules per repository and what each owns.' },
      {
        title: 'Where things live',
        instructions: 'Routes, data models, migrations, UI, jobs and shared packages per repository.',
      },
    ],
  },
  {
    id: 'conventions',
    title: 'Conventions',
    instructions: `${HUB_KNOWLEDGE_POLICY}

Write the Conventions: what a change has to follow in each repository. Separate rules that tooling or CI
enforces from patterns only observed in the code or history.`,
    sections: [
      { title: 'Stack', instructions: 'Languages, frameworks and package managers per repository.' },
      {
        title: 'Formatting, lint and types',
        instructions: 'The enforced tools and their configuration paths.',
      },
      { title: 'Error handling', instructions: 'How errors are raised, mapped and logged.' },
      {
        title: 'Git commits and branches',
        instructions:
          'Commit message format, types and scopes, branch naming, and the hooks or CI checks that enforce them.',
      },
    ],
  },
  {
    id: 'run_and_test',
    title: 'Run and Test',
    instructions: `${HUB_KNOWLEDGE_POLICY}

Write Run and Test: the shortest reliable path to run and verify each repository. Name required secrets but
never their values.`,
    sections: [
      { title: 'Setup', instructions: 'Required runtimes, dependency install, environment and backing services.' },
      { title: 'Run', instructions: 'The canonical development commands per repository.' },
      { title: 'Test', instructions: 'Test layers and the commands that run them per repository.' },
      { title: 'CI', instructions: 'The checks CI requires and where they are configured.' },
    ],
  },
];
