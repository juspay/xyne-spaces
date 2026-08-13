import type {
  DigitalTwinCandidate,
  DigitalTwinEstimate,
  DigitalTwinMemoryFile,
  DigitalTwinMemoryFilesResponse,
  DigitalTwinMetrics,
  DigitalTwinStatus,
  DigitalTwinSubsystemEdge,
  DigitalTwinSubsystemNode,
  MemoryBankMemory,
  MemoryBankStats,
  MemoryRange,
  PipelineEventDetail,
  PipelineEventFilters,
  PipelineRecordPreview,
  PipelineEventSummary,
  PipelineEventsPage,
  RecallResult,
} from './digitalTwinTypes';

const DEMO_STORAGE_KEY = 'xyne.digital-twin.demo';

const isoAgo = (days: number, hours = 0): string =>
  new Date(Date.now() - (days * 24 + hours) * 60 * 60 * 1000).toISOString();

const wait = async <T>(value: T): Promise<T> => {
  await new Promise(resolve => window.setTimeout(resolve, 120));
  return value;
};

export const isDigitalTwinDemoMode = (): boolean => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  const requested = new URLSearchParams(window.location.search).get('demo');
  try {
    if (requested === 'digital-twin' || requested === '1') {
      window.sessionStorage.setItem(DEMO_STORAGE_KEY, 'demo');
      return true;
    }
    if (requested === '0' || requested === 'live') {
      window.sessionStorage.setItem(DEMO_STORAGE_KEY, 'live');
      return false;
    }
    const storedMode = window.sessionStorage.getItem(DEMO_STORAGE_KEY);
    if (storedMode === 'live') return false;
    if (storedMode === 'demo') return true;
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  } catch {
    if (requested === '0' || requested === 'live') return false;
    return (
      requested === 'digital-twin' ||
      requested === '1' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
  }
};

export const exitDigitalTwinDemoMode = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(DEMO_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in a locked-down browser; navigation still clears the query flag.
  }
  window.location.assign(`${window.location.pathname}?demo=live`);
};

interface AdditionalMemorySeed {
  title: string;
  subsystem: string;
  category: string;
  content: string;
  daysAgo: number;
  recallHits7d: number;
  tags: string[];
}

