import { z } from 'zod';

const confidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
const prioritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const memberSignalRefSchema = z
  .object({
    userIngestionId: z.string().min(1),
    signalId: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const ownerSchema = z
  .object({
    userId: z.string().min(1),
    userName: z.string().min(1),
    responsibility: z.string().min(1),
  })
  .strict();

const teamWorkstreamSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    status: z.enum(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'UNKNOWN']),
    importance: prioritySchema,
    progress: z.string().min(1),
    owners: z.array(ownerSchema),
    memberSignalRefs: z.array(memberSignalRefSchema).min(1),
  })
  .strict();

const teamBlockerSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    severity: prioritySchema,
    status: z.enum(['OPEN', 'RESOLVED', 'UNCLEAR']),
    affectedUserIds: z.array(z.string().min(1)),
    affectedWorkstreamIds: z.array(z.string().min(1)),
    needsActionFrom: z.array(z.string().min(1)),
    recommendedAction: z.string().min(1),
    firstSeen: dateSchema.nullable(),
    daysOpen: z.number().int().nonnegative().nullable(),
    memberSignalRefs: z.array(memberSignalRefSchema).min(1),
  })
  .strict();

const teamCriticalItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    whyCritical: z.string().min(1),
    movement: z.enum(['PROGRESSING', 'PROGRESSING_WITH_RISK', 'STALLED', 'REGRESSING', 'UNCLEAR']),
    progressDescription: z.string().min(1),
    riskLevel: prioritySchema,
    ownerUserIds: z.array(z.string().min(1)),
    memberSignalRefs: z.array(memberSignalRefSchema).min(1),
  })
  .strict();

const teamDecisionSchema = z
  .object({
    id: z.string().min(1),
    decision: z.string().min(1),
    context: z.string().min(1),
    impact: z.string().min(1),
    participants: z.array(z.string().min(1)),
    reversibility: z.enum(['REVERSIBLE', 'IRREVERSIBLE', 'UNCLEAR']),
    needsLeadershipInput: z.boolean(),
    memberSignalRefs: z.array(memberSignalRefSchema).min(1),
  })
  .strict();

const personAssessmentSchema = z
  .object({
    userId: z.string().min(1),
    userName: z.string().min(1),
    assessment: z.string().min(1),
    severity: prioritySchema,
    memberSignalRefs: z.array(memberSignalRefSchema).min(1),
  })
  .strict();

const teamRiskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    expectedDate: z.string().nullable(),
    riskLevel: prioritySchema,
    ownerUserIds: z.array(z.string().min(1)),
    dependencies: z.array(z.string().min(1)),
    requiredNextSteps: z.array(z.string().min(1)),
    memberSignalRefs: z.array(memberSignalRefSchema).min(1),
  })
  .strict();

const leadershipItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    implication: z.string().min(1),
    recommendedAction: z.string().min(1),
    priority: prioritySchema,
    memberSignalRefs: z.array(memberSignalRefSchema),
  })
  .strict();

const teamGoalAlignmentSchema = z
  .object({
    goalId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().nullable(),
    track: z.enum(['2X', '5X', '10X', 'UNKNOWN']),
    status: z.string().nullable(),
    visibility: z.string().nullable(),
    matchStrength: z.enum(['STRONG', 'PARTIAL', 'WEAK']),
    isTeamWorkingTowardsGoal: z.boolean(),
    summary: z.string().min(1),
    matchedSignals: z.array(z.string().min(1)),
    evidenceSourceTypes: z.array(
      z.enum([
        'PULL_REQUEST',
        'COMMIT',
        'AI_USAGE',
        'TICKET',
        'TICKET_ACTIVITY',
        'CONVERSATION',
        'MESSAGE',
        'CALL',
        'CANVAS',
        'CANVAS_VERSION',
        'UNKNOWN',
      ])
    ),
    memberSignalRefs: z.array(memberSignalRefSchema).min(1),
  })
  .strict();

const continuityWorkstreamSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    firstSeen: dateSchema,
    lastSeen: dateSchema,
    currentStatus: z.enum(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'UNKNOWN']),
    importance: prioritySchema,
    ownerUserIds: z.array(z.string().min(1)),
    latestProgress: z.string().min(1),
    daysWithoutVisibleProgress: z.number().int().nonnegative(),
  })
  .strict();

const continuityBlockerSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    firstSeen: dateSchema,
    lastSeen: dateSchema,
    status: z.enum(['OPEN', 'RESOLVED', 'UNCLEAR']),
    affectedWorkstreamIds: z.array(z.string().min(1)),
  })
  .strict();

export const TeamIntelligenceContinuityStateSchema = z
  .object({
    window: z
      .object({
        from: dateSchema,
        to: dateSchema,
        daysRepresented: z.number().int().positive().max(14),
      })
      .strict(),
    workstreams: z.array(continuityWorkstreamSchema),
    blockers: z.array(continuityBlockerSchema),
    decisions: z.array(
      z
        .object({
          id: z.string().min(1),
          decision: z.string().min(1),
          firstSeen: dateSchema,
          lastSeen: dateSchema,
          status: z.enum(['CURRENT', 'SUPERSEDED', 'REVERSED', 'UNCLEAR']),
        })
        .strict()
    ),
    directionalSignals: z.array(
      z
        .object({
          signal: z.string().min(1),
          firstSeen: dateSchema,
          lastSeen: dateSchema,
          strength: z.enum(['GROWING', 'STABLE', 'WEAKENING', 'UNCLEAR']),
        })
        .strict()
    ),
    capabilitySignals: z.array(
      z
        .object({
          capability: z.string().min(1),
          signalType: z.enum(['STRENGTH', 'DEVELOPING', 'GAP', 'UNKNOWN']),
          firstSeen: dateSchema,
          lastSeen: dateSchema,
        })
        .strict()
    ),
    loadSignals: z.array(
      z
        .object({
          userId: z.string().min(1),
          assessment: z.enum(['OVERLOADED', 'HIGH', 'BALANCED', 'LIGHT', 'INSUFFICIENT_EVIDENCE']),
          daysObserved: z.number().int().positive().max(14),
        })
        .strict()
    ),
    upcomingCommitments: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string().min(1),
          expectedDate: z.string().nullable(),
          riskLevel: prioritySchema,
        })
        .strict()
    ),
  })
  .strict();

const coverageSchema = z
  .object({
    expectedMembers: z.number().int().nonnegative(),
    completedUserSummaries: z.number().int().nonnegative(),
    failedUserSummaries: z.number().int().nonnegative(),
    missingMembers: z.array(
      z
        .object({
          userEmail: z.string().email(),
          reason: z.string().min(1),
        })
        .strict()
    ),
  })
  .strict();

