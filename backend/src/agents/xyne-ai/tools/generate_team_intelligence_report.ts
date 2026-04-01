import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { OrgRole } from '@prisma/client';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/env.js';
import { getDescription } from './helpers.js';
import type { XyneAIAgentContext } from './types.js';
import { teamIntelligenceReportService } from '../../../services/teamIntelligenceReport/reportService.js';

const MANAGER_ROLES: OrgRole[] = ['OWNER', 'ADMIN'];
const DEV_ROLE_BYPASS_ENABLED =
  config.env === 'development' && process.env.ENABLE_DEV_AUTH === 'true';

type AccessibleOrg = {
  orgId: string;
  name: string;
};

type GenerateTeamIntelligenceReportArgs = {
  orgId?: string;
  orgName?: string;
  startTime?: string;
  endTime?: string;
  includeTranscripts?: boolean;
  limitPerUser?: number;
};

const reportArgsSchema = z.object({
  orgId: z.string().optional().describe('Optional organization ID. Prefer this when explicitly available.'),
  orgName: z.string().optional().describe('Optional organization name when the user refers to an org by name.'),
  startTime: z.string().optional().describe('Optional ISO timestamp for the report start time.'),
  endTime: z.string().optional().describe('Optional ISO timestamp for the report end time.'),
  includeTranscripts: z
    .boolean()
    .optional()
    .describe('Whether transcript signals should be included when available. Defaults to false.'),
  limitPerUser: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Maximum number of recent items to gather per user.'),
});

const normalize = (value?: string): string | undefined => {
  const nextValue = value?.trim();
  return nextValue ? nextValue.toLowerCase() : undefined;
};

const buildDownloadUrl = (context: XyneAIAgentContext, reportId: string): string => {
  const baseUrl = context.apiBaseUrl?.replace(/\/+$/, '') || '/api';
  return `${baseUrl}/org-intelligence-reports/${reportId}/pdf`;
};

const buildFilename = (title: string): string =>
  `${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'team-intelligence-report'}.pdf`;

const listAccessibleOrgs = async (
  userId: string,
  appRole: 'admin' | 'user' | undefined
): Promise<AccessibleOrg[]> => {
  if (appRole === 'admin') {
    const organizations = await db.organization.findMany({
      orderBy: { name: 'asc' },
      select: { orgId: true, name: true },
    });
    return organizations;
  }

  const memberships = await db.orgMember.findMany({
    where: {
      userId,
      ...(DEV_ROLE_BYPASS_ENABLED
        ? {}
        : {
            role: {
              in: MANAGER_ROLES,
            },
          }),
    },
    select: { orgId: true },
  });

  if (memberships.length === 0) {
    return [];
  }

  return db.organization.findMany({
    where: {
      orgId: {
        in: memberships.map(membership => membership.orgId),
      },
    },
    orderBy: { name: 'asc' },
    select: { orgId: true, name: true },
  });
};

const resolveOrg = (
  accessibleOrgs: AccessibleOrg[],
  args: GenerateTeamIntelligenceReportArgs
): AccessibleOrg | { error: string } => {
  if (accessibleOrgs.length === 0) {
    return {
      error:
        DEV_ROLE_BYPASS_ENABLED
          ? 'Error: Team intelligence reports are only available for organizations you belong to in local dev mode.'
          : 'Error: Team intelligence reports are only available to organization owners, organization admins, or platform admins.',
    };
  }

  if (args.orgId?.trim()) {
    const matchedOrg = accessibleOrgs.find(org => org.orgId === args.orgId?.trim());
    if (!matchedOrg) {
      return {
        error: 'Error: The requested organization is not within your accessible manager scope.',
      };
    }
    return matchedOrg;
  }

  const normalizedOrgName = normalize(args.orgName);
  if (normalizedOrgName) {
    const exactMatches = accessibleOrgs.filter(
      org => org.name.trim().toLowerCase() === normalizedOrgName
    );
    if (exactMatches.length === 1) {
      return exactMatches[0]!;
    }

    const partialMatches = accessibleOrgs.filter(org =>
      org.name.trim().toLowerCase().includes(normalizedOrgName)
    );
    if (partialMatches.length === 1) {
      return partialMatches[0]!;
    }

    if (exactMatches.length > 1 || partialMatches.length > 1) {
      const matchingOrgs = (exactMatches.length > 1 ? exactMatches : partialMatches)
        .map(org => org.name)
        .join(', ');
      return {
        error: `Error: Multiple accessible organizations match that name. Please specify one of: ${matchingOrgs}.`,
      };
    }

    return {
      error: `Error: No accessible organization matches "${args.orgName}".`,
    };
  }

  if (accessibleOrgs.length === 1) {
    return accessibleOrgs[0]!;
  }

  return {
    error: `Error: Multiple accessible organizations are available. Please specify one of: ${accessibleOrgs.map(org => org.name).join(', ')}.`,
  };
};

export function createGenerateTeamIntelligenceReportTool(): Tool<
  GenerateTeamIntelligenceReportArgs,
  XyneAIAgentContext
> {
  return {
    schema: {
      name: 'generate_team_intelligence_report',
      description: getDescription('generate_team_intelligence_report'),
      parameters: reportArgsSchema,
    },
    execute: async (args, context) => {
      try {
        const user = await db.user.findUnique({
          where: { id: context.userId },
          select: { id: true, email: true },
        });

        if (!user) {
          return 'Error: Authenticated user could not be resolved.';
        }

        const accessibleOrgs = await listAccessibleOrgs(user.id, context.appRole);
        const resolvedOrg = resolveOrg(accessibleOrgs, args);
        if ('error' in resolvedOrg) {
          return resolvedOrg.error;
        }

        const report = await teamIntelligenceReportService.createAndProcessReportNow(
          {
            userId: user.id,
            appRole: context.appRole,
          },
          {
            orgId: resolvedOrg.orgId,
            startTime: args.startTime,
            endTime: args.endTime,
            includeTranscripts: args.includeTranscripts,
            limitPerUser: args.limitPerUser,
          }
        );

        const title =
          typeof report.report === 'object' &&
          report.report !== null &&
          typeof (report.report as Record<string, unknown>).title === 'string'
            ? ((report.report as Record<string, unknown>).title as string)
            : `Team Intelligence Report for ${resolvedOrg.name}`;
        const downloadUrl = buildDownloadUrl(context, report.id);
        const fileName = buildFilename(title);

        context.onStreamEvent?.({
          type: 'team_intelligence_report_ready',
          reportArtifact: {
            reportId: report.id,
            title,
            fileName,
            downloadUrl,
          },
        });

        logger.info(`[Tool] [${context.sessionId}] Generated team intelligence report`, {
          reportId: report.id,
          orgId: resolvedOrg.orgId,
          requestedByUserId: user.id,
        });

        return [
          `Team intelligence report generated successfully for ${resolvedOrg.name}.`,
          `Title: ${title}`,
          `Download URL: ${downloadUrl}`,
          'When you respond to the user, explicitly say the PDF is ready in the chat window and include a markdown download link using the exact URL above.',
          report.markdown ? `Report markdown:\n${report.markdown}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
      } catch (error) {
        logger.error(`[Tool] [${context.sessionId}] generate_team_intelligence_report error:`, error);
        return `Error: ${error instanceof Error ? error.message : 'Unknown team intelligence report error'}`;
      }
    },
  };
}

export function getGenerateTeamIntelligenceReportTool() {
  return createGenerateTeamIntelligenceReportTool();
}
