import { transaction } from '../base';
import { AutomationStatus } from '@/automations/types/status';
import { ConversationLabelLifecycleService } from '@/automations/services/conversation-label-lifecycle.service';
import { DESK_AUTOMATION_WORKFLOW_TYPE } from '@/automations/types/workflow-adapter';
import { db } from '@/database/client';


export function deleteLabelTx(self: ConversationLabelLifecycleService, auth: { userId: string; workspaceId: string; }, labelId: string) {
  return transaction(['ConversationLabel', 'ConversationLabelMapping', 'DeskAutoLabelRuleReference', 'Workflow'], 'deleteLabel: label, mappings, desk rule references and workflow archival must commit atomically; tx is not ACL-wrapped', db, async tx => {
    const label = await self.requireOwnedLabel(tx, auth, labelId);
    const impact = await self.calculateImpact(tx, label);

    const linkedRules = await tx.deskAutoLabelRuleReference.findMany({
      where: self.linkedDeskRuleReferenceWhere(label),
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
}
