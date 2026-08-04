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
 * What "done" would mean for a thread. A thread carries exactly one of these.
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
    description: 'One-to-many broadcast; nothing is owed by anyone. No done state.',
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

/** Thread types as a const tuple — z.enum needs a literal tuple. Order is display order. */
export const THREAD_TYPE_NAMES = [
  'ISSUE',
  'ALERT',
  'QUESTION',
  'REQUEST',
  'FEATURE_REQUEST',
  'DISCUSSION',
  'ANNOUNCEMENT',
] as const;

/** Built-in thread type by name; undefined for a free-form tag. */
export const threadTypeEntry = (name: string): VocabularyEntry | undefined =>
  THREAD_TYPES.find(entry => entry.name === name);
