/**
 * The built-in thread-type vocabulary — the BASE layer.
 *
 * Thread types are the only tag kind; the message-act vocabulary that used to sit alongside
 * them is gone. A message now carries the thread types it is evidence for, which is how a
 * thread's tag is traced back to what caused it.
 *
 * These entries are not seeded into any table. They are the base of the layered resolution
 * in services/messageClassification/vocabulary.ts: rows in non_zero.thread_type_vocabulary
 * override or suppress them per workspace, and a workspace with no rows sees exactly this.
 * Editing a name here changes it for every workspace that has not overridden it.
 *
 * Do NOT look an entry up from this list to render a chip — use the resolved workspace
 * vocabulary, or a workspace that renamed a type will still show the built-in label.
 *
 * Values are UPPER_SNAKE, deliberately unlike the lowercase-hyphenated shape people type
 * for free-form thread tags, so built-in and custom are distinguishable at a glance.
 */

/** One entry in the workspace's thread-type vocabulary. */
export interface ThreadTypeEntry {
  name: string;
  label: string;
  color: string;
  /** One-line definition. Generates the classifier prompt AND the chip's hover tooltip. */
  description: string;
}

/**
 * The thread types, in display order.
 *
 * One flat vocabulary: a thread carries every type that genuinely applies and nothing else —
 * usually one, sometimes two or three. There is no partition and no per-thread cap.
 *
 * Two kinds of definition live here, distinguished by how they are phrased rather than by a
 * field. A "done = …" definition describes the thread as a piece of WORK; the rest describe
 * what a reader who was never in the thread could learn from it, and their bar is high —
 * most threads clear none of them.
 *
 * Descriptions are prompt copy, so the "not" clauses matter as much as the definitions:
 * near-misses are what the classifier gets wrong, and each one here is load-bearing.
 */
export const THREAD_TYPES: readonly ThreadTypeEntry[] = [
  {
    name: 'ISSUE',
    label: 'Issue',
    color: '#ef4444',
    description:
      'Something that should work is broken or degraded. Done = fixed and verified.',
  },
  {
    name: 'ALERT',
    label: 'Alert',
    color: '#f59e0b',
    description:
      'A bot or automated check (monitoring, QA, CI) opened the thread to report a problem. Done = acknowledged and resolved or deliberately suppressed.',
  },
  {
    name: 'QUESTION',
    label: 'Question',
    color: '#f97316',
    description:
      'The thread exists to get information; no defect, no action on a system. Done = answered.',
  },
  {
    name: 'REQUEST',
    label: 'Request',
    color: '#3b82f6',
    description:
      'Asks someone to perform an action the system already supports. Done = action performed and confirmed.',
  },
  {
    name: 'FEATURE_REQUEST',
    label: 'Feature request',
    color: '#8b5cf6',
    description:
      'Asks for capability that does not exist; requires product evaluation. Done = accepted onto the roadmap or declined with reason.',
  },
  {
    name: 'DISCUSSION',
    label: 'Discussion',
    color: '#6b7280',
    description:
      'Open-ended exchange with no inherent done state. The default when no other type fits.',
  },
  {
    name: 'ANNOUNCEMENT',
    label: 'Announcement',
    color: '#14b8a6',
    description:
      'One-to-many broadcast; nothing is owed by anyone. No done state. Covers dated ' +
      'statements of change — releases, go-lives, deprecations, migrations, planned ' +
      'maintenance. NOT internal progress chatter ("almost done with the release") or an ' +
      'intention without commitment ("we should ship this next week").',
  },

  {
    name: 'HOW_TO',
    label: 'How-to',
    color: '#0891b2',
    description:
      'Contains an actionable procedure — ordered steps, or a complete instruction a reader ' +
      'could follow to accomplish the task without needing anything from elsewhere. Fires on ' +
      'step-by-step instructions, config walkthroughs, a complete "do X then Y" resolution. ' +
      'NOT when someone ASKS how to do something (a question is not an answer), NOT a partial ' +
      'hint with no complete path ("check the dashboard"), NOT a description of what a feature ' +
      'does with no steps.',
  },
  {
    name: 'WHAT_HAPPENED',
    label: 'What happened',
    color: '#b45309',
    description:
      'A narrative of a specific past event — incident recap, sequence of events, impact, ' +
      'resolution. The account of what occurred, as opposed to the causal analysis of why. ' +
      'NOT live firefighting chatter from mid-incident (fragments, not a narrative), NOT a bot ' +
      'alert (that is the event itself, not an account of it), NOT speculation about something ' +
      'still ongoing.',
  },
  {
    name: 'WHY_DECISION',
    label: 'Why (decision)',
    color: '#4f46e5',
    description:
      'States a decision AND the reasoning behind it. Fires on "we chose X over Y because…", ' +
      'a tradeoff discussion that concludes in a choice, policy rationale ("we do not retry ' +
      '3DS failures because banks flag it as fraud"). NOT a decision stated with no reasoning ' +
      '("we are going with X"), NOT opinions that never reach a choice.',
  },
  {
    name: 'WHAT_IS',
    label: 'What is',
    color: '#059669',
    description:
      'Explains a concept, term, feature or system — a definition or explainer a newcomer ' +
      'could learn from. Answers a vocabulary question, not a task question. Fires on "X is…", ' +
      '"X means…", capability descriptions, jargon explanations, architecture explainers. NOT ' +
      'when the term is merely USED rather than explained, NOT a one-word or purely contextual ' +
      'reply.',
  },
  {
    name: 'KNOWN_ISSUE',
    label: 'Known issue',
    color: '#be123c',
    description:
      'An acknowledged bug or limitation, its status, and any workaround. Fires when the ' +
      'thread establishes that something is known-broken and what to do in the meantime. NOT a ' +
      'fresh report whose validity nobody has confirmed yet, and NOT a one-off failure that ' +
      'was simply fixed.',
  },
  {
    name: 'REFERENCE',
    label: 'Reference',
    color: '#334155',
    description:
      'Exact technical facts meant to be looked up: field lists, parameter names and types, ' +
      'enum values, error-code meanings, formats, header lists, column schemas. Authoritative ' +
      'values — no steps, no narrative. NOT a field mentioned in passing inside troubleshooting, ' +
      'NOT a filled-in sample payload with no field semantics (that is EXAMPLE), NOT a UI ' +
      'walkthrough (that is HOW_TO).',
  },
  {
    name: 'EXAMPLE',
    label: 'Example',
    color: '#65a30d',
    description:
      'A concrete, complete instance whose value is that it can be copied and used: a working ' +
      'request, a filled-in payload, a real config block, a sample report row. NOT pseudo-code ' +
      'fragments, NOT snippets truncated or redacted to uselessness, NOT a mention of a ' +
      'screenshot with no content.',
  },
  {
    name: 'POLICY_LIMIT',
    label: 'Policy / limit',
    color: '#c026d3',
    description:
      'States an operative constraint together with its value: transaction limits, SLA ' +
      'durations, rate limits, settlement cutoffs, retry policies, compliance thresholds. NOT a ' +
      'limit being asked about, disputed or guessed at ("I think it is 15K?"), NOT a limit ' +
      'being breached during an incident (that is WHAT_HAPPENED).',
  },
];