const additionalMemorySeeds: AdditionalMemorySeed[] = [
  {
    title: 'Decision-first status updates',
    subsystem: 'style',
    category: 'communication',
    content:
      'In project updates, state the decision or current outcome first, then add supporting context and unresolved questions.',
    daysAgo: 32,
    recallHits7d: 12,
    tags: ['status-updates', 'writing-style'],
  },
  {
    title: 'One question at a time',
    subsystem: 'style',
    category: 'communication',
    content:
      'When clarification is required, ask one focused question at a time and explain what decision the answer will unlock.',
    daysAgo: 35,
    recallHits7d: 8,
    tags: ['clarification', 'collaboration'],
  },
  {
    title: 'Action-first meeting summaries',
    subsystem: 'style',
    category: 'communication',
    content:
      'Meeting summaries should begin with decisions, owners, and due dates before recounting the discussion.',
    daysAgo: 39,
    recallHits7d: 10,
    tags: ['meeting-notes', 'summaries'],
  },
  {
    title: 'Calibrated certainty',
    subsystem: 'style',
    category: 'communication',
    content:
      'Separate verified facts from inferences, and state uncertainty plainly instead of presenting a likely explanation as confirmed.',
    daysAgo: 43,
    recallHits7d: 7,
    tags: ['trust', 'uncertainty'],
  },
  {
    title: 'Specific review comments',
    subsystem: 'style',
    category: 'communication',
    content:
      'Review feedback should name the affected element, explain the user impact, and propose a concrete adjustment.',
    daysAgo: 47,
    recallHits7d: 6,
    tags: ['design-review', 'feedback'],
  },
  {
    title: 'Memory contract reviewer',
    subsystem: 'relationships',
    category: 'people',
    content:
      'Rohan reviews backend contract changes for the memory pipeline and should be included before response shapes are finalized.',
    daysAgo: 50,
    recallHits7d: 9,
    tags: ['backend', 'ownership'],
  },
  {
    title: 'Search relevance partner',
    subsystem: 'relationships',
    category: 'people',
    content:
      'Anika is the primary partner for relevance evaluation, ranking quality, and recall-result interpretation.',
    daysAgo: 54,
    recallHits7d: 5,
    tags: ['search', 'relevance'],
  },
  {
    title: 'Release coordination owner',
    subsystem: 'relationships',
    category: 'people',
    content:
      'Sofia coordinates release readiness and should be notified when a change alters rollout sequencing or acceptance criteria.',
    daysAgo: 58,
    recallHits7d: 4,
    tags: ['release', 'coordination'],
  },
  {
    title: 'Accessibility review partner',
    subsystem: 'relationships',
    category: 'people',
    content:
      'Ishaan reviews keyboard flows, focus behavior, and screen-reader semantics for high-impact interface changes.',
    daysAgo: 62,
    recallHits7d: 6,
    tags: ['accessibility', 'review'],
  },
  {
    title: 'Customer research liaison',
    subsystem: 'relationships',
    category: 'people',
    content:
      'Meera connects the product team with customer-research sessions and maintains the synthesis of recurring user concerns.',
    daysAgo: 66,
    recallHits7d: 3,
    tags: ['research', 'customers'],
  },
  {
    title: 'Platform escalation owner',
    subsystem: 'relationships',
    category: 'people',
    content:
      'Arjun owns platform escalations involving workspace identity, permissions, or environment configuration.',
    daysAgo: 70,
    recallHits7d: 2,
    tags: ['platform', 'escalation'],
  },
  {
    title: 'Server-side memory search',
    subsystem: 'decisions',
    category: 'decisions',
    content:
      'Memory search and subsystem filtering run against the complete server-side collection rather than only the loaded page.',
    daysAgo: 74,
    recallHits7d: 11,
    tags: ['search', 'pagination'],
  },
  {
    title: 'Inline source history',
    subsystem: 'decisions',
    category: 'decisions',
    content:
      'Source history opens within the memory list so provenance remains connected to the knowledge it supports.',
    daysAgo: 78,
    recallHits7d: 9,
    tags: ['provenance', 'source-trail'],
  },
  {
    title: 'Fifty-memory page size',
    subsystem: 'decisions',
    category: 'decisions',
    content:
      'The memory library requests fifty records per page and loads subsequent pages as the user reaches the end of the list.',
    daysAgo: 82,
    recallHits7d: 4,
    tags: ['pagination', 'performance'],
  },
  {
    title: 'Authoritative backfill status',
    subsystem: 'decisions',
    category: 'decisions',
    content:
      'The client displays the backend-normalized backfill state and uses the backend 120-second stall determination.',
    daysAgo: 86,
    recallHits7d: 7,
    tags: ['backfill', 'status'],
  },
  {
    title: 'Persona loading limit',
    subsystem: 'decisions',
    category: 'decisions',
    content:
      'A maximum of three persona files may be loaded into the prompt at one time, with ten thousand characters allowed per file.',
    daysAgo: 90,
    recallHits7d: 5,
    tags: ['persona', 'limits'],
  },
  {
    title: 'Learned reply behavior',
    subsystem: 'decisions',
    category: 'decisions',
    content:
      'The default reply policy is learned behavior; users may explicitly switch to replying to every mention in Settings.',
    daysAgo: 94,
    recallHits7d: 3,
    tags: ['reply-policy', 'settings'],
  },
  {
    title: 'Memory library rollout',
    subsystem: 'projects',
    category: 'projects',
    content:
      'The memory-library rollout covers server search, knowledge-area filters, source trails, deletion confirmation, and infinite loading.',
    daysAgo: 98,
    recallHits7d: 8,
    tags: ['memory-library', 'rollout'],
  },
  {
    title: 'Persona editor scope',
    subsystem: 'projects',
    category: 'projects',
    content:
      'The Persona workspace includes soul, people, projects, playbook, and expertise files with explicit save and rebuild actions.',
    daysAgo: 102,
    recallHits7d: 6,
    tags: ['persona', 'editor'],
  },
  {
    title: 'Activity timeline scope',
    subsystem: 'projects',
    category: 'projects',
    content:
      'The Activity experience exposes learning runs, source records, curator outcomes, duration, status, and retryable errors.',
    daysAgo: 106,
    recallHits7d: 5,
    tags: ['activity', 'pipeline'],
  },
  {
    title: 'Knowledge map list view',
    subsystem: 'projects',
    category: 'projects',
    content:
      'The Knowledge Map opens with an accessible subsystem list; the visual graph is an optional inspection mode.',
    daysAgo: 110,
    recallHits7d: 4,
    tags: ['knowledge-map', 'accessibility'],
  },
  {
    title: 'Local demo baseline',
    subsystem: 'projects',
    category: 'projects',
    content:
      'Local development uses a populated Digital Twin demo so every primary state and navigation path can be reviewed without backend setup.',
    daysAgo: 114,
    recallHits7d: 3,
    tags: ['demo', 'local-development'],
  },
  {
    title: 'Reuse established components',
    subsystem: 'preferences',
    category: 'preferences',
    content:
      'Use existing Xyne components and interaction patterns whenever the product already has a suitable established construct.',
    daysAgo: 118,
    recallHits7d: 10,
    tags: ['design-system', 'consistency'],
  },
  {
    title: 'Preserve focused changes',
    subsystem: 'preferences',
    category: 'preferences',
    content:
      'Keep unrelated uncommitted work untouched when implementing a focused change in a shared working tree.',
    daysAgo: 122,
    recallHits7d: 7,
    tags: ['engineering', 'collaboration'],
  },
  {
    title: 'Review in the live shell',
    subsystem: 'preferences',
    category: 'preferences',
    content:
      'Evaluate interface changes inside the live Agent Hub shell because isolated component previews can hide hierarchy and density problems.',
    daysAgo: 126,
    recallHits7d: 8,
    tags: ['prototyping', 'review'],
  },
  {
    title: 'Explicit destructive copy',
    subsystem: 'preferences',
    category: 'preferences',
    content:
      'Confirm destructive operations independently and state exactly what will be removed, especially when the backend has no undo.',
    daysAgo: 130,
    recallHits7d: 6,
    tags: ['safety', 'content-design'],
  },
  {
    title: 'Quiet default density',
    subsystem: 'preferences',
    category: 'preferences',
    content:
      'Prefer calm surfaces, hairline separators, and compact metadata over nested cards, decorative metrics, or heavy visual effects.',
    daysAgo: 134,
    recallHits7d: 5,
    tags: ['visual-design', 'density'],
  },
  {
    title: 'Accessible graph fallback',
    subsystem: 'expertise',
    category: 'expertise',
    content:
      'Any node-link visualization needs an equivalent list or table that exposes the same relationships without relying on color or pointer input.',
    daysAgo: 138,
    recallHits7d: 7,
    tags: ['accessibility', 'data-visualization'],
  },
  {
    title: 'Debounced server search',
    subsystem: 'expertise',
    category: 'expertise',
    content:
      'Debounce query input before requesting server-filtered results, while keeping the visible search field immediately responsive.',
    daysAgo: 142,
    recallHits7d: 9,
    tags: ['search', 'performance'],
  },
  {
    title: 'Optimistic mutation rollback',
    subsystem: 'expertise',
    category: 'expertise',
    content:
      'Optimistic approval and rejection should restore the previous item when the request fails and provide an obvious retry action.',
    daysAgo: 146,
    recallHits7d: 6,
    tags: ['state-management', 'errors'],
  },
  {
    title: 'Theme parity review',
    subsystem: 'expertise',
    category: 'expertise',
    content:
      'Visual QA must cover Classic, Summer Breeze, and Midnight because semantic tokens can produce different contrast and hierarchy in each theme.',
    daysAgo: 150,
    recallHits7d: 4,
    tags: ['themes', 'quality-assurance'],
  },
  {
    title: 'Persistent background work',
    subsystem: 'expertise',
    category: 'expertise',
    content:
      'Background synthesis, backfill, and deletion jobs should remain visible across route changes and announce completion without demanding attention.',
    daysAgo: 154,
    recallHits7d: 5,
    tags: ['background-jobs', 'status'],
  },
  {
    title: 'Desktop support boundary',
    subsystem: 'context',
    category: 'world',
    content:
      'The Digital Twin replacement is desktop-first with 1024 pixels as the minimum supported viewport for the full workspace.',
    daysAgo: 158,
    recallHits7d: 3,
    tags: ['responsive', 'desktop'],
  },
  {
    title: 'Agent Hub is the primary shell',
    subsystem: 'context',
    category: 'world',
    content:
      'Digital Twin is one workspace inside Agent Hub and should inherit its navigation, themes, controls, and interaction conventions.',
    daysAgo: 162,
    recallHits7d: 6,
    tags: ['agent-hub', 'navigation'],
  },
  {
    title: 'Private DMs stay excluded',
    subsystem: 'context',
    category: 'world',
    content:
      'Digital Twin learning remains scoped per user and does not ingest private direct messages.',
    daysAgo: 166,
    recallHits7d: 2,
    tags: ['privacy', 'scope'],
  },
  {
    title: 'Backfill stall threshold',
    subsystem: 'context',
    category: 'world',
    content:
      'A backfill is considered stalled when its authoritative backend status has not advanced for 120 seconds.',
    daysAgo: 170,
    recallHits7d: 4,
    tags: ['backfill', 'operations'],
  },
  {
    title: 'Digital Twin implementation brief',
    subsystem: 'docs',
    category: 'documents',
    content:
      'The implementation brief maps shipped Digital Twin capabilities to the replacement information architecture and preserved deep links.',
    daysAgo: 174,
    recallHits7d: 5,
    tags: ['implementation-brief', 'requirements'],
  },
  {
    title: 'Memory card design reference',
    subsystem: 'docs',
    category: 'documents',
    content:
      'The approved Figma memory construct pairs a knowledge-area header with a concise memory summary and an inspectable source trail.',
    daysAgo: 178,
    recallHits7d: 7,
    tags: ['figma', 'memory-card'],
  },
  {
    title: 'Persona file constraints',
    subsystem: 'docs',
    category: 'documents',
    content:
      'The persona specification defines five editable files, a three-file prompt-loading cap, and a ten-thousand-character limit per file.',
    daysAgo: 182,
    recallHits7d: 3,
    tags: ['persona', 'specification'],
  },
  {
    title: 'Digital Twin acceptance checklist',
    subsystem: 'docs',
    category: 'documents',
    content:
      'The acceptance checklist covers themes, keyboard navigation, reduced motion, long content, empty states, API failures, and complete user journeys.',
    daysAgo: 186,
    recallHits7d: 4,
    tags: ['acceptance', 'quality-assurance'],
  },
  {
    title: 'Weekly synthesis habit',
    subsystem: 'preferences',
    category: 'preferences',
    content:
      'Run a short weekly synthesis of open decisions and people updates so the Twin stays current without waiting for a large backfill.',
    daysAgo: 210,
    recallHits7d: 6,
    tags: ['habits', 'synthesis'],
  },
  {
    title: 'Incident postmortems are durable memory',
    subsystem: 'expertise',
    category: 'expertise',
    content:
      'Capture incident postmortems as durable context: trigger, blast radius, mitigation, and the follow-up owner. Prefer facts that will still matter in six months.',
    daysAgo: 240,
    recallHits7d: 5,
    tags: ['incidents', 'postmortems'],
  },
  {
    title: 'Release notes voice',
    subsystem: 'style',
    category: 'communication',
    content:
      'Release notes should name the user-visible change first, then rollout timing, then known limitations. Avoid internal ticket IDs in customer-facing copy.',
    daysAgo: 270,
    recallHits7d: 8,
    tags: ['releases', 'writing-style'],
  },
  {
    title: 'Spaces onboarding cohort',
    subsystem: 'projects',
    category: 'projects',
    content:
      'The Spaces onboarding cohort for new hires focuses on channels, boards, calls, and Ask AI in the first two weeks, with a buddy check-in on day 10.',
    daysAgo: 300,
    recallHits7d: 3,
    tags: ['onboarding', 'enablement'],
  },
  {
    title: 'Twin enablement anniversary',
    subsystem: 'context',
    category: 'world',
    content:
      'Digital Twin was enabled for this workspace nearly a year ago; treat early memories as historical context and prefer fresher evidence when guidance conflicts.',
    daysAgo: 330,
    recallHits7d: 2,
    tags: ['history', 'enablement'],
  },
  {
    title: 'Cross-team design critiques',
    subsystem: 'people',
    category: 'people',
    content:
      'Invite design, product, and eng leads to critiques when a change affects navigation or shared components; document the decision owner in the canvas.',
    daysAgo: 350,
    recallHits7d: 4,
    tags: ['critiques', 'collaboration'],
  },
];