export const TeamIntelligenceTeamLeadershipSummarySchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    scope: z.literal('TEAM_LEADERSHIP_SNAPSHOT'),
    batchId: z.string().min(1),
    reportDate: dateSchema,
    team: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
      })
      .strict(),
    managerSummaryBullets: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string().min(1),
          text: z.string().min(1),
          category: z.enum([
            'shipped',
            'achievement',
            'collaboration',
            'learning',
            'recognition',
            'learned',
            'helped',
            'milestone',
          ]),
          contributorUserIds: z.array(z.string().min(1)).min(1),
          memberSignalRefs: z.array(memberSignalRefSchema).min(1),
        })
        .strict()
    ),
    executiveSummary: z
      .object({
        narrative: z.string().min(1),
        momentum: z.enum([
          'FORWARD',
          'FORWARD_WITH_BLOCKERS',
          'MIXED',
          'FLAT',
          'REGRESSING',
          'INSUFFICIENT_BASELINE',
        ]),
        topSignals: z.array(z.string().min(1)),
        topBlockers: z.array(z.string().min(1)),
        topRisks: z.array(z.string().min(1)),
        immediateLeadershipActions: z.array(z.string().min(1)),
      })
      .strict(),
    operationalSnapshot: z
      .object({
        whoIsDoingWhat: z.array(teamWorkstreamSchema),
        needsUnblocking: z.array(teamBlockerSchema),
        criticalAndMoving: z.array(teamCriticalItemSchema),
        momentumAndDirection: z
          .object({
            momentum: z.enum([
              'FORWARD',
              'FORWARD_WITH_BLOCKERS',
              'MIXED',
              'FLAT',
              'REGRESSING',
              'INSUFFICIENT_BASELINE',
            ]),
            direction: z.enum([
              'TOWARD_STATED_GOALS',
              'COHERENT_INFERRED_DIRECTION',
              'MIXED_OR_UNCLEAR',
              'AWAY_FROM_STATED_GOALS',
              'INSUFFICIENT_EVIDENCE',
            ]),
            assessment: z.string().min(1),
            progressingWorkstreamIds: z.array(z.string().min(1)),
            stalledWorkstreamIds: z.array(z.string().min(1)),
            busyButNotClearlyDirectional: z.array(z.string().min(1)),
            memberSignalRefs: z.array(memberSignalRefSchema),
          })
          .strict(),
        decisionsAndAlignment: z
          .object({
            alignmentStatus: z.enum([
              'ALIGNED',
              'PARTIALLY_ALIGNED',
              'MISALIGNED',
              'INSUFFICIENT_EVIDENCE',
            ]),
            decisions: z.array(teamDecisionSchema),
            conflicts: z.array(z.string().min(1)),
            openQuestions: z.array(z.string().min(1)),
          })
          .strict(),
        peopleLoadFocusAndGaps: z
          .object({
            overloadedMembers: z.array(personAssessmentSchema),
            lightOrInsufficientlyVisibleMembers: z.array(personAssessmentSchema),
            contextSwitchingRisks: z.array(personAssessmentSchema),
            singlePointsOfFailure: z.array(personAssessmentSchema),
            ownershipGaps: z.array(leadershipItemSchema),
            supportGaps: z.array(leadershipItemSchema),
          })
          .strict(),
        upcomingAndAtRisk: z.array(teamRiskSchema),
      })
      .strict(),
    leadershipSnapshot: z
      .object({
        directionalBet: z
          .object({
            statedBet: z.string().nullable(),
            inferredBet: z.string().nullable(),
            technicalWaves: z.array(z.string().min(1)),
            businessWaves: z.array(z.string().min(1)),
            smallThingThatCanBecomeBig: z.array(leadershipItemSchema),
            alignmentAssessment: z.enum([
              'ALIGNED',
              'PARTIALLY_ALIGNED',
              'MISALIGNED',
              'INSUFFICIENT_EVIDENCE',
            ]),
            assessment: z.string().min(1),
            memberSignalRefs: z.array(memberSignalRefSchema),
            confidence: confidenceSchema,
          })
          .strict(),
        capabilityMix: z
          .object({
            observedStrengths: z.array(leadershipItemSchema),
            developingCapabilities: z.array(leadershipItemSchema),
            missingCapabilities: z.array(leadershipItemSchema),
            singlePersonDependencies: z.array(leadershipItemSchema),
            projectPhaseFit: z.array(leadershipItemSchema),
            assessment: z.string().min(1),
            confidence: confidenceSchema,
          })
          .strict(),
        leadershipTouch: z
          .object({
            currentObservedMode: z.enum([
              'HIGH_TOUCH',
              'MEDIUM_TOUCH',
              'LOW_TOUCH',
              'INSUFFICIENT_EVIDENCE',
            ]),
            recommendedMode: z.enum([
              'HIGH_TOUCH',
              'MEDIUM_TOUCH',
              'LOW_TOUCH',
              'INSUFFICIENT_EVIDENCE',
            ]),
            reasons: z.array(z.string().min(1)),
            interventionTriggers: z.array(z.string().min(1)),
            delegationSignals: z.array(z.string().min(1)),
            memberSignalRefs: z.array(memberSignalRefSchema),
            confidence: confidenceSchema,
          })
          .strict(),
        bottlenecks: z
          .object({
            peopleOrOwnership: z.array(leadershipItemSchema),
            process: z.array(leadershipItemSchema),
            platform: z.array(leadershipItemSchema),
          })
          .strict(),
        leadershipLeverage: z
          .object({
            irreversibleDecisions: z.array(leadershipItemSchema),
            budgetOrApprovalNeeds: z.array(leadershipItemSchema),
            momentumCorrections: z.array(leadershipItemSchema),
            connectionsNeeded: z.array(leadershipItemSchema),
            problemShapingNeeds: z.array(leadershipItemSchema),
            learningAndUpskilling: z.array(leadershipItemSchema),
            tradeoffs: z.array(leadershipItemSchema),
            alignmentCorrections: z.array(leadershipItemSchema),
          })
          .strict(),
        nextLeap: z
          .object({
            whatNext: z.string().min(1),
            whatIsWrong: z.string().min(1),
            theLeap: z.string().min(1),
            peopleChanges: z.array(z.string().min(1)),
            processChanges: z.array(z.string().min(1)),
            platformChanges: z.array(z.string().min(1)),
            successSignals: z.array(z.string().min(1)),
            memberSignalRefs: z.array(memberSignalRefSchema),
          })
          .strict(),
      })
      .strict(),
    team10xGoal: z.array(teamGoalAlignmentSchema),
    recommendedActions: z.array(
      z
        .object({
          id: z.string().min(1),
          priority: prioritySchema,
          timeHorizon: z.enum(['IMMEDIATE', 'THIS_WEEK', 'NEXT_TWO_WEEKS', 'LONGER_TERM']),
          action: z.string().min(1),
          why: z.string().min(1),
          suggestedOwner: z.string().nullable(),
          expectedOutcome: z.string().min(1),
          memberSignalRefs: z.array(memberSignalRefSchema),
        })
        .strict()
    ),
    processingCoverage: coverageSchema,
    dataGaps: z.array(
      z
        .object({
          gap: z.string().min(1),
          impact: z.string().min(1),
        })
        .strict()
    ),
    continuityState: TeamIntelligenceContinuityStateSchema,
    overallConfidence: confidenceSchema,
  })
  .strict();

