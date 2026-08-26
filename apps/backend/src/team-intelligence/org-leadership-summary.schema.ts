import { z } from 'zod';

const confidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
const prioritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const teamSignalRefSchema = z
  .object({
    teamSummaryId: z.string().min(1),
    signalId: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const teamIdentitySchema = z
  .object({
    teamId: z.string().min(1),
    teamName: z.string().min(1),
  })
  .strict();

const orgItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    implication: z.string().min(1),
    recommendedAction: z.string().min(1),
    priority: prioritySchema,
    affectedTeamIds: z.array(z.string().min(1)),
    teamSignalRefs: z.array(teamSignalRefSchema),
  })
  .strict();

const orgWorkstreamSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    status: z.enum(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'UNKNOWN']),
    importance: prioritySchema,
    movement: z.enum(['PROGRESSING', 'PROGRESSING_WITH_RISK', 'STALLED', 'REGRESSING', 'UNCLEAR']),
    teams: z.array(teamIdentitySchema).min(1),
    teamSignalRefs: z.array(teamSignalRefSchema).min(1),
  })
  .strict();

const orgBlockerSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    severity: prioritySchema,
    status: z.enum(['OPEN', 'RESOLVED', 'UNCLEAR']),
    affectedTeamIds: z.array(z.string().min(1)),
    affectedInitiativeIds: z.array(z.string().min(1)),
    needsActionFrom: z.array(z.string().min(1)),
    recommendedAction: z.string().min(1),
    firstSeen: dateSchema.nullable(),
    daysOpen: z.number().int().nonnegative().nullable(),
    teamSignalRefs: z.array(teamSignalRefSchema).min(1),
  })
  .strict();

const orgDecisionSchema = z
  .object({
    id: z.string().min(1),
    decision: z.string().min(1),
    context: z.string().min(1),
    impact: z.string().min(1),
    affectedTeamIds: z.array(z.string().min(1)),
    reversibility: z.enum(['REVERSIBLE', 'IRREVERSIBLE', 'UNCLEAR']),
    status: z.enum(['DECIDED', 'PENDING', 'CONFLICTING', 'SUPERSEDED', 'UNCLEAR']),
    needsLeadershipInput: z.boolean(),
    teamSignalRefs: z.array(teamSignalRefSchema).min(1),
  })
  .strict();

const teamPortfolioItemSchema = z
  .object({
    teamId: z.string().min(1),
    teamName: z.string().min(1),
    assessment: z.string().min(1),
    severity: prioritySchema,
    teamSignalRefs: z.array(teamSignalRefSchema).min(1),
  })
  .strict();

const orgRiskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    expectedDate: z.string().nullable(),
    riskLevel: prioritySchema,
    affectedTeamIds: z.array(z.string().min(1)),
    dependencies: z.array(z.string().min(1)),
    requiredNextSteps: z.array(z.string().min(1)),
    teamSignalRefs: z.array(teamSignalRefSchema).min(1),
  })
  .strict();

const betSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    teamIds: z.array(z.string().min(1)).min(1),
    technicalWaves: z.array(z.string().min(1)),
    businessWaves: z.array(z.string().min(1)),
    stage: z.enum([
      'ZERO_TO_ONE',
      'ONE_TO_TEN',
      'TEN_TO_HUNDRED',
      'HUNDRED_TO_THOUSAND',
      'UNKNOWN',
    ]),
    momentum: z.enum(['GROWING', 'STABLE', 'WEAKENING', 'STALLED', 'INSUFFICIENT_BASELINE']),
    differentiation: z.enum(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE']),
    organizationAlignment: z.enum([
      'ALIGNED',
      'PARTIALLY_ALIGNED',
      'MISALIGNED',
      'INSUFFICIENT_EVIDENCE',
    ]),
    riskLevel: prioritySchema,
    assessment: z.string().min(1),
    teamSignalRefs: z.array(teamSignalRefSchema).min(1),
  })
  .strict();

const touchTeamSchema = z
  .object({
    teamId: z.string().min(1),
    teamName: z.string().min(1),
    reason: z.string().min(1),
    interventionNeeded: z.string().nullable(),
    teamSignalRefs: z.array(teamSignalRefSchema).min(1),
  })
  .strict();

