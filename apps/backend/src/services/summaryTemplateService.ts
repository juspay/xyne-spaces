import type { Prisma, SummaryTemplate } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { DefaultOutlet } from '@xyne/shared';

export type SummaryTemplateCreateInput = Pick<
  Prisma.SummaryTemplateUncheckedCreateInput,
  'name' | 'autoTriggerPrompt' | 'sections' | 'version' | 'systemPrompt' | 'defaultOutlet'
>;

export type SummaryTemplateUpdateInput = Partial<SummaryTemplateCreateInput>;

export class SummaryTemplateError extends Error {
  constructor(
    message: string,
    readonly statusCode: 403 | 404
  ) {
    super(message);
    this.name = 'SummaryTemplateError';
  }
}

export class SummaryTemplateService {
  list(workspaceId: string): Promise<SummaryTemplate[]> {
    return repositories.summaryTemplates.listByWorkspace(workspaceId);
  }

  create(
    workspaceId: string,
    createdBy: string,
    input: SummaryTemplateCreateInput
  ): Promise<SummaryTemplate> {
    return DatabaseClient.getInstance().summaryTemplate.create({
      data: {
        workspaceId,
        createdBy,
        name: input.name,
        autoTriggerPrompt: input.autoTriggerPrompt,
        sections: input.sections,
        version: input.version ?? 1,
        systemPrompt: input.systemPrompt,
        defaultOutlet: input.defaultOutlet ?? DefaultOutlet.EMAIL,
      },
    });
  }

  async update(
    templateId: string,
    workspaceId: string,
    actorUserId: string,
    input: SummaryTemplateUpdateInput
  ): Promise<SummaryTemplate> {
    const existing = await repositories.summaryTemplates.findById(templateId);
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new SummaryTemplateError('Summary template not found', 404);
    }
    if (existing.createdBy !== actorUserId) {
      throw new SummaryTemplateError('Only the template creator can update it', 403);
    }

    return DatabaseClient.getInstance().summaryTemplate.update({
      where: { id: templateId },
      data: input,
    });
  }
}

export const summaryTemplateService = new SummaryTemplateService();
