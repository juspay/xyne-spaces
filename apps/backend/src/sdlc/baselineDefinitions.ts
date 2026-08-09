import type { SdlcBaselineKind } from '@xyne/shared';

export interface BaselineDefinition {
  kind: SdlcBaselineKind;
  title: string;
  instructions: string;
  sections: readonly BaselineSectionDefinition[];
}

export interface BaselineSectionDefinition {
  key: string;
  title: string;
  instructions: string;
}

export const BASELINE_DEFINITIONS: readonly BaselineDefinition[] = [
  {
    kind: 'CORE_CODE_MAP',
    title: 'Core Code Map',
    instructions: `Create a concise architecture navigation map covering boundaries, entry points,
major modules and ownership, public APIs, and only the most critical function/data flows. Name the
few paths and symbols that best orient an agent, then point to relevant Wiki pages and source paths
for detail. Skip exhaustive inventories, trivial helpers, generated code, dependencies, and vendor code.`,
    sections: [
      {
        key: 'architecture',
        title: 'Architecture and boundaries',
        instructions: 'Summarize the top-level architecture, runtime boundaries, and ownership.',
      },
      {
        key: 'entrypoints',
        title: 'Entry points',
        instructions:
          'Point to the primary application, server, router, CLI, and startup entry points.',
      },
      {
        key: 'modules',
        title: 'Major modules',
        instructions: 'Map only the major modules and their responsibilities.',
      },
      {
        key: 'public_apis',
        title: 'Public APIs',
        instructions: 'Summarize primary routes and exports; point to their defining symbols.',
      },
      {
        key: 'critical_flows',
        title: 'Critical function and data flows',
        instructions: 'Trace only the most important internal function chains and data flows.',
      },
    ],
  },
  {
    kind: 'FRONTEND_DESIGN_SYSTEM',
    title: 'Frontend Design System',
    instructions: `Create a concise frontend navigation brief covering the stack, tokens, typography,
spacing, color, icons, component patterns, layouts, accessibility, and responsive conventions. Keep
only the conventions needed for consistent implementation, then point to relevant Wiki pages and
exact config/component paths for detail. If no frontend exists, state that briefly with evidence.`,
    sections: [
      {
        key: 'stack',
        title: 'Frontend stack',
        instructions: 'Identify frameworks and build tooling.',
      },
      {
        key: 'tokens',
        title: 'Design tokens',
        instructions:
          'Summarize token sources and point to color, typography, spacing, and icon definitions.',
      },
      {
        key: 'components',
        title: 'Components and patterns',
        instructions: 'Summarize primary reusable component and composition patterns.',
      },
      {
        key: 'layouts',
        title: 'Layouts and responsiveness',
        instructions: 'Summarize layout, breakpoint, and responsive conventions.',
      },
      {
        key: 'accessibility',
        title: 'Accessibility',
        instructions: 'Summarize the key accessibility conventions and evidence.',
      },
    ],
  },
  {
    kind: 'CODE_LINT_STANDARDS',
    title: 'Code & Lint Standards',
    instructions: `Create a concise implementation guardrail brief covering formatter, linter,
type-system, naming, imports, error handling, repository conventions, and runnable verification
commands. Distinguish enforced rules from observed conventions, summarize only rules agents commonly
need, then point to relevant Wiki pages and exact source config paths for the complete details.`,
    sections: [
      {
        key: 'tooling',
        title: 'Formatting and lint tooling',
        instructions: 'Summarize enforced tooling and point to its configuration.',
      },
      {
        key: 'typing',
        title: 'Type system',
        instructions: 'Summarize the type-checking configuration and key conventions.',
      },
      {
        key: 'conventions',
        title: 'Code and Git conventions',
        instructions:
          'Summarize high-impact naming, import, repository, commit, and branch-naming conventions. Derive branch rules from repository docs, configuration, CI, and recent branches; clearly distinguish enforced rules from observed patterns.',
      },
      {
        key: 'errors',
        title: 'Error handling',
        instructions: 'Summarize primary error-handling patterns and boundaries.',
      },
      {
        key: 'commands',
        title: 'Verification commands',
        instructions: 'List only the canonical formatting, lint, and type-check commands.',
      },
    ],
  },
  {
    kind: 'RUN_GUIDE',
    title: 'Run Guide',
    instructions: `Create a concise run navigation brief covering prerequisites, environment setup,
dependencies, backing services, essential development/package commands, and the most common failure
notes. Include only the shortest reliable path to a working environment, then point to relevant Wiki
pages and exact source files for variants and detail. Name required secrets but never reveal values.`,
    sections: [
      {
        key: 'prerequisites',
        title: 'Prerequisites',
        instructions: 'List only required runtimes and tooling.',
      },
      {
        key: 'environment',
        title: 'Environment',
        instructions: 'Summarize environment setup and required secret names.',
      },
      {
        key: 'dependencies',
        title: 'Dependencies and services',
        instructions: 'Summarize dependency installation and required backing services.',
      },
      {
        key: 'commands',
        title: 'Run commands',
        instructions: 'List the canonical development and package-specific commands.',
      },
      {
        key: 'failures',
        title: 'Common failures',
        instructions: 'List only common evidence-backed failures and shortest recovery steps.',
      },
    ],
  },
  {
    kind: 'TEST_GUIDE',
    title: 'Test Guide',
    instructions: `Create a concise testing navigation brief covering existing test layers, key file
locations, commands, fixtures, CI gates, and practical verification order. Include only what an agent
needs to choose and run the right checks, then point to relevant Wiki pages and exact source files for
suite-specific detail. Do not invent missing tests or recommend adding v1 tests.`,
    sections: [
      {
        key: 'layers',
        title: 'Test layers',
        instructions: 'Summarize existing test layers and their scope.',
      },
      {
        key: 'locations',
        title: 'Test locations and fixtures',
        instructions: 'Point to primary test, fixture, and utility locations.',
      },
      {
        key: 'commands',
        title: 'Test commands',
        instructions: 'List only canonical runnable test commands.',
      },
      {
        key: 'ci',
        title: 'CI gates',
        instructions: 'Summarize required CI test gates and point to their configuration.',
      },
      {
        key: 'verification',
        title: 'Verification order',
        instructions: 'Give the shortest practical verification sequence.',
      },
    ],
  },
] as const;