export const TeamIntelligenceOrgContinuityStateSchema = z
  .object({
    window: z
      .object({
        from: dateSchema,
        to: dateSchema,
        daysRepresented: z.number().int().positive().max(14),
      })
      .strict(),
    strategicBets: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string().min(1),
          firstSeen: dateSchema,
          lastSeen: dateSchema,
          strength: z.enum(['GROWING', 'STABLE', 'WEAKENING', 'STALLED', 'UNCLEAR']),
          teamIds: z.array(z.string().min(1)),
        })
        .strict()
    ),
    criticalInitiatives: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string().min(1),
          firstSeen: dateSchema,
          lastSeen: dateSchema,
          movement: z.enum([
            'PROGRESSING',
            'PROGRESSING_WITH_RISK',
            'STALLED',
            'REGRESSING',
            'UNCLEAR',
          ]),
          teamIds: z.array(z.string().min(1)),
        })
        .strict()
    ),
    organizationBlockers: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string().min(1),
          firstSeen: dateSchema,
          lastSeen: dateSchema,
          status: z.enum(['OPEN', 'RESOLVED', 'UNCLEAR']),
          affectedTeamIds: z.array(z.string().min(1)),
        })
        .strict()
    ),
    crossTeamDependencies: z.array(
      z
        .object({
          id: z.string().min(1),
          fromTeamId: z.string().min(1),
          toTeamId: z.string().nullable(),
          description: z.string().min(1),
          firstSeen: dateSchema,
          lastSeen: dateSchema,
          status: z.enum(['OPEN', 'BLOCKED', 'AT_RISK', 'RESOLVED', 'UNCLEAR']),
        })
        .strict()
    ),
    capabilityGaps: z.array(
      z
        .object({
          id: z.string().min(1),
          capability: z.string().min(1),
          firstSeen: dateSchema,
          lastSeen: dateSchema,
          affectedTeamIds: z.array(z.string().min(1)),
        })
        .strict()
    ),
    capacityRisks: z.array(
      z
        .object({
          teamId: z.string().min(1),
          assessment: z.enum(['OVERLOADED', 'HIGH', 'BALANCED', 'LIGHT', 'INSUFFICIENT_EVIDENCE']),
          daysObserved: z.number().int().positive().max(14),
        })
        .strict()
    ),
    irreversibleDecisions: z.array(
      z
        .object({
          id: z.string().min(1),
          decision: z.string().min(1),
          firstSeen: dateSchema,
          lastSeen: dateSchema,
          status: z.enum(['PENDING', 'DECIDED', 'SUPERSEDED', 'UNCLEAR']),
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
          teamIds: z.array(z.string().min(1)),
        })
        .strict()
    ),
    teamTouchLevels: z.array(
      z
        .object({
          teamId: z.string().min(1),
          recommendedMode: z.enum([
            'HIGH_TOUCH',
            'MEDIUM_TOUCH',
            'LOW_TOUCH',
            'INSUFFICIENT_EVIDENCE',
          ]),
          firstSeen: dateSchema,
          lastSeen: dateSchema,
        })
        .strict()
    ),
  })
  .strict();

