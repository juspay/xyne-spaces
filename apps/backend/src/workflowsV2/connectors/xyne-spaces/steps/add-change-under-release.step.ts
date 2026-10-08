import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { FormContextType, FormEntityType } from '@xyne/shared';
import { z } from 'zod';
import { db } from '@/database/client';
import { ReleaseRepository } from '@/database/repositories/releaseRepository';
import { DiffParser, FileChangeType } from '@/services/release/core';
import { XyneRelease } from '@/services/release/xyne/xyneRelease';
import { XyneChangeType } from '@/services/release/xyne/xyneReleaseForm';
import { actorOf, workspaceOf } from '../context';

const AddChangeUnderReleaseConfigSchema = z.object({
  ticket: variableRef(z.string().min(1)).describe("Ticket id or ID like PLAT-12 of a release's service ticket"),
  kind: variableRef(z.enum([XyneChangeType.ENV, XyneChangeType.MIGRATION])).describe('ENV or MIGRATION'),
  filePath: variableRef(z.string().min(1)),
  diff: variableRef(z.string()).describe("The file's change as a unified diff"),
  commitId: variableRef(z.string()).optional().describe('Commit the change came from'),
  sourceXyneId: variableRef(z.string()).optional().describe('ID like PLAT-12 of the ticket the change belongs to'),
  fileStatus: variableRef(z.string()).optional().describe('added, modified or removed; defaults to modified'),
});
type AddChangeUnderReleaseConfig = z.infer<typeof AddChangeUnderReleaseConfigSchema>;

const AddChangeUnderReleaseOutputSchema = z.object({
  changeId: z.string(),
  created: z.boolean().describe('False when the same change was already saved'),
  kind: z.string(),
  filePath: z.string(),
});
type AddChangeUnderReleaseOutput = z.infer<typeof AddChangeUnderReleaseOutputSchema>;

const releaseRepository = new ReleaseRepository();
const xyneRelease = new XyneRelease();

export class AddChangeUnderReleaseStep extends BaseActionStep<typeof AddChangeUnderReleaseConfigSchema, AddChangeUnderReleaseOutput> {
  readonly type = 'ADD_CHANGE_UNDER_RELEASE';
  readonly configSchema = AddChangeUnderReleaseConfigSchema;
  readonly outputSchema = AddChangeUnderReleaseOutputSchema;
  readonly name = 'Add change under a release';
  readonly description = "Records an env or migration change from a file's diff under one of a release's service tickets.";
  readonly category = 'release';
  readonly icon = 'FileDiff';

  async execute(config: AddChangeUnderReleaseConfig, ctx: StepExecutionContext): Promise<AddChangeUnderReleaseOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
    const identifier = text(config.ticket);
    const kind = text(config.kind) as XyneChangeType.ENV | XyneChangeType.MIGRATION;
    const filePath = text(config.filePath);
    const commitId = text(config.commitId) || null;
    const devTicketXyneId = text(config.sourceXyneId) || null;

    const target = await db.ticket.findFirst({
      where: { workspaceId, OR: [{ id: identifier }, { xyneId: identifier }] },
      select: { id: true, xyneId: true, boardId: true },
    });
    if (!target) throw new Error(`Ticket ${identifier} not found`);

    const parents = await db.ticketSubTicketMapping.findMany({
      where: { subTicket: { mappedTicketId: target.id } },
      select: {
        subTicketId: true,
        ticket: { select: { id: true, boardId: true, channelId: true, conversationId: true } },
      },
    });
    const service = await db.application.findFirst({
      where: { boardId: target.boardId, mainReleaseBoardId: { in: parents.map((parent) => parent.ticket.boardId) } },
      select: { id: true, mainReleaseBoardId: true },
    });
    const release = service ? parents.find((parent) => parent.ticket.boardId === service.mainReleaseBoardId) : undefined;
    if (!service || !release) {
      throw new Error(`Ticket ${target.xyneId} is not a service ticket of a release, so it cannot hold env or migration changes`);
    }

    const instance = {
      applicationId: service.id,
      changeType: kind,
      releaseId: release.ticket.id,
      applicationReleaseId: release.subTicketId,
      devTicketXyneId,
      commitId,
      filePath,
    };
    const existing = await db.releaseChangeType.findFirst({ where: instance, select: { id: true } });
    if (existing) return { changeId: existing.id, created: false, kind, filePath };

    const rawDiff = String(config.diff ?? '');
    const diff = rawDiff.startsWith('--- ') ? rawDiff : `--- a/${filePath}\n+++ b/${filePath}\n${rawDiff}\n`;
    const fileName = filePath.split('/').pop() || filePath;
    const status = text(config.fileStatus).toLowerCase();
    const fileChangeType =
      status === 'added' ? FileChangeType.ADDED : status === 'removed' ? FileChangeType.REMOVED : FileChangeType.MODIFIED;

    const userId = await actorOf(ctx, this.type);
    const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
    const releaseContext = {
      releaseId: release.ticket.id,
      applicationReleaseId: release.subTicketId,
      userId,
      userName: user?.name ?? 'Workflow',
      channelId: release.ticket.channelId,
      conversationId: release.ticket.conversationId,
    };

    const changeInstance = await releaseRepository.createReleaseChangeInstance(instance);
    if (kind === XyneChangeType.ENV) {
      const parsed = DiffParser.parseEnvDiff(diff, fileName);
      const { formValues, payload, message } = xyneRelease.getChange({
        type: XyneChangeType.ENV,
        data: {
          fileName,
          filePath,
          fileSlug: fileName.toUpperCase().replace(/[.-]/g, '_'),
          changeType: fileChangeType,
          oldValue: parsed.oldValue,
          newValue: parsed.newValue,
          description: parsed.changeSummary,
        },
      });
      await releaseRepository.saveReleaseFormValues(
        changeInstance.id,
        payload,
        message,
        formValues,
        FormContextType.RELEASE_CHANGE,
        FormEntityType.RELEASE_ENV_FORM,
        releaseContext,
      );
    } else {
      const parsed = DiffParser.parseMigrationDiff(diff, fileName);
      const { formValues, payload, message } = xyneRelease.getChange({
        type: XyneChangeType.MIGRATION,
        data: {
          filePath,
          changeLog: parsed.changeLog,
          description: `Database migration file ${fileName} changed.`,
          query: parsed.query,
        },
      });
      await releaseRepository.saveReleaseFormValues(
        changeInstance.id,
        payload,
        message,
        formValues,
        FormContextType.RELEASE_CHANGE,
        FormEntityType.RELEASE_MIGRATION_FORM,
        releaseContext,
      );
    }
    return { changeId: changeInstance.id, created: true, kind, filePath };
  }
}
