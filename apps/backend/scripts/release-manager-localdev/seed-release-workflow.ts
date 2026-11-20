#!/usr/bin/env npx tsx

/**
 * Creates the release analysis workflow for every main release board (a board with services).
 * Idempotent: a board that already has its "Release analysis" workflow gets its definition refreshed.
 *
 * A new Release ticket on the board reads its commit range, finds the merged pull requests,
 * creates the service tickets, and per affected service adds the dev tickets and the env and
 * migration changes under it, and moves the service's deployed commit.
 *
 * Run via:  npx tsx apps/backend/scripts/release-manager-localdev/seed-release-workflow.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const item = '{{steps.__loop.output.currentItem';

const buildConfig = (boardId: string) => ({
  trigger: { type: 'TICKET_CREATED', config: { boardIds: [boardId] } },
  steps: [
    {
      id: 'config',
      type: 'GET_RELEASE_CONFIGURATION',
      title: 'Get release configuration',
      config: { boardId: '{{trigger.ticket.boardId}}' },
    },
    {
      id: 'gate',
      type: 'CONDITIONAL',
      title: 'Is it a commit-range release?',
      config: {
        condition: {
          all: [
            {
              any: [
                { variable: '{{trigger.ticket.ticketType}}', operator: 'eq', value: 'Release' },
                { variable: '{{trigger.ticket.ticketType}}', operator: 'eq', value: 'Hotfix' },
              ],
            },
            { variable: '{{steps.config.output.trackingMode}}', operator: 'neq', value: 'VERSION' },
          ],
        },
        if_true: [
          {
            id: 'analyze',
            type: 'ANALYZE_COMMIT_RANGE',
            title: 'Analyze commit range',
            config: {
              vcsProvider: '{{steps.config.output.vcsProvider}}',
              owner: '{{steps.config.output.owner}}',
              repo: '{{steps.config.output.repo}}',
              ticketPrefix: '{{steps.config.output.ticketPrefix}}',
              releaseTicket: '{{trigger.ticket.xyneId}}',
              boardId: '{{trigger.ticket.boardId}}',
            },
          },
          {
            id: 'services',
            type: 'LOOP',
            title: 'For each affected service',
            config: {
              source: 'steps.analyze.output.services',
              body: [
                {
                  id: 'dev_tickets',
                  type: 'ADD_TICKETS_UNDER_RELEASE',
                  title: 'Add the dev tickets',
                  config: { ticket: `${item}.xyneId}}`, xyneIds: `${item}.xyneIds}}` },
                },
                {
                  id: 'changes',
                  type: 'LOOP',
                  title: 'For each env or migration change',
                  config: {
                    source: 'steps.__loop.output.currentItem.changes',
                    body: [
                      {
                        id: 'change',
                        type: 'ADD_CHANGE_UNDER_RELEASE',
                        title: 'Add the change',
                        config: {
                          ticket: `${item}.serviceXyneId}}`,
                          kind: `${item}.kind}}`,
                          filePath: `${item}.filePath}}`,
                          diff: `${item}.diff}}`,
                          commitId: `${item}.commitId}}`,
                          sourceXyneId: `${item}.sourceXyneId}}`,
                          fileStatus: `${item}.fileStatus}}`,
                        },
                      },
                    ],
                  },
                },
                {
                  id: 'deployed',
                  type: 'UPDATE_DEPLOYED_COMMIT',
                  title: 'Move the deployed commit',
                  config: {
                    releaseTicket: '{{trigger.ticket.xyneId}}',
                    commitId: '{{steps.analyze.output.newCommitId}}',
                    services: [`${item}.name}}`],
                  },
                },
              ],
            },
          },
          {
            id: 'publish',
            type: 'PUBLISH_COMMIT_ANALYSIS',
            title: 'Publish the analysis report and canvas',
            config: {
              releaseTicket: '{{trigger.ticket.xyneId}}',
              boardId: '{{trigger.ticket.boardId}}',
              analysis: '{{steps.analyze.output}}',
            },
          },
        ],
      },
    },
  ],
});

async function main() {
  const boards = await prisma.board.findMany({
    where: { mainReleaseApplications: { some: {} } },
    select: { id: true, name: true, workspaceId: true },
  });
  for (const board of boards) {
    const name = `Release analysis (${board.name})`;
    const existing = await prisma.workflow.findFirst({
      where: { workspaceId: board.workspaceId, workflowType: 'Workflow', workflowName: name },
      select: { id: true },
    });
    if (existing) {
      await prisma.workflow.update({ where: { id: existing.id }, data: { context: JSON.stringify(buildConfig(board.id)) } });
      console.log(`updated ${name}: ${existing.id}`);
      continue;
    }
    const created = await prisma.workflow.create({
      data: {
        workspaceId: board.workspaceId,
        workflowType: 'Workflow',
        workflowName: name,
        status: 'ACTIVE',
        eventType: 'TICKET_CREATED',
        context: JSON.stringify(buildConfig(board.id)),
        metadata: JSON.stringify({ name }),
        folderId: 'default',
      },
      select: { id: true },
    });
    console.log(`created ${name}: ${created.id}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
