import { Prisma, type ConversationLabel } from '@prisma/client';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { AutomationStatus } from '../types/status';
import { DESK_AUTOMATION_WORKFLOW_TYPE } from '../types/workflow-adapter';

export interface ConversationLabelDeleteImpact {
  label: {
    id: string;
    name: string;
    channelId: string;
  };
  mappingCount: number;
  linkedDeskRuleCount: number;
}

export interface ConversationLabelDeleteResult extends ConversationLabelDeleteImpact {
  archivedDeskRuleCount: number;
  removedMappingCount: number;
}

export class ConversationLabelLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'forbidden' | 'label-in-use',
    readonly impact?: ConversationLabelDeleteImpact,
  ) {
    super(message);
    this.name = 'ConversationLabelLifecycleError';
  }
}

type LabelLifecycleDbClient = typeof db | Prisma.TransactionClient;

class ConversationLabelLifecycleService {
  async getDeleteImpact(
    auth: { userId: string; workspaceId: string },
    labelId: string,
  ): Promise<ConversationLabelDeleteImpact> {
    const label = await this.requireOwnedLabel(db, auth, labelId);
    return this.calculateImpact(db, label);
  }

  async deleteLabel(
    auth: { userId: string; workspaceId: string },
    labelId: string,
  ): Promise<ConversationLabelDeleteResult> {
    await this.requireOwnedLabel(db, auth, labelId);

    try {
      return await db.$transaction(async tx => {
        const label = await this.requireOwnedLabel(tx, auth, labelId);
        const impact = await this.calculateImpact(tx, label);

        const linkedRules = await tx.deskAutoLabelRuleReference.findMany({
          where: this.linkedDeskRuleReferenceWhere(label),
          select: { workflowId: true },
        });
        const archiveResult = await tx.workflow.updateMany({
          where: {
            id: { in: linkedRules.map(rule => rule.workflowId) },
            workspaceId: label.workspaceId,
            workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
            status: { in: [AutomationStatus.ACTIVE, AutomationStatus.DISABLED] },
          },
          data: {
            status: AutomationStatus.ARCHIVED,
            updatedAt: new Date(),
          },
        });

        await tx.deskAutoLabelRuleReference.deleteMany({
          where: {
            workspaceId: label.workspaceId,
            labelId: label.id,
          },
        });

        await tx.conversationLabelMapping.deleteMany({
          where: {
            labelId: label.id,
            workspaceId: label.workspaceId,
            createdBy: label.createdBy,
          },
        });

        await tx.conversationLabel.delete({ where: { id: label.id } });

        return {
          ...impact,
          archivedDeskRuleCount: archiveResult.count,
          removedMappingCount: impact.mappingCount,
        };
      });
    } catch (err) {
      if (err instanceof ConversationLabelLifecycleError) throw err;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        const impact = await this.getDeleteImpact(auth, labelId);
        throw new ConversationLabelLifecycleError(
          'Label is still referenced by an automation.',
          'label-in-use',
          impact,
        );
      }
      throw err;
    }
  }

  private async requireOwnedLabel(
    client: LabelLifecycleDbClient,
    auth: { userId: string; workspaceId: string },
    labelId: string,
  ): Promise<ConversationLabel> {
    const label = await client.conversationLabel.findUnique({ where: { id: labelId } });
    if (!label || label.workspaceId !== auth.workspaceId) {
      throw new ConversationLabelLifecycleError('Label not found', 'not-found');
    }
    if (label.createdBy !== auth.userId) {
      throw new ConversationLabelLifecycleError(
        'You can only delete your own labels.',
        'forbidden',
      );
    }

    const isParticipant = await repositories.channelParticipants.isParticipant(
      label.channelId,
      auth.userId,
    );
    if (!isParticipant) {
      throw new ConversationLabelLifecycleError(
        'You must be a member of this desk channel.',
        'forbidden',
      );
    }

    return label;
  }

  private async calculateImpact(
    client: LabelLifecycleDbClient,
    label: ConversationLabel,
  ): Promise<ConversationLabelDeleteImpact> {
    const [mappingCount, linkedDeskRuleCount] = await Promise.all([
      client.conversationLabelMapping.count({
        where: {
          labelId: label.id,
          workspaceId: label.workspaceId,
          createdBy: label.createdBy,
        },
      }),
      client.deskAutoLabelRuleReference.count({
        where: this.linkedDeskRuleReferenceWhere(label),
      }),
    ]);

    return {
      label: {
        id: label.id,
        name: label.name,
        channelId: label.channelId,
      },
      mappingCount,
      linkedDeskRuleCount,
    };
  }

  private linkedDeskRuleReferenceWhere(
    label: ConversationLabel,
  ): Prisma.DeskAutoLabelRuleReferenceWhereInput {
    return {
      workspaceId: label.workspaceId,
      labelId: label.id,
      workflow: {
        workspaceId: label.workspaceId,
        workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
        status: { in: [AutomationStatus.ACTIVE, AutomationStatus.DISABLED] },
      },
    };
  }
}

export const conversationLabelLifecycleService = new ConversationLabelLifecycleService();
