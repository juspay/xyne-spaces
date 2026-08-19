/**
 * Controlled tag vocabularies for the classifier.
 *
 * Values are UPPER_SNAKE, deliberately unlike the lowercase-hyphenated shape people type
 * for free-form thread tags, so built-in and custom are distinguishable at a glance.
 */

/** Message acts are never rendered — the classifier writes them, nothing displays them. */
export interface ActEntry {
  name: string;
  /** One-line definition, used to generate the classifier prompt. */
  description: string;
}

export interface VocabularyEntry extends ActEntry {
  label: string;
  color: string;
}

/**
 * What a message creates going forward. A message carries exactly one of these — when it
 * performs several acts, the strongest wins. Order here IS the precedence, strongest first.
 */
export const MESSAGE_ACTS: readonly ActEntry[] = [
  {
    name: 'DECISION',
    description:
      'A choice among alternatives is made or announced by someone with authority to make it, binding what happens next.',
  },
  {
    name: 'COMMITMENT',
    description:
      'A specific person takes on a specific obligation, optionally with a deadline.',
  },
  {
    name: 'ESCALATION',
    description:
      'Raises urgency, severity or visibility: pulls in more senior people, or flags that something is stuck and needs intervention.',
  },
  {
    name: 'QUESTION',
    description:
      'The sender wants information or a response. Creates an open expectation: someone now owes an answer.',
  },
  {
    name: 'RESOLUTION',
    description:
      'Declares a piece of work finished or a problem no longer present. The claim of doneness, not the proof.',
  },
  {
    name: 'STATUS_UPDATE',
    description:
      'Reports progress or state of ongoing work without completing it or creating anything new.',
  },
  {
    name: 'ANSWER',
    description:
      'Supplies the information an earlier question asked for, and creates nothing new.',
  },
];

/**
 * How a thread is classified, on two independent axes that share this one vocabulary.
 *
 * The first seven are OUTCOME types — what "done" would mean for the thread. A thread
 * carries exactly one.
 *
 * The rest are ANSWER types — what question the thread's content answers for someone who
 * was never in it. A thread carries any number, and most carry none: the bar is that a
 * reader could get their question answered by this thread alone, so tag what it answers,
 * not what it discusses.
 *
 * The two are independent — a thread can be an ISSUE whose resolution is also a HOW_TO.
 * Descriptions are prompt copy, so the "not" clauses matter as much as the definitions:
 * near-misses are what the classifier gets wrong, and each one here is load-bearing.
 */
export const THREAD_TYPES: readonly VocabularyEntry[] = [
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

  // ─── Answer types — what a reader could learn from this thread ──────────────
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

/**
 * Sentinel the classifier may return for a message that performs no act. Deliberately NOT
 * in MESSAGE_ACTS: it is never stored and never rendered, it is mapped to an empty act
 * list. Asking the model to name a value is more reliable than asking it for [].
 */
export const NO_ACT = 'NONE';

/**
 * Tag names as a const tuple, strongest act first. Exported separately from MESSAGE_ACTS
 * because Zod's z.enum needs a literal tuple, and because precedence ordering is derived
 * from this array's order rather than stored on each entry.
 */
export const MESSAGE_ACT_NAMES = [
  'DECISION',
  'COMMITMENT',
  'ESCALATION',
  'QUESTION',
  'RESOLUTION',
  'STATUS_UPDATE',
  'ANSWER',
] as const;

/**
 * Thread types as a const tuple — z.enum needs a literal tuple. Order is display order, and
 * it is also the chip sort order via `rank()` in both mutator copies, so outcome types stay
 * first and answer types trail them.
 */
export const THREAD_TYPE_NAMES = [
  'ISSUE',
  'ALERT',
  'QUESTION',
  'REQUEST',
  'FEATURE_REQUEST',
  'DISCUSSION',
  'ANNOUNCEMENT',
  'HOW_TO',
  'WHAT_HAPPENED',
  'WHY_DECISION',
  'WHAT_IS',
  'KNOWN_ISSUE',
  'REFERENCE',
  'EXAMPLE',
  'POLICY_LIMIT',
] as const;

/** Built-in thread type by name; undefined for a free-form tag. */
export const threadTypeEntry = (name: string): VocabularyEntry | undefined =>
  THREAD_TYPES.find(entry => entry.name === name);
