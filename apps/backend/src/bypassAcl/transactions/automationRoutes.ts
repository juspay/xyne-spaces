import { z } from 'zod';
import { transaction } from '../base';
import { AutomationStatus } from '@/automations/types/status';
import type { AutomationConfig } from '@/automations/types/automation-config';
import { claimAutomationTemplates } from '@/bypassAcl/transactions/automationTemplateService';
import { triggerTypeToEventType, AUTOMATION_WORKFLOW_TYPE, buildAutomationMetadata } from '@/automations/types/workflow-adapter';
import { db } from '@/database/client';


export function postTx(prepared: { config: AutomationConfig; context: string; eventType: ReturnType<typeof triggerTypeToEventType>; }, auth: { userId: string; workspaceId: string; }, parsed: z.SafeParseSuccess<{ name: string; config: AutomationConfig; description?: string | null | undefined; }>) {
  return transaction(['MessageAttachment', 'Workflow'], 'post: template claim and automation workflow creation must commit atomically; tx is not ACL-wrapped', db, async tx => {
    await claimAutomationTemplates(tx, prepared.config, auth.workspaceId);
    return tx.workflow.create({
      data: {
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workflowName: parsed.data.name,
        workspaceId: auth.workspaceId,
        status: AutomationStatus.DRAFT,
        eventType: prepared.eventType,
        context: prepared.context,
        metadata: buildAutomationMetadata({
          description: parsed.data.description ?? null,
          createdById: auth.userId,
        }),
      },
    });
  });
}
export function putTx(prepared: { config: AutomationConfig; context: string; eventType: ReturnType<typeof triggerTypeToEventType>; } | null, auth: { userId: string; workspaceId: string; }, existing: any, parsed: z.SafeParseSuccess<{ name?: string | undefined; description?: string | null | undefined; config?: AutomationConfig | undefined; }>, metadata: string) {
  return transaction(['MessageAttachment', 'Workflow'], 'put: template claim and automation workflow update must commit atomically; tx is not ACL-wrapped', db, async tx => {
    if (prepared) await claimAutomationTemplates(tx, prepared.config, auth.workspaceId);
    return tx.workflow.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined && { workflowName: parsed.data.name }),
        ...(prepared && {
          context: prepared.context,
          eventType: prepared.eventType,
        }),
        metadata,
        updatedAt: new Date(),
      },
    });
  });
}
export function putTx2(prepared: { config: AutomationConfig; context: string; eventType: ReturnType<typeof triggerTypeToEventType>; } | null, auth: { userId: string; workspaceId: string; }, parsed: z.SafeParseSuccess<{ name?: string | undefined; description?: string | null | undefined; config?: AutomationConfig | undefined; }>, existing: any, seriesId: any, metadata: string) {
  return transaction(['MessageAttachment', 'Workflow'], 'put: template claim and automation workflow version creation must commit atomically; tx is not ACL-wrapped', db, async tx => {
    if (prepared) await claimAutomationTemplates(tx, prepared.config, auth.workspaceId);
    return tx.workflow.create({
      data: {
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workflowName: parsed.data.name ?? existing.workflowName,
        workspaceId: auth.workspaceId,
        status: AutomationStatus.DRAFT,
        automationSeriesId: seriesId,
        context: prepared ? prepared.context : existing.context,
        ...(prepared && { eventType: prepared.eventType }),
        metadata,
      },
    });
  });
}
