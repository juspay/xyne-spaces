import type { Prisma, SummaryTemplate } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { DefaultOutlet, ShareableEntityType, SummaryTemplateVisibility } from '@xyne/shared';
import { DEFAULT_RECORDING_SUMMARY_TEMPLATE } from './recordingSummaryTemplates';
import { summaryTemplateAiService } from './summaryTemplateAiService';
import { summaryTemplatePublicationService } from './summaryTemplatePublicationService';
import {
  summaryTemplateSharingService,
  type SummaryTemplateShareLevel,
} from './summaryTemplateSharingService';
import {
  getDisabledMandatorySummarySectionIds,
  getEnabledSummaryTemplateSections,
  hasDisabledNonMandatorySummarySection,
} from './summaryTemplateSections';

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
    readonly statusCode: 400 | 403 | 404 | 409 | 502
  ) {
    super(message);
    this.name = 'SummaryTemplateError';
  }
}

/** Carries the clashing names so the uploader can see which rows to drop. */
export class SummaryTemplateNamesTakenError extends SummaryTemplateError {
  constructor(readonly names: string[]) {
    super(`Already used in this workspace: ${names.join(', ')}`, 409);
    this.name = 'SummaryTemplateNamesTakenError';
  }
}

function toPromptSections(value: unknown): Array<{ title: string; description: string }> {
  if (!Array.isArray(value)) return [];
  const enabled = getEnabledSummaryTemplateSections(value as Prisma.JsonValue);
  if (!Array.isArray(enabled)) return [];
  return enabled.flatMap((section) => {
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

  /**
   * The Decisions / Action Items sections can only be switched off (or back on) by a
   * Scribe admin, and only those two reserved sections may carry the flag at all.
   * Non-admins may still save a template that already has a section disabled, as
   * long as they leave that state untouched.
   */
  private async assertMandatorySectionChangesAllowed(
    sections: unknown,
    existingSections: Prisma.JsonValue | null,
    workspaceId: string,
    actorUserId: string
  ): Promise<void> {
    if (sections === undefined) return;
    const next = sections as Prisma.JsonValue;
    if (hasDisabledNonMandatorySummarySection(next)) {
      throw new SummaryTemplateError(
        'Only the Decisions and Action Items sections can be disabled',
        400
      );
    }

    const nextDisabled = getDisabledMandatorySummarySectionIds(next);
    const previousDisabled = getDisabledMandatorySummarySectionIds(existingSections);
    const changed =
      nextDisabled.size !== previousDisabled.size ||
      [...nextDisabled].some((id) => !previousDisabled.has(id));
    if (!changed) return;

    const isAdmin = await summaryTemplatePublicationService.isAdmin(workspaceId, actorUserId);
    if (!isAdmin) {
      throw new SummaryTemplateError(
        'Only a Scribe admin can enable or disable the Decisions and Action Items sections',
        403
      );
    }
  }

  private isDefaultTemplateId(templateId: string, workspaceId: string): boolean {
    return (
      templateId === DEFAULT_RECORDING_SUMMARY_TEMPLATE.id ||
      templateId === `${workspaceId}:summary-template:${DEFAULT_RECORDING_SUMMARY_TEMPLATE.id}`
    );
  }

  /** The creator, or anyone holding an EDIT share, can edit. */
  private toView(
    template: SummaryTemplate,
    actorUserId: string,
    sharedLevels: ReadonlyMap<string, SummaryTemplateShareLevel>
  ): SummaryTemplateView {
    const isSystem = template.createdBy === SYSTEM_TEMPLATE_CREATOR;
    return {
      ...template,
      canEdit:
        !isSystem &&
        (template.createdBy === actorUserId || sharedLevels.get(template.id) === 'edit'),
      isSystem,
    };
  }

  async list(workspaceId: string, actorUserId: string): Promise<SummaryTemplateView[]> {
    const sharedLevels = await summaryTemplateSharingService.findSharedTemplateLevels(
      workspaceId,
      actorUserId
    );
    const templates = await this.db.summaryTemplate.findMany({
      where: {
        workspaceId,
        createdBy: { not: SYSTEM_TEMPLATE_CREATOR },
        OR: [
          { visibility: SummaryTemplateVisibility.PUBLIC },
          { createdBy: actorUserId },
          { id: { in: [...sharedLevels.keys()] } },
        ],
      },
      orderBy: [{ name: 'asc' }, { version: 'desc' }, { id: 'asc' }],
    });
    return templates.map((template) => this.toView(template, actorUserId, sharedLevels));
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

    // Any live share is enough to see and apply the template.
    const sharedLevels = await summaryTemplateSharingService.findSharedTemplateLevels(
      workspaceId,
      actorUserId,
      template.id
    );
    return sharedLevels.has(template.id) ? template : null;
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

  /**
   * The system prompt a template would summarize with, generating one in memory (never
   * persisted) when it has none of its own, as create/ensureGeneratedSystemPrompt would.
   */
  async resolveDraftSystemPrompt(
    draft: Pick<SummaryTemplate, 'name' | 'autoTriggerPrompt' | 'sections' | 'systemPrompt'>,
    requestId: string
  ): Promise<string | null> {
    const own = draft.systemPrompt.trim();
    if (own && own !== DEFAULT_SYSTEM_PROMPT) return own;
    return summaryTemplateAiService.generateSystemPrompt(
      {
        name: draft.name,
        meetingContext: draft.autoTriggerPrompt,
        sections: toPromptSections(draft.sections),
      },
      requestId
    );
  }

  async create(
    workspaceId: string,
    createdBy: string,
    input: SummaryTemplateCreateInput
  ): Promise<SummaryTemplateView> {
    await this.assertMandatorySectionChangesAllowed(input.sections, null, workspaceId, createdBy);

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
    return this.toView(template, createdBy, new Map());
  }

  /** Scribe admins only. Creates every template, or none. */
  async bulkCreate(
    workspaceId: string,
    createdBy: string,
    inputs: SummaryTemplateCreateInput[]
  ): Promise<SummaryTemplateView[]> {
    const isAdmin = await summaryTemplatePublicationService.isAdmin(workspaceId, createdBy);
    if (!isAdmin) {
      throw new SummaryTemplateError('Only a Scribe admin can bulk upload templates', 403);
    }

    const seen = new Set<string>();
    for (const input of inputs) {
      const key = input.name.trim().toLowerCase();
      if (seen.has(key)) {
        throw new SummaryTemplateError(`"${input.name}" appears more than once`, 400);
      }
      seen.add(key);
      await this.assertMandatorySectionChangesAllowed(input.sections, null, workspaceId, createdBy);
    }

    // Names are unique across the workspace, including templates the uploader cannot see.
    const existing = await this.db.summaryTemplate.findMany({
      where: { workspaceId },
      select: { name: true },
    });
    const existingKeys = new Set(existing.map((template) => template.name.trim().toLowerCase()));
    const taken = inputs
      .map((input) => input.name)
      .filter((name) => existingKeys.has(name.trim().toLowerCase()));
    if (taken.length > 0) throw new SummaryTemplateNamesTakenError(taken);

    try {
      // A blank prompt is generated on first use, see ensureGeneratedSystemPrompt.
      const templates = await this.db.$transaction(
        inputs.map((input) =>
          this.db.summaryTemplate.create({
            data: {
              workspaceId,
              createdBy,
              name: input.name,
              autoTriggerPrompt: input.autoTriggerPrompt,
              sections: input.sections,
              version: input.version ?? 1,
              systemPrompt: input.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
              defaultOutlet: input.defaultOutlet ?? DefaultOutlet.EMAIL,
            },
          })
        )
      );
      return templates.map((template) => this.toView(template, createdBy, new Map()));
    } catch (error) {
      // Someone created one of these names between the check above and the insert.
      if ((error as { code?: string } | null)?.code === 'P2002') {
        throw new SummaryTemplateError(
          'A template name was taken while uploading. Nothing was created; try again.',
          409
        );
      }
      throw error;
    }
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
    if (existing.createdBy === SYSTEM_TEMPLATE_CREATOR) {
      throw new SummaryTemplateError('Starter templates cannot be edited', 403);
    }
    const sharedLevels =
      existing.createdBy === actorUserId
        ? new Map<string, SummaryTemplateShareLevel>()
        : await summaryTemplateSharingService.findSharedTemplateLevels(
            workspaceId,
            actorUserId,
            templateId
          );
    if (existing.createdBy !== actorUserId && sharedLevels.get(templateId) !== 'edit') {
      throw new SummaryTemplateError('You do not have edit access to this template', 403);
    }
    await this.assertMandatorySectionChangesAllowed(
      input.sections,
      existing.sections,
      workspaceId,
      actorUserId
    );

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
    return this.toView(template, actorUserId, sharedLevels);
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