const initialMemories = (): MemoryBankMemory[] => [
  {
    id: 'memory-1',
    hindsightMemoryId: 'demo-memory-1',
    title: 'Launch note structure',
    category: 'communication',
    content:
      'For customer-facing launch notes, lead with the change people will notice and why it matters to them. Keep implementation detail below the fold, then close with a named owner, the next step, and any action required from the reader.',
    curatorReasoning:
      'This pattern appeared consistently across launch reviews and was explicitly reinforced in two project channels.',
    curatorConfidence: 0.96,
    createdAt: isoAgo(2),
    recallHits7d: 14,
    lastRecalledAt: isoAgo(0, 3),
    pipelineEventId: 'event-daily-1',
    tags: ['subsystem:style', 'launches', 'writing-style'],
  },
  {
    id: 'memory-2',
    hindsightMemoryId: 'demo-memory-2',
    title: 'Digital Twin direction',
    category: 'projects',
    content:
      'The Digital Twin revamp should work as a calm, self-service record of personal knowledge rather than a collection of technical tools. People need to see what the Twin knows, what is waiting for review, where each memory came from, and whether background learning is still running without understanding the underlying pipeline.',
    curatorReasoning:
      'Repeated in planning notes, design reviews, and the accepted implementation brief.',
    curatorConfidence: 0.99,
    createdAt: isoAgo(4),
    recallHits7d: 11,
    lastRecalledAt: isoAgo(0, 8),
    pipelineEventId: 'event-backfill-1',
    tags: ['subsystem:projects', 'digital-twin', 'product-direction'],
  },
  {
    id: 'memory-3',
    hindsightMemoryId: 'demo-memory-3',
    title: 'Prototype before polish',
    category: 'working-style',
    content:
      'Build a working prototype early enough to test the product idea before visual details become expensive to change. Review it inside the real Xyne shell across themes, keyboard navigation, long content, and failure states before polishing isolated edge cases.',
    curatorReasoning:
      'Derived from several product discussions where an interactive preview was requested before final review.',
    curatorConfidence: 0.93,
    createdAt: isoAgo(7),
    recallHits7d: 9,
    lastRecalledAt: isoAgo(1),
    pipelineEventId: 'event-call-1',
    tags: ['subsystem:preferences', 'prototyping', 'collaboration'],
  },
  {
    id: 'memory-4',
    hindsightMemoryId: 'demo-memory-4',
    title: 'Design system ownership',
    category: 'people',
    content:
      'Maya owns the shared design-system rollout and should review changes that introduce reusable components, alter global tokens, or establish a new interaction pattern. Bring her in before implementation is finalized so the pattern can serve the wider product instead of becoming a one-off.',
    curatorReasoning: 'Ownership was stated directly and confirmed by repeated review assignments.',
    curatorConfidence: 0.91,
    createdAt: isoAgo(10),
    recallHits7d: 7,
    lastRecalledAt: isoAgo(2),
    pipelineEventId: 'event-backfill-1',
    tags: ['subsystem:relationships', 'design-system', 'ownership'],
  },
  {
    id: 'memory-5',
    hindsightMemoryId: 'demo-memory-5',
    title: 'Bulk action confirmation',
    category: 'decisions',
    content:
      'Destructive bulk actions require a confirmation that names the operation and states the exact number of affected records. Approval, deletion, and disabling must be confirmed independently because these operations have different consequences and the backend may not provide an undo.',
    curatorReasoning: 'Captured from the approved Digital Twin interaction requirements.',
    curatorConfidence: 0.98,
    createdAt: isoAgo(13),
    recallHits7d: 6,
    lastRecalledAt: isoAgo(3),
    pipelineEventId: 'event-canvas-1',
    tags: ['subsystem:decisions', 'safety', 'interaction-design'],
  },
  {
    id: 'memory-6',
    hindsightMemoryId: 'demo-memory-6',
    title: 'UI review checklist',
    category: 'expertise',
    content:
      'A strong UI review evaluates hierarchy, information architecture, accessibility, responsive behavior, and every loading, empty, success, and error state. It should also explain whether the experience feels native to its surrounding product and identify the user risk behind each requested change.',
    curatorReasoning:
      'Synthesized from repeated critique criteria used in design and implementation reviews.',
    curatorConfidence: 0.94,
    createdAt: isoAgo(18),
    recallHits7d: 5,
    lastRecalledAt: isoAgo(4),
    pipelineEventId: 'event-synthesis-1',
    tags: ['subsystem:expertise', 'ui-review', 'accessibility'],
  },
  {
    id: 'memory-7',
    hindsightMemoryId: 'demo-memory-7',
    title: 'Consequential action labels',
    category: 'preferences',
    content:
      'Use concise, plain-language labels for consequential actions so people know exactly what will happen before they act. Icons may reinforce a label, but they should never be the only explanation for approving, rejecting, deleting, pausing, or disabling something.',
    curatorReasoning: 'Consistent preference across navigation, approval, and deletion feedback.',
    curatorConfidence: 0.97,
    createdAt: isoAgo(22),
    recallHits7d: 4,
    lastRecalledAt: isoAgo(5),
    pipelineEventId: null,
    tags: ['subsystem:preferences', 'content-design', 'accessibility'],
  },
  {
    id: 'memory-8',
    hindsightMemoryId: 'demo-memory-8',
    title: 'Agent Hub navigation',
    category: 'projects',
    content:
      'The Agent Hub shell remains the primary navigation and visual frame for Digital Twin. Memories, Review, Persona, and Activity belong in one horizontal workspace navigation, while diagnostic tools stay in an Inspect menu instead of introducing a competing sidebar.',
    curatorReasoning:
      'Recorded as a durable product-architecture decision during the navigation redesign.',
    curatorConfidence: 0.99,
    createdAt: isoAgo(29),
    recallHits7d: 3,
    lastRecalledAt: isoAgo(6),
    pipelineEventId: 'event-canvas-1',
    tags: ['subsystem:projects', 'navigation', 'agent-hub'],
  },
  ...additionalMemorySeeds.map((seed, index) => {
    const memoryNumber = index + 9;
    const pipelineEventIds = [
      'event-daily-1',
      'event-backfill-1',
      'event-call-1',
      'event-canvas-1',
      'event-synthesis-1',
      null,
    ];

    return {
      id: `memory-${memoryNumber}`,
      hindsightMemoryId: `demo-memory-${memoryNumber}`,
      title: seed.title,
      category: seed.category,
      content: seed.content,
      curatorReasoning:
        'Retained after the same guidance appeared across multiple project records and review conversations.',
      curatorConfidence: Math.max(0.82, 0.96 - (index % 7) * 0.02),
      createdAt: isoAgo(seed.daysAgo),
      recallHits7d: seed.recallHits7d,
      lastRecalledAt:
        seed.recallHits7d > 0 ? isoAgo(Math.min(seed.daysAgo, (index % 7) + 1)) : null,
      pipelineEventId: pipelineEventIds[index % pipelineEventIds.length] ?? null,
      tags: [`subsystem:${seed.subsystem}`, ...seed.tags],
    } satisfies MemoryBankMemory;
  }),
];

