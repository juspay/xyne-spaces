import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { AutomationStatus } from '../types/status';
import type { AutomationConfig } from '../types/automation-config';
import type { ValidationResult } from '../types/validation';
import { ConfigValidator } from '../engine/config-validator';
import { triggerRegistry } from '../triggers/trigger-registry';
import { stepRegistry } from '../steps/step-registry';
import {
  AUTOMATION_WORKFLOW_TYPE,
  parseAutomationConfig,
  triggerTypeToEventType,
  workflowToAutomation,
  type AutomationView,
} from '../types/workflow-adapter';

const validator = new ConfigValidator(triggerRegistry, stepRegistry);

export interface SaveResult {
  automation: AutomationView;
  validation: ValidationResult;
}

class AutomationService {
  async get(id: string): Promise<AutomationView | null> {
    const workflow = await repositories.workflows.findById(id);
    if (!workflow || workflow.workflowType !== AUTOMATION_WORKFLOW_TYPE) return null;
    return workflowToAutomation(workflow);
  }

  async getOwned(id: string, ownerId: string): Promise<AutomationView | null> {
    const automation = await this.get(id);
    if (!automation) return null;
    if (automation.createdById !== ownerId) return null;
    return automation;
  }

  validateConfig(config: AutomationConfig): ValidationResult {
    const result = validator.validate(config);
    logger.info(
      `[automations] Validated config (valid=${result.valid}, issues=${result.issues.length})`,
    );
    return result;
  }

  async activate(id: string): Promise<{ automation: AutomationView; validation: ValidationResult }> {
    const t0 = Date.now();
    logger.info(`[AUTOMATION-SERVICE] activate START id=${id}`);
    const existing = await repositories.workflows.findById(id);
    if (!existing || existing.workflowType !== AUTOMATION_WORKFLOW_TYPE) {
      logger.warn(`[AUTOMATION-SERVICE] activate REJECT id=${id} reason=not-found`);
      throw new Error(`Automation "${id}" not found`);
    }

    const config = parseAutomationConfig(existing.context);
    const validation = validator.validate(config);
    if (!validation.valid) {
      logger.warn(
        `[automations] Activate REJECTED for ${id} — ${validation.issues.length} validation issue(s):`,
      );
      for (const issue of validation.issues) {
        logger.warn(`  • [${issue.code}] ${issue.path}: ${issue.message}`);
      }
      const demoted =
        existing.status === AutomationStatus.ACTIVE
          ? await repositories.workflows.update(id, {
              status: AutomationStatus.DISABLED,
              updatedAt: new Date(),
            })
          : existing;
      return { automation: workflowToAutomation(demoted), validation };
    }

    const triggerImpl = triggerRegistry.get(config.trigger.type);
    triggerImpl.validate(config.trigger.config);
    logger.info(
      `[AUTOMATION-SERVICE] activate id=${id} trigger=${config.trigger.type} steps=${config.steps.length}`,
    );

    const updated = await repositories.workflows.update(id, {
      status: AutomationStatus.ACTIVE,
      eventType: triggerTypeToEventType(config.trigger.type),
      updatedAt: new Date(),
    });

    logger.info(
      `[AUTOMATION-SERVICE] activate OK id=${id} elapsedMs=${Date.now() - t0}`,
    );
    return { automation: workflowToAutomation(updated), validation };
  }

  async disable(id: string): Promise<AutomationView> {
    const t0 = Date.now();
    logger.info(`[AUTOMATION-SERVICE] disable START id=${id}`);
    const existing = await repositories.workflows.findById(id);
    if (!existing || existing.workflowType !== AUTOMATION_WORKFLOW_TYPE) {
      logger.warn(`[AUTOMATION-SERVICE] disable REJECT id=${id} reason=not-found`);
      throw new Error(`Automation "${id}" not found`);
    }

    const updated = await repositories.workflows.update(id, {
      status: AutomationStatus.DISABLED,
      updatedAt: new Date(),
    });
    logger.info(
      `[AUTOMATION-SERVICE] disable OK id=${id} elapsedMs=${Date.now() - t0}`,
    );
    return workflowToAutomation(updated);
  }
}

export const automationService = new AutomationService();
