export type LeadershipScope = 'org' | 'team' | 'user';

export interface LeadershipSectionPage {
  section: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: unknown[];
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const at = (value: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, key) => asRecord(current)[key], value);

const arrayAt = (value: unknown, path: string): unknown[] => {
  const result = at(value, path);
  return Array.isArray(result) ? result : [];
};

const flattenRecordArrays = (value: unknown): unknown[] =>
  Object.values(asRecord(value)).flatMap((item) => (Array.isArray(item) ? item : []));

const nextLeapItems = (value: unknown): unknown[] => {
  const leap = asRecord(value);
  const scalarKeys = ['whatNext', 'whatIsWrong', 'theLeap'] as const;
  const arrayKeys = [
    'peopleMoves',
    'peopleChanges',
    'problemShapingChanges',
    'processChanges',
    'platformChanges',
    'connectionsNeeded',
    'successSignals',
  ] as const;
  const labels: Record<(typeof scalarKeys)[number] | (typeof arrayKeys)[number], string> = {
    whatNext: 'What next',
    whatIsWrong: 'What is wrong',
    theLeap: 'The leap',
    peopleMoves: 'People move',
    peopleChanges: 'People change',
    problemShapingChanges: 'Problem-shaping change',
    processChanges: 'Process change',
    platformChanges: 'Platform change',
    connectionsNeeded: 'Connection needed',
    successSignals: 'Success signal',
  };

  return [
    ...scalarKeys.flatMap((key) =>
      typeof leap[key] === 'string' && leap[key] ? [{ title: labels[key], text: leap[key] }] : []
    ),
    ...arrayKeys.flatMap((key) =>
      (Array.isArray(leap[key]) ? leap[key] : []).map((text, index) => ({
        title: `${labels[key]} ${index + 1}`,
        text,
      }))
    ),
  ];
};

const firstText = (value: unknown, keys: string[]): string => {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  return (
    (keys.map((key) => record[key]).find((item) => typeof item === 'string') as
      | string
      | undefined) ?? ''
  );
};

const sectionExtractors: Record<
  LeadershipScope,
  Record<string, (summary: unknown) => unknown[]>
> = {
  org: {
    bullets: (summary) => arrayAt(summary, 'managerSummaryBullets'),
    'founder-agenda': (summary) => arrayAt(summary, 'recommendedActions'),
    'portfolio-of-bets': (summary) => arrayAt(summary, 'founderSnapshot.portfolioOfBets'),
    'cannot-deadlock': (summary) => [
      ...arrayAt(summary, 'founderSnapshot.cannotDeadlock'),
      ...arrayAt(summary, 'operationalSnapshot.needsUnblocking'),
      ...arrayAt(summary, 'operationalSnapshot.upcomingAndAtRisk'),
    ],
    'leadership-leverage': (summary) =>
      flattenRecordArrays(at(summary, 'founderSnapshot.leadershipLeverage')),
    'next-leap': (summary) => nextLeapItems(at(summary, 'founderSnapshot.organizationNextLeap')),
  },
  team: {
    bullets: (summary) => arrayAt(summary, 'managerSummaryBullets'),
    'manager-actions': (summary) => arrayAt(summary, 'recommendedActions'),
    goal: (summary) => arrayAt(summary, 'team10xGoal'),
    'actual-work': (summary) => [
      ...arrayAt(summary, 'operationalSnapshot.criticalAndMoving'),
      ...arrayAt(summary, 'operationalSnapshot.whoIsDoingWhat'),
    ],
    'bottlenecks-and-load': (summary) => [
      ...arrayAt(summary, 'operationalSnapshot.needsUnblocking'),
      ...arrayAt(summary, 'operationalSnapshot.peopleLoadFocusAndGaps.ownershipGaps'),
      ...arrayAt(summary, 'operationalSnapshot.peopleLoadFocusAndGaps.supportGaps'),
      ...arrayAt(summary, 'leadershipSnapshot.bottlenecks.peopleOrOwnership'),
      ...arrayAt(summary, 'leadershipSnapshot.bottlenecks.process'),
      ...arrayAt(summary, 'leadershipSnapshot.bottlenecks.platform'),
    ],
    'capability-and-leverage': (summary) => [
      ...arrayAt(summary, 'leadershipSnapshot.capabilityMix.observedStrengths'),
      ...arrayAt(summary, 'leadershipSnapshot.capabilityMix.developingCapabilities'),
      ...arrayAt(summary, 'leadershipSnapshot.capabilityMix.missingCapabilities'),
      ...flattenRecordArrays(at(summary, 'leadershipSnapshot.leadershipLeverage')),
    ],
    'next-leap': (summary) => nextLeapItems(at(summary, 'leadershipSnapshot.nextLeap')),
  },
  user: {
    bullets: (summary) => arrayAt(summary, 'managerSummaryBullets'),
    'manager-attention': (summary) => arrayAt(summary, 'managerAttention'),
    'work-and-movement': (summary) => [
      ...arrayAt(summary, 'criticalAndMoving'),
      ...arrayAt(summary, 'whoIsDoingWhat'),
    ],
    'blockers-and-risks': (summary) => [
      ...arrayAt(summary, 'needsUnblocking'),
      ...arrayAt(summary, 'upcomingAndAtRisk'),
      ...arrayAt(summary, 'peopleLoadFocusAndGaps.gaps'),
    ],
    'decisions-and-signals': (summary) =>
      [
        ...arrayAt(summary, 'decisionsAndAlignment.decisions').map((item) =>
          firstText(item, ['decision', 'title', 'description'])
        ),
        ...arrayAt(summary, 'decisionsAndAlignment.openQuestions'),
        ...arrayAt(summary, 'teamSignals.directionalSignals').map((item) =>
          firstText(item, ['signal', 'title', 'description'])
        ),
      ].filter(Boolean),
  },
};

export const leadershipSectionNames = (scope: LeadershipScope): string[] =>
  Object.keys(sectionExtractors[scope]);

export const paginateLeadershipSection = ({
  scope,
  section,
  summary,
  page,
  limit,
}: {
  scope: LeadershipScope;
  section: string;
  summary: unknown;
  page: number;
  limit: number;
}): LeadershipSectionPage | null => {
  const extractor = sectionExtractors[scope][section];
  if (!extractor) return null;

  const allItems = extractor(summary);
  const total = allItems.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
  const start = (safePage - 1) * limit;

  return {
    section,
    page: safePage,
    limit,
    total,
    totalPages,
    items: allItems.slice(start, start + limit),
  };
};
