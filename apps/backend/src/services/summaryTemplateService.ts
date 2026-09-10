import type { Prisma, SummaryTemplate } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import {
  DefaultOutlet,
  EntityUserAccess,
  ShareableEntityType,
  SummaryTemplateVisibility,
} from '@xyne/shared';
import { DEFAULT_RECORDING_SUMMARY_TEMPLATE } from './recordingSummaryTemplates';
import { summaryTemplateAiService } from './summaryTemplateAiService';

export type SummaryTemplateCreateInput = Pick<
  Prisma.SummaryTemplateUncheckedCreateInput,
  'name' | 'autoTriggerPrompt' | 'sections' | 'version' | 'defaultOutlet'
> & { systemPrompt?: string };

export type SummaryTemplateUpdateInput = Partial<SummaryTemplateCreateInput>;
export type SummaryTemplateView = SummaryTemplate & {
  canEdit: boolean;
  isSystem: boolean;
};

const SYSTEM_TEMPLATE_CREATOR = 'xyne-system';
const DEFAULT_SYSTEM_PROMPT =
  'Create an accurate, concise meeting summary using the supplied context and sections.';
const DEFAULT_TEMPLATE_CREATED_AT = new Date(0);

export class SummaryTemplateError extends Error {
  constructor(
    message: string,
    readonly statusCode: 403 | 404 | 502
  ) {
    super(message);
    this.name = 'SummaryTemplateError';
  }
}

function toPromptSections(value: unknown): Array<{ title: string; description: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((section) => {
    if (
      typeof section !== 'object' ||
      section === null ||
      Array.isArray(section) ||
      typeof section.title !== 'string' ||
      typeof section.description !== 'string'
    ) {
      return [];
    }
    return [{ title: section.title, description: section.description }];
  });
}

