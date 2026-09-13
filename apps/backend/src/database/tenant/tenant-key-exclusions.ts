import type { Prisma } from '@prisma/client';

export const TENANT_KEY_EXCLUDED_MODELS = [
  'WorkflowMapping',
  'Resource',
  'AiProvisioningStatus',
  'CanvasCommentThread',
  'CanvasComment',
  'Commit', // Scoped via pullRequest.workspaceId (FK relationship)
  'LookupValue',
  'Merchant',
  'ActivityAlias',
  'AvailableAppPermission',
  'TeamIntelligenceIngestionBatchV2',
  'TeamIntelligenceUserIngestionV2',
  'TeamIntelligenceTeamSummaryV2',
  'TeamIntelligenceOrgSummaryV2',
  'DoclingAsyncFile',
  'DoclingAsyncPart',
] as const satisfies readonly Prisma.ModelName[];