const initialCandidates = (): DigitalTwinCandidate[] => [
  {
    id: 'candidate-1',
    subsystem: 'style',
    title: 'Decision-first status updates',
    text: 'In status updates, state the decision first and put supporting detail afterward.',
    editedText: null,
    sourceRefs: [
      { type: 'message', id: 'message-431', channelId: 'product-design', ts: isoAgo(1, 2) },
      { type: 'call', id: 'call-88', ts: isoAgo(2, 4) },
    ],
    signalScore: 0.94,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(1),
  },
  {
    id: 'candidate-2',
    subsystem: 'style',
    title: 'Launch notes for users',
    text: 'Avoid announcing implementation details as outcomes; describe the user-facing change.',
    editedText: null,
    sourceRefs: [{ type: 'message', id: 'message-455', channelId: 'launch-review', ts: isoAgo(2) }],
    signalScore: 0.88,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(2),
  },
  {
    id: 'candidate-17',
    subsystem: 'style',
    title: 'Keep source trails visible',
    text: 'When summarizing retained knowledge, keep the original source trail visible so reviewers can verify why it was kept.',
    editedText: null,
    sourceRefs: [
      { type: 'message', id: 'message-562', channelId: 'digital-twin', ts: isoAgo(1, 6) },
      { type: 'call', id: 'call-104', ts: isoAgo(2, 1) },
    ],
    signalScore: 0.91,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(1, 5),
  },
  {
    id: 'candidate-18',
    subsystem: 'style',
    title: 'Reuse established patterns',
    text: 'Prefer existing Agent Hub components and wording whenever the product already has an established pattern.',
    editedText: null,
    sourceRefs: [
      { type: 'message', id: 'message-563', channelId: 'product-design', ts: isoAgo(2, 3) },
    ],
    signalScore: 0.86,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(2, 2),
  },
  {
    id: 'candidate-3',
    subsystem: 'expertise',
    title: 'UI review checklist',
    text: 'Strong UI reviews should cover hierarchy, information architecture, accessibility, state handling, and whether the experience feels native to its surrounding product.',
    editedText: null,
    sourceRefs: [
      { type: 'call', id: 'call-91', ts: isoAgo(2, 5) },
      { type: 'canvas', id: 'canvas-22', ts: isoAgo(3) },
    ],
    signalScore: 0.96,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(2),
  },
  {
    id: 'candidate-4',
    subsystem: 'expertise',
    title: 'Prototype evaluation',
    text: 'Evaluate a working prototype in the real Agent Hub shell before polishing edge cases or introducing new component patterns.',
    editedText: null,
    sourceRefs: [
      { type: 'message', id: 'message-467', channelId: 'product-design', ts: isoAgo(3, 4) },
    ],
    signalScore: 0.91,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(3),
  },
  {
    id: 'candidate-19',
    subsystem: 'expertise',
    title: 'Motion review criteria',
    text: 'Motion reviews should check duration, easing, reduced-motion fallbacks, and whether animation clarifies hierarchy instead of adding noise.',
    editedText: null,
    sourceRefs: [
      { type: 'call', id: 'call-105', ts: isoAgo(3, 2) },
      { type: 'canvas', id: 'canvas-41', ts: isoAgo(3, 6) },
    ],
    signalScore: 0.89,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(3, 1),
  },
  {
    id: 'candidate-5',
    subsystem: 'projects',
    title: 'Digital Twin viewport support',
    text: 'The desktop-first Digital Twin redesign supports viewports from 1024px upward.',
    editedText: null,
    sourceRefs: [
      { type: 'canvas', id: 'canvas-19', ts: isoAgo(3) },
      { type: 'message', id: 'message-390', channelId: 'digital-twin', ts: isoAgo(3, 2) },
    ],
    signalScore: 0.97,
    status: 'pending',
    source: 'backfill',
    createdAt: isoAgo(3),
  },
  {
    id: 'candidate-6',
    subsystem: 'projects',
    title: 'Agent Hub navigation',
    text: 'Digital Twin tools should remain inside the Agent Hub shell instead of introducing a competing sidebar or navigation model.',
    editedText: null,
    sourceRefs: [
      { type: 'canvas', id: 'canvas-24', ts: isoAgo(4) },
      { type: 'message', id: 'message-482', channelId: 'agent-hub', ts: isoAgo(4, 2) },
    ],
    signalScore: 0.95,
    status: 'pending',
    source: 'backfill',
    createdAt: isoAgo(4),
  },
  {
    id: 'candidate-20',
    subsystem: 'projects',
    title: 'Review queue scope',
    text: 'The Review tab should stay focused on pending proposals; diagnostics belong under Inspect rather than competing for primary navigation space.',
    editedText: null,
    sourceRefs: [
      { type: 'message', id: 'message-570', channelId: 'digital-twin', ts: isoAgo(4, 5) },
      { type: 'canvas', id: 'canvas-42', ts: isoAgo(5) },
    ],
    signalScore: 0.9,
    status: 'pending',
    source: 'backfill',
    createdAt: isoAgo(4, 4),
  },
  {
    id: 'candidate-21',
    subsystem: 'projects',
    title: 'Details-first twin profile',
    text: 'Profile and persona editing should lead the Digital Twin experience so users understand how the Twin represents them before managing memories.',
    editedText: null,
    sourceRefs: [
      { type: 'call', id: 'call-106', ts: isoAgo(5, 2) },
      { type: 'message', id: 'message-571', channelId: 'product-design', ts: isoAgo(5, 4) },
    ],
    signalScore: 0.87,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(5, 1),
  },
  {
    id: 'candidate-7',
    subsystem: 'relationships',
    title: 'Memory pipeline reviewer',
    text: 'Rohan reviews backend contract changes for the memory pipeline.',
    editedText: null,
    sourceRefs: [{ type: 'call', id: 'call-73', ts: isoAgo(5) }],
    signalScore: 0.82,
    status: 'pending',
    source: 'backfill',
    createdAt: isoAgo(5),
  },
  {
    id: 'candidate-8',
    subsystem: 'relationships',
    title: 'Design system ownership',
    text: 'Maya owns the shared design-system rollout and should be included when a feature adds a reusable component or changes a global token.',
    editedText: null,
    sourceRefs: [
      { type: 'message', id: 'message-496', channelId: 'design-system', ts: isoAgo(5, 3) },
    ],
    signalScore: 0.9,
    status: 'pending',
    source: 'backfill',
    createdAt: isoAgo(5),
  },
  {
    id: 'candidate-22',
    subsystem: 'relationships',
    title: 'Agent Hub product partner',
    text: 'Nina is the product partner for Agent Hub and Digital Twin journeys and should be looped in on navigation or labeling changes.',
    editedText: null,
    sourceRefs: [
      { type: 'message', id: 'message-572', channelId: 'agent-hub', ts: isoAgo(6, 1) },
      { type: 'call', id: 'call-107', ts: isoAgo(6, 3) },
    ],
    signalScore: 0.88,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(6),
  },
  {
    id: 'candidate-9',
    subsystem: 'preferences',
    title: 'Preserve focused changes',
    text: 'Keep unrelated uncommitted changes untouched during focused implementation work.',
    editedText: null,
    sourceRefs: [{ type: 'message', id: 'message-322', channelId: 'engineering', ts: isoAgo(6) }],
    signalScore: 0.92,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(6),
  },
  {
    id: 'candidate-10',
    subsystem: 'preferences',
    title: 'Consequential action labels',
    text: 'Use concise, plain-language labels for consequential actions; icons may support the label but should not replace it.',
    editedText: null,
    sourceRefs: [
      { type: 'message', id: 'message-507', channelId: 'product-design', ts: isoAgo(7) },
    ],
    signalScore: 0.89,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(7),
  },
  {
    id: 'candidate-23',
    subsystem: 'preferences',
    title: 'Confirm before bulk writes',
    text: 'Prefer an explicit confirmation step before bulk-writing memories so users can verify the exact set being approved.',
    editedText: null,
    sourceRefs: [
      { type: 'canvas', id: 'canvas-43', ts: isoAgo(7, 2) },
      { type: 'message', id: 'message-573', channelId: 'digital-twin', ts: isoAgo(7, 4) },
    ],
    signalScore: 0.93,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(7, 1),
  },
  {
    id: 'candidate-24',
    subsystem: 'preferences',
    title: 'Active filter indicators',
    text: 'When a list filter is active, show a small primary indicator on the control so the narrowed state remains obvious at a glance.',
    editedText: null,
    sourceRefs: [
      { type: 'message', id: 'message-574', channelId: 'product-design', ts: isoAgo(8, 1) },
    ],
    signalScore: 0.85,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(8),
  },
  {
    id: 'candidate-11',
    subsystem: 'decisions',
    title: 'Bulk approval confirmation',
    text: 'Bulk approvals should require a confirmation that states the exact number of memories that will be added.',
    editedText: null,
    sourceRefs: [{ type: 'canvas', id: 'canvas-27', ts: isoAgo(8) }],
    signalScore: 0.98,
    status: 'pending',
    source: 'backfill',
    createdAt: isoAgo(8),
  },
  {
    id: 'candidate-12',
    subsystem: 'decisions',
    title: 'Source trail visibility',
    text: 'A retained memory should explain why it was kept without forcing the user to leave the memory list.',
    editedText: null,
    sourceRefs: [
      { type: 'message', id: 'message-521', channelId: 'digital-twin', ts: isoAgo(9) },
      { type: 'call', id: 'call-96', ts: isoAgo(9, 3) },
    ],
    signalScore: 0.93,
    status: 'pending',
    source: 'backfill',
    createdAt: isoAgo(9),
  },
  {
    id: 'candidate-25',
    subsystem: 'decisions',
    title: 'Disable stays in Settings',
    text: 'Disabling the Twin belongs in Settings data controls, not in everyday header actions where it can be triggered accidentally.',
    editedText: null,
    sourceRefs: [
      { type: 'message', id: 'message-575', channelId: 'digital-twin', ts: isoAgo(9, 2) },
      { type: 'canvas', id: 'canvas-44', ts: isoAgo(10) },
    ],
    signalScore: 0.91,
    status: 'pending',
    source: 'backfill',
    createdAt: isoAgo(9, 1),
  },
  {
    id: 'candidate-13',
    subsystem: 'docs',
    title: 'Working notes structure',
    text: 'Working notes should separate decisions, open questions, and follow-up owners so the durable context is easy to review later.',
    editedText: null,
    sourceRefs: [{ type: 'canvas', id: 'canvas-31', ts: isoAgo(10) }],
    signalScore: 0.87,
    status: 'pending',
    source: 'upload',
    createdAt: isoAgo(10),
  },
  {
    id: 'candidate-14',
    subsystem: 'docs',
    title: 'Launch brief template',
    text: 'Launch briefs should lead with user impact, name the accountable owner, and keep implementation details below the primary decision.',
    editedText: null,
    sourceRefs: [
      { type: 'canvas', id: 'canvas-34', ts: isoAgo(11) },
      { type: 'message', id: 'message-544', channelId: 'launch-review', ts: isoAgo(11, 2) },
    ],
    signalScore: 0.92,
    status: 'pending',
    source: 'upload',
    createdAt: isoAgo(11),
  },
  {
    id: 'candidate-26',
    subsystem: 'docs',
    title: 'Reviewer handoff notes',
    text: 'Handoff notes for reviewers should include the intended outcome, known risks, and the exact surfaces that changed.',
    editedText: null,
    sourceRefs: [
      { type: 'canvas', id: 'canvas-45', ts: isoAgo(11, 3) },
      { type: 'message', id: 'message-576', channelId: 'engineering', ts: isoAgo(11, 5) },
    ],
    signalScore: 0.88,
    status: 'pending',
    source: 'upload',
    createdAt: isoAgo(11, 2),
  },
  {
    id: 'candidate-15',
    subsystem: 'context',
    title: 'Self-service clarity',
    text: 'The Digital Twin experience should make what is known, what needs review, and where each retained memory came from understandable without operator help.',
    editedText: null,
    sourceRefs: [
      { type: 'call', id: 'call-101', ts: isoAgo(12) },
      { type: 'canvas', id: 'canvas-38', ts: isoAgo(12, 4) },
    ],
    signalScore: 0.97,
    status: 'pending',
    source: 'backfill',
    createdAt: isoAgo(12),
  },
  {
    id: 'candidate-16',
    subsystem: 'context',
    title: 'Product language continuity',
    text: 'Digital Twin controls should reuse the Agent Hub language and interaction patterns that users already understand.',
    editedText: null,
    sourceRefs: [{ type: 'message', id: 'message-558', channelId: 'agent-hub', ts: isoAgo(13) }],
    signalScore: 0.9,
    status: 'pending',
    source: 'backfill',
    createdAt: isoAgo(13),
  },
  {
    id: 'candidate-27',
    subsystem: 'context',
    title: 'Permission-aware learning',
    text: 'Learning should only use work the user is already allowed to see, and private DMs remain excluded from Twin memory intake.',
    editedText: null,
    sourceRefs: [
      { type: 'call', id: 'call-108', ts: isoAgo(13, 2) },
      { type: 'message', id: 'message-577', channelId: 'digital-twin', ts: isoAgo(14) },
    ],
    signalScore: 0.95,
    status: 'pending',
    source: 'backfill',
    createdAt: isoAgo(13, 1),
  },
  {
    id: 'candidate-28',
    subsystem: 'context',
    title: 'Everyday vs diagnostic tools',
    text: 'Everyday Twin tasks belong in primary tabs; diagnostics such as recall labs and knowledge maps stay under Inspect.',
    editedText: null,
    sourceRefs: [
      { type: 'canvas', id: 'canvas-46', ts: isoAgo(14, 2) },
      { type: 'message', id: 'message-578', channelId: 'product-design', ts: isoAgo(14, 4) },
    ],
    signalScore: 0.89,
    status: 'pending',
    source: 'daily',
    createdAt: isoAgo(14),
  },
];