const coverageSchema = z
  .object({
    expectedTeams: z.number().int().nonnegative(),
    completedTeamSummaries: z.number().int().nonnegative(),
    failedTeamSummaries: z.number().int().nonnegative(),
    missingTeams: z.array(
      z
        .object({
          teamId: z.string().min(1),
          teamName: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict()
    ),
  })
  .strict();

export const TeamIntelligenceOrgLeadershipSummarySchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    scope: z.literal('ORG_LEADERSHIP_SNAPSHOT'),
    batchId: z.string().min(1),
    reportDate: dateSchema,
    organization: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        teamCount: z.number().int().nonnegative(),
        memberCount: z.number().int().nonnegative(),
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
          contributorTeamIds: z.array(z.string().min(1)).min(1),
          teamSignalRefs: z.array(teamSignalRefSchema).min(1),
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
        topBets: z.array(z.string().min(1)),
        topSignals: z.array(z.string().min(1)),
        topBlockers: z.array(z.string().min(1)),
        topRisks: z.array(z.string().min(1)),
        immediateLeadershipActions: z.array(z.string().min(1)),
      })
      .strict(),
    operationalSnapshot: z
      .object({
        whoIsDoingWhat: z.array(orgWorkstreamSchema),
        needsUnblocking: z.array(orgBlockerSchema),
        criticalAndMoving: z.array(orgWorkstreamSchema),
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
            progressingInitiativeIds: z.array(z.string().min(1)),
            stalledInitiativeIds: z.array(z.string().min(1)),
            busyButNotClearlyDirectional: z.array(z.string().min(1)),
            teamSignalRefs: z.array(teamSignalRefSchema),
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
            decisions: z.array(orgDecisionSchema),
            conflictingDecisions: z.array(orgDecisionSchema),
            openQuestions: z.array(z.string().min(1)),
          })
          .strict(),
        loadFocusAndGaps: z
          .object({
            overloadedTeams: z.array(teamPortfolioItemSchema),
            teamsNeedingSupport: z.array(teamPortfolioItemSchema),
            capabilityGaps: z.array(orgItemSchema),
            ownershipConcentrationRisks: z.array(orgItemSchema),
            resourceImbalances: z.array(orgItemSchema),
          })
          .strict(),
        upcomingAndAtRisk: z.array(orgRiskSchema),
      })
      .strict(),
    founderSnapshot: z
      .object({
        portfolioOfBets: z.array(betSchema),
        organizationCapabilityMix: z
          .object({
            strongCapabilities: z.array(orgItemSchema),
            developingCapabilities: z.array(orgItemSchema),
            missingCapabilities: z.array(orgItemSchema),
            capabilitiesConcentratedInOneTeam: z.array(orgItemSchema),
            capabilitiesConcentratedInOnePerson: z.array(orgItemSchema),
            capabilityMovementOpportunities: z.array(orgItemSchema),
            hiringOrUpskillingNeeds: z.array(orgItemSchema),
            assessment: z.string().min(1),
          })
          .strict(),
        teamTouchPortfolio: z
          .object({
            highTouch: z.array(touchTeamSchema),
            mediumTouch: z.array(touchTeamSchema),
            lowTouch: z.array(touchTeamSchema),
            insufficientEvidence: z.array(touchTeamSchema),
          })
          .strict(),
        cannotDeadlock: z.array(
          z
            .object({
              rank: z.number().int().positive(),
              initiativeId: z.string().min(1),
              initiative: z.string().min(1),
              teamIds: z.array(z.string().min(1)).min(1),
              whyCritical: z.string().min(1),
              currentMovement: z.enum([
                'PROGRESSING',
                'PROGRESSING_WITH_RISK',
                'STALLED',
                'REGRESSING',
                'UNCLEAR',
              ]),
              deadlockRisk: prioritySchema,
              currentBottleneck: z.string().nullable(),
              leadershipIntervention: z.string().min(1),
              teamSignalRefs: z.array(teamSignalRefSchema).min(1),
            })
            .strict()
        ),
        organizationBottlenecks: z
          .object({
            peopleOrOwnership: z.array(orgItemSchema),
            process: z.array(orgItemSchema),
            platform: z.array(orgItemSchema),
            crossTeamDependencies: z.array(
              z
                .object({
                  id: z.string().min(1),
                  fromTeamId: z.string().min(1),
                  toTeamId: z.string().nullable(),
                  description: z.string().min(1),
                  status: z.enum(['OPEN', 'BLOCKED', 'AT_RISK', 'RESOLVED', 'UNCLEAR']),
                  ageDays: z.number().int().nonnegative().nullable(),
                  affectedBetIds: z.array(z.string().min(1)),
                  recommendedAction: z.string().min(1),
                  teamSignalRefs: z.array(teamSignalRefSchema).min(1),
                })
                .strict()
            ),
          })
          .strict(),
        decisionAgenda: z
          .object({
            irreversibleDecisions: z.array(orgDecisionSchema),
            reversibleDecisionsNeedingDelegation: z.array(orgDecisionSchema),
            conflictingTeamDecisions: z.array(orgDecisionSchema),
            budgetApprovals: z.array(orgItemSchema),
            decisionsWithoutOwners: z.array(orgItemSchema),
            decisionsAtRiskOfDelay: z.array(orgItemSchema),
          })
          .strict(),
        leadershipLeverage: z
          .object({
            budgetsAndApprovals: z.array(orgItemSchema),
            momentumCorrections: z.array(orgItemSchema),
            connectionsNeeded: z.array(orgItemSchema),
            problemShapingNeeds: z.array(orgItemSchema),
            learningAndUpskilling: z.array(orgItemSchema),
            tradeoffs: z.array(orgItemSchema),
            alignmentCorrections: z.array(orgItemSchema),
            peopleOrTeamMoves: z.array(orgItemSchema),
          })
          .strict(),
        organizationNextLeap: z
          .object({
            whatNext: z.string().min(1),
            whatIsWrong: z.string().min(1),
            theLeap: z.string().min(1),
            peopleMoves: z.array(z.string().min(1)),
            problemShapingChanges: z.array(z.string().min(1)),
            processChanges: z.array(z.string().min(1)),
            platformChanges: z.array(z.string().min(1)),
            connectionsNeeded: z.array(z.string().min(1)),
            successSignals: z.array(z.string().min(1)),
            teamSignalRefs: z.array(teamSignalRefSchema),
          })
          .strict(),
      })
      .strict(),
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
          affectedTeamIds: z.array(z.string().min(1)),
          teamSignalRefs: z.array(teamSignalRefSchema),
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
    continuityState: TeamIntelligenceOrgContinuityStateSchema,
    overallConfidence: confidenceSchema,
  })
  .strict();

export type TeamIntelligenceOrgContinuityState = z.infer<
  typeof TeamIntelligenceOrgContinuityStateSchema
>;
export type TeamIntelligenceOrgLeadershipSummary = z.infer<
  typeof TeamIntelligenceOrgLeadershipSummarySchema
>;
export type TeamIntelligenceOrgProcessingCoverage = z.infer<typeof coverageSchema>;
