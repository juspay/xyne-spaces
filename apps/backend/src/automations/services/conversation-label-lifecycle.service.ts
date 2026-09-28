import { Prisma, type ConversationLabel } from '@prisma/client';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { AutomationStatus } from '../types/status';
import { DESK_AUTOMATION_WORKFLOW_TYPE } from '../types/workflow-adapter';
import { websocketService } from '@/services/websocketService';
import { deleteLabelTx } from '@/bypassAcl/transactions/conversationLabelLifecycleService';

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

export class ConversationLabelLifecycleService {
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
    const ownedLabel = await this.requireOwnedLabel(db, auth, labelId);

    try {
      const result = await deleteLabelTx(this, auth, labelId);
      websocketService.broadcastLabelUnreadCountsUpdate(ownedLabel.channelId);
      return result;
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

  async requireOwnedLabel(
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

  async calculateImpact(
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

  linkedDeskRuleReferenceWhere(
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