const initialFiles = (): DigitalTwinMemoryFile[] => [
  {
    id: 'file-soul',
    name: 'soul.md',
    content:
      '# Voice & values\n\nBe direct, warm, and specific. Lead with the outcome, then provide the evidence needed to make a decision. Prefer calm confidence over hype.\n\n## Principles\n\n- Make complex work understandable.\n- Protect user trust.\n- Treat accessibility as part of quality.',
    loadInPrompt: true,
    sortOrder: 1,
    updatedBy: 'persona-synthesis',
    updatedAt: isoAgo(2),
  },
  {
    id: 'file-people',
    name: 'people.md',
    content:
      '# People\n\n- **Maya** — design-system owner; involve her in shared component and token changes.\n- **Rohan** — memory-pipeline backend reviewer.\n- **Nina** — product partner for Agent Hub and Digital Twin journeys.',
    loadInPrompt: true,
    sortOrder: 2,
    updatedBy: 'persona-synthesis',
    updatedAt: isoAgo(4),
  },
  {
    id: 'file-projects',
    name: 'projects.md',
    content:
      '# Active projects\n\n## Digital Twin revamp\nMake personal intelligence understandable, reviewable, and native to Xyne Spaces. Current focus: shell parity, memory provenance, and self-service persona and activity views.\n\n## Platform reliability\nOngoing work on channel pagination, call recording, and board performance. Mature usage patterns from ~10 months of Spaces adoption guide prioritization.\n\n## Customer Ops intake\nSeparate intake board for escalations; keep product work on Platform Delivery.',
    loadInPrompt: true,
    sortOrder: 3,
    updatedBy: 'persona-synthesis',
    updatedAt: isoAgo(1),
  },
  {
    id: 'file-playbook',
    name: 'playbook.md',
    content:
      '# Working style\n\n1. Start from the user journey and existing system patterns.\n2. Build a real prototype early.\n3. Validate the result in context across themes and target widths.\n4. Preserve unrelated work and call out uncertainty explicitly.\n5. After ~a year in Spaces, prefer searching existing channels and canvases before recreating context.',
    loadInPrompt: false,
    sortOrder: 4,
    updatedBy: 'persona-synthesis',
    updatedAt: isoAgo(7),
  },
  {
    id: 'file-expertise',
    name: 'expertise.md',
    content:
      '# Expertise\n\n- Product UI architecture\n- Interaction and information design\n- Accessibility review\n- Frontend implementation and system parity\n- Agentic product workflows\n- Spaces collaboration patterns accumulated over the last year (channels, boards, calls, Twin review)',
    loadInPrompt: false,
    sortOrder: 5,
    updatedBy: 'persona-synthesis',
    updatedAt: isoAgo(7),
  },
];