export type TeamIntelligenceContinuityState = z.infer<typeof TeamIntelligenceContinuityStateSchema>;
export type TeamIntelligenceTeamLeadershipSummary = z.infer<
  typeof TeamIntelligenceTeamLeadershipSummarySchema
>;
export type TeamIntelligenceTeamProcessingCoverage = z.infer<typeof coverageSchema>;

export type TeamIntelligenceOrgAggregationPayload = {
  teamSummaryId: string;
  reportDate: string;
  team: {
    id: string;
    name: string;
    memberCount: number;
  };
  members: Array<{
    userId: string;
    userEmail: string;
    userName: string;
    role: string | null;
  }>;
  summary: string;
  managerSummaryBullets: TeamIntelligenceTeamLeadershipSummary['managerSummaryBullets'];
  primaryWorkstreams: TeamIntelligenceTeamLeadershipSummary['operationalSnapshot']['whoIsDoingWhat'];
  blockers: TeamIntelligenceTeamLeadershipSummary['operationalSnapshot']['needsUnblocking'];
  criticalWork: TeamIntelligenceTeamLeadershipSummary['operationalSnapshot']['criticalAndMoving'];
  momentumAndDirection: TeamIntelligenceTeamLeadershipSummary['operationalSnapshot']['momentumAndDirection'];
  decisionsAndAlignment: TeamIntelligenceTeamLeadershipSummary['operationalSnapshot']['decisionsAndAlignment'];
  capacityAndLoad: TeamIntelligenceTeamLeadershipSummary['operationalSnapshot']['peopleLoadFocusAndGaps'];
  upcomingRisks: TeamIntelligenceTeamLeadershipSummary['operationalSnapshot']['upcomingAndAtRisk'];
  directionalBet: TeamIntelligenceTeamLeadershipSummary['leadershipSnapshot']['directionalBet'];
  capabilityMix: TeamIntelligenceTeamLeadershipSummary['leadershipSnapshot']['capabilityMix'];
  leadershipTouch: TeamIntelligenceTeamLeadershipSummary['leadershipSnapshot']['leadershipTouch'];
  bottlenecks: TeamIntelligenceTeamLeadershipSummary['leadershipSnapshot']['bottlenecks'];
  leadershipLeverage: TeamIntelligenceTeamLeadershipSummary['leadershipSnapshot']['leadershipLeverage'];
  nextLeap: TeamIntelligenceTeamLeadershipSummary['leadershipSnapshot']['nextLeap'];
  team10xGoal: TeamIntelligenceTeamLeadershipSummary['team10xGoal'];
  leadershipAsks: TeamIntelligenceTeamLeadershipSummary['recommendedActions'];
  dataGaps: TeamIntelligenceTeamLeadershipSummary['dataGaps'];
  confidence: TeamIntelligenceTeamLeadershipSummary['overallConfidence'];
};