function parseBuiltinSections(fields: string): Prisma.JsonValue {
  const sections = fields
    .split(/\n(?=###\s)/)
    .map((section) => section.replace(/^---\s*/m, '').trim())
    .filter(Boolean)
    .map((section, index) => {
      const [heading = '', ...body] = section.split('\n');
      return {
        id: `section-${index + 1}`,
        title: heading.replace(/^###\s*/, '').trim(),
        description: body
          .filter((line) => line.trim() !== '---')
          .join('\n')
          .trim(),
      };
    });

  return sections as Prisma.JsonValue;
}

export class SummaryTemplateService {
  private readonly db = DatabaseClient.getInstance();

  private getDefaultTemplate(workspaceId: string): SummaryTemplate {
    const template = DEFAULT_RECORDING_SUMMARY_TEMPLATE;
    return {
      id: template.id,
      workspaceId,
      name: template.name,
      autoTriggerPrompt: template.selectionCriteria,
      sections: parseBuiltinSections(template.fields),
      version: 1,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      defaultOutlet: DefaultOutlet.EMAIL,
      createdBy: SYSTEM_TEMPLATE_CREATOR,
      createdAt: DEFAULT_TEMPLATE_CREATED_AT,
      visibility: SummaryTemplateVisibility.PRIVATE,
    };
  }

  private isDefaultTemplateId(templateId: string, workspaceId: string): boolean {
    return (
      templateId === DEFAULT_RECORDING_SUMMARY_TEMPLATE.id ||
      templateId === `${workspaceId}:summary-template:${DEFAULT_RECORDING_SUMMARY_TEMPLATE.id}`
    );
  }

  private async getAccessibleSharedIds(
    workspaceId: string,
    actorUserId: string
  ): Promise<Set<string>> {
    const [groupMappings, channelParticipations] = await Promise.all([
      this.db.userGroupMapping.findMany({
        where: { userId: actorUserId },
        select: { userGroupId: true },
      }),
      this.db.channelParticipant.findMany({
        where: { userId: actorUserId },
        select: { channelId: true },
      }),
    ]);
    const userGroupIds = groupMappings.map((mapping) => mapping.userGroupId);
    const channelIds = channelParticipations.map((participation) => participation.channelId);
    const shares = await this.db.entityAccess.findMany({
      where: {
        workspaceId,
        shareableEntityType: ShareableEntityType.SUMMARY_TEMPLATE,
        entityUserAccess: { not: EntityUserAccess.REVOKED },
        OR: [
          { userId: actorUserId },
          ...(userGroupIds.length ? [{ userGroupId: { in: userGroupIds } }] : []),
          ...(channelIds.length ? [{ channelId: { in: channelIds } }] : []),
        ],
      },
      select: { entityId: true },
    });
    return new Set(shares.map((share) => share.entityId));
  }

  private toView(template: SummaryTemplate, actorUserId: string): SummaryTemplateView {
    const isSystem = template.createdBy === SYSTEM_TEMPLATE_CREATOR;
    return {
      ...template,
      canEdit: !isSystem && template.createdBy === actorUserId,
      isSystem,
    };
  }

  async list(workspaceId: string, actorUserId: string): Promise<SummaryTemplateView[]> {
    const accessibleSharedIds = await this.getAccessibleSharedIds(workspaceId, actorUserId);
    const templates = await this.db.summaryTemplate.findMany({
      where: {
        workspaceId,
        createdBy: { not: SYSTEM_TEMPLATE_CREATOR },
        OR: [
          { visibility: SummaryTemplateVisibility.PUBLIC },
          { createdBy: actorUserId },
          { id: { in: [...accessibleSharedIds] } },
        ],
      },
      orderBy: [{ name: 'asc' }, { version: 'desc' }, { id: 'asc' }],
    });
    return templates.map((template) => this.toView(template, actorUserId));
  }

  async findAccessibleById(
    templateId: string,
    workspaceId: string,
    actorUserId: string
  ): Promise<SummaryTemplate | null> {
    if (this.isDefaultTemplateId(templateId, workspaceId)) {
      return this.getDefaultTemplate(workspaceId);
    }

    const template = await repositories.summaryTemplates.findById(templateId);
    if (
      !template ||
      template.workspaceId !== workspaceId ||
      template.createdBy === SYSTEM_TEMPLATE_CREATOR
    ) {
      return null;
    }
    if (
      template.createdBy === actorUserId ||
      template.visibility === SummaryTemplateVisibility.PUBLIC
    ) {
      return template;
    }

    const accessibleSharedIds = await this.getAccessibleSharedIds(workspaceId, actorUserId);
    return accessibleSharedIds.has(template.id) ? template : null;
  }

  async ensureGeneratedSystemPrompt(template: SummaryTemplate): Promise<SummaryTemplate | null> {
    if (
      template.createdBy === SYSTEM_TEMPLATE_CREATOR ||
      template.systemPrompt.trim() !== DEFAULT_SYSTEM_PROMPT
    ) {
      return template;
    }

    const systemPrompt = await summaryTemplateAiService.generateSystemPrompt(
      {
        name: template.name,
        meetingContext: template.autoTriggerPrompt,
        sections: toPromptSections(template.sections),
      },
      `summary-template-system:${template.workspaceId}:${template.id}`
    );
    if (!systemPrompt) return null;

    return repositories.summaryTemplates.update(template.id, { systemPrompt });
  }

  async create(
    workspaceId: string,
    createdBy: string,
    input: SummaryTemplateCreateInput
  ): Promise<SummaryTemplateView> {
    const systemPrompt =
      input.systemPrompt?.trim() ||
      (await summaryTemplateAiService.generateSystemPrompt(
        {
          name: input.name,
          meetingContext: input.autoTriggerPrompt,
          sections: toPromptSections(input.sections),
        },
        `summary-template-system:${workspaceId}:${createdBy}`
      ));
    if (!systemPrompt) {
      throw new SummaryTemplateError('Unable to generate the template system prompt', 502);
    }

    const template = await this.db.summaryTemplate.create({
      data: {
        workspaceId,
        createdBy,
        name: input.name,
        autoTriggerPrompt: input.autoTriggerPrompt,
        sections: input.sections,
        version: input.version ?? 1,
        systemPrompt,
        defaultOutlet: input.defaultOutlet ?? DefaultOutlet.EMAIL,
      },
    });
    return this.toView(template, createdBy);
  }

  async update(
    templateId: string,
    workspaceId: string,
    actorUserId: string,
    input: SummaryTemplateUpdateInput
  ): Promise<SummaryTemplateView> {
    const existing = await repositories.summaryTemplates.findById(templateId);
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new SummaryTemplateError('Summary template not found', 404);
    }
    if (existing.createdBy !== actorUserId || existing.createdBy === SYSTEM_TEMPLATE_CREATOR) {
      throw new SummaryTemplateError('Only the template creator can update it', 403);
    }

    const { systemPrompt: requestedSystemPrompt, ...updates } = input;
    const promptSourceChanged =
      input.name !== undefined ||
      input.autoTriggerPrompt !== undefined ||
      input.sections !== undefined;
    let systemPrompt = requestedSystemPrompt?.trim() || undefined;
    if (!systemPrompt && promptSourceChanged) {
      systemPrompt =
        (await summaryTemplateAiService.generateSystemPrompt(
          {
            name: input.name ?? existing.name,
            meetingContext:
              input.autoTriggerPrompt !== undefined
                ? input.autoTriggerPrompt
                : existing.autoTriggerPrompt,
            sections: toPromptSections(input.sections ?? existing.sections),
          },
          `summary-template-system:${workspaceId}:${templateId}`
        )) ?? undefined;
      if (!systemPrompt) {
        throw new SummaryTemplateError('Unable to generate the template system prompt', 502);
      }
    }

    const template = await repositories.summaryTemplates.update(templateId, {
      ...updates,
      ...(systemPrompt ? { systemPrompt } : {}),
    });
    return this.toView(template, actorUserId);
  }

  async delete(templateId: string, workspaceId: string, actorUserId: string): Promise<void> {
    const existing = await repositories.summaryTemplates.findById(templateId);
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new SummaryTemplateError('Summary template not found', 404);
    }
    if (existing.createdBy !== actorUserId || existing.createdBy === SYSTEM_TEMPLATE_CREATOR) {
      throw new SummaryTemplateError('Only the template creator can delete it', 403);
    }

    await this.db.$transaction([
      this.db.entityAccess.deleteMany({
        where: {
          workspaceId,
          shareableEntityType: ShareableEntityType.SUMMARY_TEMPLATE,
          entityId: templateId,
        },
      }),
      this.db.summaryTemplate.delete({ where: { id: templateId } }),
    ]);
  }
}

export const summaryTemplateService = new SummaryTemplateService();