const event = (
  id: string,
  runType: string,
  sourceKind: string | null,
  createdAt: string,
  values: Partial<PipelineEventSummary> = {},
): PipelineEventSummary => ({
  id,
  createdAt,
  runType,
  source: sourceKind ?? 'system',
  sourceKind,
  windowFrom: isoAgo(2),
  windowTo: createdAt,
  status: 'ok',
  recordCount: 34,
  existingMemoryCount: 8,
  emittedCount: 5,
  keptCount: 3,
  candidatesCreated: 2,
  autoApproved: 0,
  durationMs: 8_420,
  error: null,
  hasTrace: true,
  approvedCount: 1,
  pendingCount: 2,
  rejectedCount: 2,
  ...values,
});

const initialEvents = (): PipelineEventSummary[] => [
  event('event-daily-1', 'daily', 'messages', isoAgo(0, 2), {
    recordCount: 42,
    candidatesCreated: 3,
    keptCount: 4,
    durationMs: 7_840,
  }),
  event('event-synthesis-1', 'synthesize', null, isoAgo(1), {
    recordCount: 8,
    emittedCount: 5,
    keptCount: 5,
    candidatesCreated: 0,
    durationMs: 12_200,
  }),
  event('event-call-1', 'daily', 'calls', isoAgo(2), {
    recordCount: 3,
    emittedCount: 2,
    keptCount: 1,
    candidatesCreated: 1,
    durationMs: 4_110,
  }),
  event('event-backfill-1', 'backfill', 'messages', isoAgo(4), {
    recordCount: 286,
    existingMemoryCount: 3,
    emittedCount: 18,
    keptCount: 11,
    candidatesCreated: 8,
    autoApproved: 3,
    durationMs: 44_780,
  }),
  event('event-canvas-1', 'backfill', 'canvases', isoAgo(8), {
    recordCount: 17,
    emittedCount: 7,
    keptCount: 4,
    candidatesCreated: 3,
    durationMs: 9_380,
  }),
  event('event-gate-1', 'gate', 'messages', isoAgo(10), {
    recordCount: 1,
    emittedCount: 1,
    keptCount: 1,
    candidatesCreated: 0,
    durationMs: 620,
  }),
  event('event-daily-30', 'daily', 'messages', isoAgo(30), {
    recordCount: 58,
    candidatesCreated: 4,
    keptCount: 3,
    durationMs: 9_120,
  }),
  event('event-call-45', 'daily', 'calls', isoAgo(45), {
    recordCount: 6,
    emittedCount: 3,
    keptCount: 2,
    candidatesCreated: 2,
    durationMs: 5_640,
  }),
  event('event-synth-60', 'synthesize', null, isoAgo(60), {
    recordCount: 22,
    emittedCount: 9,
    keptCount: 7,
    candidatesCreated: 0,
    durationMs: 18_400,
  }),
  event('event-daily-90', 'daily', 'messages', isoAgo(90), {
    recordCount: 71,
    candidatesCreated: 5,
    keptCount: 4,
    durationMs: 10_880,
  }),
  event('event-canvas-120', 'backfill', 'canvases', isoAgo(120), {
    recordCount: 41,
    emittedCount: 12,
    keptCount: 8,
    candidatesCreated: 5,
    durationMs: 16_220,
  }),
  event('event-daily-180', 'daily', 'messages', isoAgo(180), {
    recordCount: 64,
    candidatesCreated: 3,
    keptCount: 3,
    durationMs: 8_960,
  }),
  event('event-backfill-270', 'backfill', 'messages', isoAgo(270), {
    recordCount: 1_842,
    existingMemoryCount: 12,
    emittedCount: 64,
    keptCount: 39,
    candidatesCreated: 28,
    autoApproved: 9,
    durationMs: 128_400,
  }),
  event('event-enable-320', 'backfill', 'messages', isoAgo(320), {
    recordCount: 920,
    existingMemoryCount: 0,
    emittedCount: 48,
    keptCount: 31,
    candidatesCreated: 22,
    autoApproved: 6,
    durationMs: 96_200,
  }),
];

let memories = initialMemories();
let candidates = initialCandidates();
let files = initialFiles();
let events = initialEvents();
let settings: {
  responseSuffix: string;
  memoryApprovalMode: string;
  memoryAutoApproveMinScore: number;
  respondPolicy: 'always' | 'learned';
} = {
  responseSuffix: '— Sent by my Digital Twin · may contain mistakes',
  memoryApprovalMode: 'manual',
  memoryAutoApproveMinScore: 0.9,
  respondPolicy: 'learned',
};
let enabled = true;

export const demoGetStatus = (): Promise<DigitalTwinStatus> =>
  wait({
    enabled,
    enabledAt: isoAgo(320),
    backfillState: null,
    backfill: {
      overall: {
        running: false,
        paused: false,
        stalled: false,
        windowsDone: 48,
        windowsTotal: 48,
        recordsSeen: 18_640,
        candidatesMade: 312,
        pctByWindows: 100,
        updatedAt: isoAgo(0, 2),
      },
      sources: {},
    },
    pendingCandidates: candidates.filter(candidate => candidate.status === 'pending').length,
    totalCandidates: candidates.length + memories.length + 180,
    approvedCandidates: memories.length,
    memoryCount: memories.length,
    memoryDeleteInProgress: false,
    mdFileCount: files.length,
    ...settings,
  });

