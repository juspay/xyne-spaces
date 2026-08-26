import { z } from 'zod';

const confidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
const importanceSchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

const evidenceReferenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    sourceType: z.enum([
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
    ]),
    reason: z.string().min(1),
  })
  .strict();

const workItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    status: z.enum(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'UNKNOWN']),
    importance: importanceSchema,
    progress: z.string().min(1),
    projects: z.array(z.string().min(1)),
    evidenceRefs: z.array(evidenceReferenceSchema).min(1),
  })
  .strict();

const blockerSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    severity: importanceSchema,
    status: z.enum(['OPEN', 'RESOLVED', 'UNCLEAR']),
    blockedWorkIds: z.array(z.string().min(1)),
    needsActionFrom: z.array(z.string().min(1)),
    recommendedAction: z.string().min(1),
    evidenceRefs: z.array(evidenceReferenceSchema).min(1),
  })
  .strict();

const criticalWorkSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    whyCritical: z.string().min(1),
    movement: z.enum(['PROGRESSING', 'PROGRESSING_WITH_RISK', 'STALLED', 'REGRESSING', 'UNCLEAR']),
    progressDescription: z.string().min(1),
    riskLevel: importanceSchema,
    evidenceRefs: z.array(evidenceReferenceSchema).min(1),
  })
  .strict();

const decisionSchema = z
  .object({
    id: z.string().min(1),
    decision: z.string().min(1),
    context: z.string().min(1),
    impact: z.string().min(1),
    participants: z.array(z.string().min(1)),
    evidenceRefs: z.array(evidenceReferenceSchema).min(1),
  })
  .strict();

const gapSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      'EXTERNAL_DEPENDENCY',
      'OWNERSHIP',
      'CAPACITY',
      'KNOWLEDGE',
      'DECISION',
      'VISIBILITY',
      'OTHER',
    ]),
    description: z.string().min(1),
    severity: importanceSchema,
    evidenceRefs: z.array(evidenceReferenceSchema).min(1),
  })
  .strict();

const upcomingRiskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    expectedDate: z.string().nullable(),
    riskLevel: importanceSchema,
    requiredNextSteps: z.array(z.string().min(1)),
    dependencies: z.array(z.string().min(1)),
    evidenceRefs: z.array(evidenceReferenceSchema).min(1),
  })
  .strict();

const directionalSignalSchema = z
  .object({
    id: z.string().min(1),
    signal: z.string().min(1),
    signalType: z.enum([
      'DECLARED_GOAL',
      'INFERRED_DIRECTION',
      'TECHNICAL_WAVE',
      'BUSINESS_WAVE',
      'CUSTOMER_PROBLEM',
      'DIFFERENTIATION',
      'SUCCESS_MEASURE',
    ]),
    relatedWorkIds: z.array(z.string().min(1)),
    confidence: confidenceSchema,
    evidenceRefs: z.array(evidenceReferenceSchema).min(1),
  })
  .strict();

const capabilitySignalSchema = z
  .object({
    id: z.string().min(1),
    capability: z.string().min(1),
    signalType: z.enum([
      'DEMONSTRATED',
      'DEVELOPING',
      'NEEDED',
      'MISSING',
      'INSUFFICIENT_EVIDENCE',
    ]),
    description: z.string().min(1),
    confidence: confidenceSchema,
    evidenceRefs: z.array(evidenceReferenceSchema).min(1),
  })
  .strict();

const dependencySignalSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    dependencyType: z.enum([
      'TEAM_MEMBER',
      'EXTERNAL_TEAM',
      'PROCESS',
      'PLATFORM',
      'DECISION',
      'UNKNOWN',
    ]),
    status: z.enum(['OPEN', 'BLOCKED', 'AT_RISK', 'RESOLVED', 'UNCLEAR']),
    dependsOn: z.string().nullable(),
    affectedWorkIds: z.array(z.string().min(1)),
    evidenceRefs: z.array(evidenceReferenceSchema).min(1),
  })
  .strict();

export const TeamIntelligenceUserSummarySchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    scope: z.literal('USER_DAILY_SUMMARY'),
    batchId: z.string().min(1),
    userIngestionId: z.string().min(1),
    reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    user: z
      .object({
        id: z.string().min(1),
        email: z.string().email(),
        name: z.string().min(1),
        role: z.string().nullable(),
        teamId: z.string().nullable(),
        teamName: z.string().nullable(),
      })
      .strict(),
    executiveSummary: z.string().min(1),
    managerSummaryBullets: z.array(z.string().min(1)).min(1),
    whoIsDoingWhat: z.array(workItemSchema),
    needsUnblocking: z.array(blockerSchema),
    criticalAndMoving: z.array(criticalWorkSchema),
    momentumAndDirection: z
      .object({
        momentum: z.enum([
          'FORWARD',
          'FORWARD_WITH_BLOCKERS',
          'FLAT',
          'REGRESSING',
          'INSUFFICIENT_EVIDENCE',
        ]),
        direction: z.enum([
          'TOWARD_STATED_GOALS',
          'MIXED_OR_UNCLEAR',
          'AWAY_FROM_STATED_GOALS',
          'INSUFFICIENT_EVIDENCE',
        ]),
        assessment: z.string().min(1),
        progressMade: z.array(z.string().min(1)),
        concerns: z.array(z.string().min(1)),
        evidenceRefs: z.array(evidenceReferenceSchema),
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
        decisions: z.array(decisionSchema),
        alignmentConcerns: z.array(z.string().min(1)),
        openQuestions: z.array(z.string().min(1)),
      })
      .strict(),
    peopleLoadFocusAndGaps: z
      .object({
        loadAssessment: z.enum([
          'OVERLOADED',
          'HIGH',
          'BALANCED',
          'LIGHT',
          'INSUFFICIENT_EVIDENCE',
        ]),
        focusAssessment: z.enum([
          'FOCUSED',
          'MOSTLY_FOCUSED',
          'FRAGMENTED',
          'HIGHLY_FRAGMENTED',
          'INSUFFICIENT_EVIDENCE',
        ]),
        primaryFocus: z.array(z.string().min(1)),
        secondaryFocus: z.array(z.string().min(1)),
        contextSwitchingRisk: z.enum(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE']),
        assessment: z.string().min(1),
        gaps: z.array(gapSchema),
        evidenceRefs: z.array(evidenceReferenceSchema),
      })
      .strict(),
    upcomingAndAtRisk: z.array(upcomingRiskSchema),
    managerAttention: z.array(
      z
        .object({
          id: z.string().min(1),
          priority: importanceSchema,
          action: z.string().min(1),
          reason: z.string().min(1),
          relatedBlockerIds: z.array(z.string().min(1)),
          relatedRiskIds: z.array(z.string().min(1)),
        })
        .strict()
    ),
    teamSignals: z
      .object({
        directionalSignals: z.array(directionalSignalSchema),
        capabilitySignals: z.array(capabilitySignalSchema),
        dependencies: z.array(dependencySignalSchema),
      })
      .strict(),
    unknowns: z.array(
      z
        .object({
          id: z.string().min(1),
          question: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict()
    ),
    overallConfidence: confidenceSchema,
  })
  .strict();

export type TeamIntelligenceUserSummary = z.infer<typeof TeamIntelligenceUserSummarySchema>;

export type TeamIntelligenceTeamAggregationPayload = {
  userIngestionId: string;
  reportDate: string;
  user: TeamIntelligenceUserSummary['user'];
  summary: string;
  activeWork: TeamIntelligenceUserSummary['whoIsDoingWhat'];
  blockers: TeamIntelligenceUserSummary['needsUnblocking'];
  criticalWork: TeamIntelligenceUserSummary['criticalAndMoving'];
  momentumAndDirection: TeamIntelligenceUserSummary['momentumAndDirection'];
  decisionsAndAlignment: TeamIntelligenceUserSummary['decisionsAndAlignment'];
  loadAndFocus: TeamIntelligenceUserSummary['peopleLoadFocusAndGaps'];
  upcomingCommitments: TeamIntelligenceUserSummary['upcomingAndAtRisk'];
  directionalSignals: TeamIntelligenceUserSummary['teamSignals']['directionalSignals'];
  capabilitySignals: TeamIntelligenceUserSummary['teamSignals']['capabilitySignals'];
  dependencies: TeamIntelligenceUserSummary['teamSignals']['dependencies'];
  managerAttention: TeamIntelligenceUserSummary['managerAttention'];
  unknowns: TeamIntelligenceUserSummary['unknowns'];
  confidence: TeamIntelligenceUserSummary['overallConfidence'];
};