export const demoListMemories = async (opts: {
  limit?: number;
  offset?: number;
  subsystem?: string;
  subsystems?: string[];
  search?: string;
}): Promise<{ memories: MemoryBankMemory[]; total: number }> => {
  const search = opts.search?.trim().toLowerCase();
  const subsystemFilters = opts.subsystems?.length
    ? opts.subsystems
    : opts.subsystem
      ? [opts.subsystem]
      : [];
  const filtered = memories.filter(memory => {
    const matchesSubsystem =
      subsystemFilters.length === 0 ||
      subsystemFilters.some(subsystem => memory.tags?.includes(`subsystem:${subsystem}`) === true);
    const matchesSearch =
      !search ||
      memory.title?.toLowerCase().includes(search) === true ||
      memory.content.toLowerCase().includes(search) ||
      memory.category?.toLowerCase().includes(search) === true ||
      memory.tags?.some(tag => tag.toLowerCase().includes(search)) === true;
    return matchesSubsystem && matchesSearch;
  });
  const offset = opts.offset ?? 0;
  return wait({
    memories: filtered.slice(offset, offset + (opts.limit ?? 50)),
    total: filtered.length,
  });
};

export const demoDeleteMemory = async (hindsightMemoryId: string): Promise<void> => {
  memories = memories.filter(memory => memory.hindsightMemoryId !== hindsightMemoryId);
  await wait(undefined);
};

export const demoGetStats = (range: MemoryRange): Promise<MemoryBankStats> =>
  wait({
    range,
    totals: {
      approved: memories.length,
      pending: candidates.filter(candidate => candidate.status === 'pending').length,
      recallsInRange: memories.reduce((total, memory) => total + memory.recallHits7d, 0),
    },
    hot: [...memories]
      .sort((left, right) => right.recallHits7d - left.recallHits7d)
      .map(memory => ({
        hindsightMemoryId: memory.hindsightMemoryId,
        ...(memory.title ? { title: memory.title } : {}),
        hits: memory.recallHits7d,
        lastRecalledAt: memory.lastRecalledAt,
        content: memory.content,
        category: memory.category,
        status: 'approved',
        createdAt: memory.createdAt,
      })),
  });

export const demoRecall = (query: string): Promise<RecallResult[]> => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const ranked = [...memories]
    .map(memory => ({
      memory,
      matches: terms.filter(term => memory.content.toLowerCase().includes(term)).length,
    }))
    .sort(
      (left, right) =>
        right.matches - left.matches || right.memory.recallHits7d - left.memory.recallHits7d,
    )
    .slice(0, 5);
  return wait(
    ranked.map(({ memory, matches }, index) => ({
      id: memory.hindsightMemoryId,
      text: memory.content,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- mirrors backend recall payload
      fact_type: memory.category ?? 'memory',
      score: Math.max(0.58, 0.94 - index * 0.08 + matches * 0.01),
      ...(memory.tags ? { tags: memory.tags } : {}),
    })),
  );
};

export const demoGetGraph = (): Promise<{
  subsystems: DigitalTwinSubsystemNode[];
  edges: DigitalTwinSubsystemEdge[];
}> => {
  const subsystemNames = [
    'communication',
    'projects',
    'preferences',
    'people',
    'decisions',
    'expertise',
    'docs',
    'context',
  ];
  const subsystems = subsystemNames.map(name => {
    const matches = memories.filter(memory => memory.tags?.includes(`subsystem:${name}`));
    return {
      name,
      memoryCount: matches.length,
      sessionCount: Math.max(1, matches.length * 2),
      sampleContent: matches[0]?.content ?? '',
      lastUpdated: matches[0]?.createdAt ?? null,
    };
  });
  return wait({
    subsystems,
    edges: [
      { source: 'communication', target: 'preferences', sharedSessions: 7 },
      { source: 'projects', target: 'decisions', sharedSessions: 6 },
      { source: 'projects', target: 'people', sharedSessions: 4 },
      { source: 'expertise', target: 'preferences', sharedSessions: 3 },
      { source: 'docs', target: 'projects', sharedSessions: 5 },
      { source: 'context', target: 'decisions', sharedSessions: 4 },
    ],
  });
};

export const demoGetEstimate = (): Promise<DigitalTwinEstimate> =>
  wait({
    messages: 15_682,
    calls: 55,
    canvases: 24,
    totalRecords: 15_761,
    estCandidates: 186,
    estCostUSD: 4.72,
  });

export const demoListClusters = (): Promise<{
  clusters: Array<{
    subsystem: string;
    pending: number;
    top3: Array<{ id: string; text: string; signalScore: number }>;
  }>;
}> => {
  const groups = new Map<string, DigitalTwinCandidate[]>();
  candidates
    .filter(candidate => candidate.status === 'pending')
    .forEach(candidate =>
      groups.set(candidate.subsystem, [...(groups.get(candidate.subsystem) ?? []), candidate]),
    );
  return wait({
    clusters: [...groups.entries()].map(([subsystem, items]) => ({
      subsystem,
      pending: items.length,
      top3: items.slice(0, 3).map(candidate => ({
        id: candidate.id,
        text: candidate.editedText ?? candidate.text,
        signalScore: candidate.signalScore,
      })),
    })),
  });
};

export const demoGetCluster = (
  subsystem: string,
): Promise<{
  subsystem: string;
  candidates: DigitalTwinCandidate[];
}> =>
  wait({
    subsystem,
    candidates: candidates.filter(candidate => candidate.subsystem === subsystem),
  });

export const demoApproveCluster = async (
  subsystem: string,
  candidateIds?: string[],
): Promise<{ processing?: boolean; count?: number }> => {
  const ids = new Set(
    candidateIds ??
      candidates
        .filter(candidate => candidate.subsystem === subsystem && candidate.status === 'pending')
        .map(candidate => candidate.id),
  );
  candidates = candidates.map(candidate =>
    ids.has(candidate.id) ? { ...candidate, status: 'approved' as const } : candidate,
  );
  return wait({ processing: false, count: ids.size });
};

export const demoPatchCandidate = async (
  id: string,
  patch: { editedText?: string; status?: 'approved' | 'rejected' },
): Promise<{ id: string; status: string }> => {
  candidates = candidates.map(candidate =>
    candidate.id === id ? { ...candidate, ...patch } : candidate,
  );
  return wait({ id, status: patch.status ?? 'pending' });
};

export const demoGetMetrics = (): Promise<DigitalTwinMetrics> =>
  wait({
    total: 268,
    approvedClean: 176,
    approvedEdited: 41,
    totalApproved: 217,
    rejected: 28,
    pending: candidates.filter(candidate => candidate.status === 'pending').length,
    approvalRate: 0.89,
    editRate: 0.19,
    previousApprovalRate: 0.84,
    previousEditRate: 0.24,
    bySubsystem: [
      { subsystem: 'communication', approved: 48, rejected: 6, pending: 8 },
      { subsystem: 'projects', approved: 52, rejected: 7, pending: 9 },
      { subsystem: 'people', approved: 31, rejected: 4, pending: 5 },
      { subsystem: 'working-style', approved: 36, rejected: 3, pending: 6 },
      { subsystem: 'expertise', approved: 28, rejected: 5, pending: 4 },
      { subsystem: 'docs', approved: 22, rejected: 3, pending: 3 },
    ],
    bySource: [
      { source: 'messages', approved: 148, rejected: 18 },
      { source: 'calls', approved: 41, rejected: 6 },
      { source: 'canvases', approved: 28, rejected: 4 },
    ],
    oldestPendingDays: 11,
    addedSinceYesterday: 5,
    recallPrecision: 0.9,
    recallRatedCount: 186,
  });

export const demoListFiles = (): Promise<DigitalTwinMemoryFilesResponse> =>
  wait({
    files: [...files].sort((left, right) => left.sortOrder - right.sortOrder),
    maxLoaded: 3,
    maxChars: 10_000,
  });

export const demoSaveFile = async (
  name: string,
  content: string,
): Promise<{ file: DigitalTwinMemoryFile; truncated: boolean; maxChars: number }> => {
  const existing = files.find(file => file.name === name);
  const next: DigitalTwinMemoryFile = existing
    ? {
        ...existing,
        content: content.slice(0, 10_000),
        updatedAt: new Date().toISOString(),
      }
    : {
        id: `file-${name}`,
        name,
        loadInPrompt: false,
        sortOrder: files.length + 1,
        updatedBy: 'demo-user',
        content: content.slice(0, 10_000),
        updatedAt: new Date().toISOString(),
      };
  files = existing ? files.map(file => (file.name === name ? next : file)) : [...files, next];
  return wait({ file: next, truncated: content.length > 10_000, maxChars: 10_000 });
};

export const demoSetFileLoad = async (
  name: string,
  load: boolean,
): Promise<{ file: DigitalTwinMemoryFile }> => {
  files = files.map(file => (file.name === name ? { ...file, loadInPrompt: load } : file));
  return wait({ file: files.find(file => file.name === name)! });
};

export const demoDeleteFile = async (name: string): Promise<{ deleted: boolean }> => {
  files = files.filter(file => file.name !== name);
  return wait({ deleted: true });
};

export const demoSynthesize = async (): Promise<{ status: string }> => {
  events = [
    event(`event-synthesis-${Date.now()}`, 'synthesize', null, new Date().toISOString(), {
      recordCount: memories.length,
      candidatesCreated: 0,
    }),
    ...events,
  ];
  return wait({ status: 'queued' });
};

export const demoListEvents = (filters: PipelineEventFilters): Promise<PipelineEventsPage> => {
  const filtered = events.filter(item => {
    if (filters.runType && item.runType !== filters.runType) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.sourceKind && item.sourceKind !== filters.sourceKind) return false;
    if (filters.before && item.createdAt >= filters.before) return false;
    return true;
  });
  const limit = filters.limit ?? 50;
  const page = filtered.slice(0, limit);
  return wait({
    events: page,
    nextBefore: filtered.length > limit ? (page.at(-1)?.createdAt ?? null) : null,
  });
};

const detailedDemoProvenance = (summary: PipelineEventSummary): PipelineRecordPreview[] => {
  const common =
    'The next pass should feel native to the Agent Hub, keep the source trail visible, and reuse established product patterns.';
  const records: Array<{
    type: string;
    channelName: string;
    previews: string[];
  }> = [
    {
      type: 'message',
      channelName: 'Digital Twin',
      previews: [
        common,
        'Use the existing components wherever the product already has an established pattern.',
        'Keep new components aligned with the design language and accessibility standards.',
      ],
    },
    {
      type: 'call',
      channelName: 'Product Design',
      previews: [
        common,
        'Show the retained evidence without forcing people to leave the memory list.',
        'Make each source legible as an event, a place, a date, and the supporting excerpt.',
        'Use feedback from the working prototype to refine the interaction.',
      ],
    },
    {
      type: 'canvas',
      channelName: 'Product Design',
      previews: [common],
    },
    {
      type: 'conversation',
      channelName: 'Product Design',
      previews: [
        common,
        'Use the existing components wherever the product already has an established pattern.',
        'Keep the visual language consistent across the Agent Hub.',
      ],
    },
    {
      type: 'mention_reply',
      channelName: 'Product Design',
      previews: [
        common,
        'Show the source trail as part of the memory instead of as a detached report.',
      ],
    },
    {
      type: 'mention',
      channelName: 'Product Design',
      previews: [
        common,
        'Use the existing components wherever the product already has an established pattern.',
      ],
    },
  ];

  return records.flatMap((group, groupIndex) =>
    group.previews.map((textPreview, previewIndex) => ({
      id: `${summary.id}-record-${groupIndex + 1}-${previewIndex + 1}`,
      type: group.type,
      ts: summary.createdAt,
      channelId: group.channelName.toLowerCase().replaceAll(' ', '-'),
      channelName: group.channelName,
      textPreview,
    })),
  );
};

export const demoGetEvent = (id: string): Promise<PipelineEventDetail> => {
  const summary = events.find(item => item.id === id) ?? events[0]!;
  return wait({
    ...summary,
    records:
      summary.id === 'event-daily-1' || summary.id === 'event-backfill-1'
        ? detailedDemoProvenance(summary)
        : [
            {
              id: `${summary.id}-record-1`,
              type:
                summary.sourceKind === 'calls'
                  ? 'call'
                  : summary.sourceKind === 'canvases'
                    ? 'canvas'
                    : 'message',
              ts: summary.createdAt,
              channelId: 'product-design',
              channelName: 'Product Design',
              title: 'Digital Twin review',
              textPreview:
                'The next pass should feel native to the Agent Hub and keep the source trail visible.',
            },
            {
              id: `${summary.id}-record-2`,
              type: 'message',
              ts: summary.createdAt,
              channelId: 'digital-twin',
              channelName: 'Digital Twin',
              textPreview:
                'Use the existing components wherever the product already has an established pattern.',
            },
          ],
    trace: {
      summary:
        'Compared the source records with existing memory and retained stable, reusable context.',
      outcome: 'Two durable suggestions were added to Review; duplicate wording was discarded.',
      confidence: 0.94,
    },
  });
};

export const demoUpdateSettings = async (patch: {
  responseSuffix?: string | null;
  memoryApprovalMode?: 'manual' | 'auto';
  memoryAutoApproveMinScore?: number;
  respondPolicy?: 'always' | 'learned';
}): Promise<typeof settings> => {
  settings = {
    ...settings,
    ...patch,
    responseSuffix:
      patch.responseSuffix === undefined ? settings.responseSuffix : (patch.responseSuffix ?? ''),
  };
  return wait(settings);
};

export const demoUpload = async (
  filename: string,
  content: string,
): Promise<{ filename: string; candidatesCreated: number }> => {
  const created = content.trim() ? 2 : 0;
  events = [
    event(`event-upload-${Date.now()}`, 'upload', 'canvases', new Date().toISOString(), {
      source: filename,
      recordCount: 1,
      candidatesCreated: created,
    }),
    ...events,
  ];
  return wait({ filename, candidatesCreated: created });
};

export const demoEnable = async (): Promise<{
  enabled: boolean;
  enabledAt: string;
  backfillJobIds: string[];
}> => {
  enabled = true;
  return wait({ enabled: true, enabledAt: new Date().toISOString(), backfillJobIds: [] });
};

export const demoDisable = async (
  deleteMemories: boolean,
): Promise<{
  disabled: boolean;
  deleting: boolean;
  cancelledJobs: number;
  deletedCandidates?: number;
  deletedHindsight?: number;
}> => {
  const memoryCount = memories.length;
  enabled = false;
  if (deleteMemories) memories = [];
  return wait({
    disabled: true,
    deleting: deleteMemories,
    cancelledJobs: 0,
    deletedCandidates: deleteMemories ? candidates.length : 0,
    deletedHindsight: deleteMemories ? memoryCount : 0,
  });
};

export const demoDeleteMemories = async (opts: {
  mode: 'all' | 'range';
  from?: string;
  to?: string;
}): Promise<{ deleting: boolean; mode?: string }> => {
  if (opts.mode === 'all') memories = [];
  else {
    const from = opts.from ? Date.parse(opts.from) : Number.NEGATIVE_INFINITY;
    const to = opts.to ? Date.parse(opts.to) : Number.POSITIVE_INFINITY;
    memories = memories.filter(memory => {
      const createdAt = Date.parse(memory.createdAt);
      return createdAt < from || createdAt > to;
    });
  }
  return wait({ deleting: false, mode: opts.mode });
};

export const demoPause = (): Promise<{
  paused: boolean;
  pausedSources: number;
  cancelledJobs: number;
}> => wait({ paused: true, pausedSources: 0, cancelledJobs: 0 });

export const demoResume = (): Promise<{ resumed: number; jobIds: string[] }> =>
  wait({ resumed: 0, jobIds: [] });
