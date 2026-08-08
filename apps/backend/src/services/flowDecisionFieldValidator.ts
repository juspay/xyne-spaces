import type { FlowPlan } from '@xyne/shared';
import { db } from '@/database/client';

export interface DecisionFieldRecord {
  formId: string;
  isOptional: boolean | null;
  fieldType: string | null | undefined;
  fieldEnum: unknown;
  globalField?: {
    fieldType: string;
    fieldEnum: unknown;
  } | null;
}

type FindDecisionField = (fieldId: string) => Promise<DecisionFieldRecord | undefined | null>;

function enumValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Validate field-backed decisions through the caller's transactional lookup. */
export async function validateFlowDecisionFields(
  plan: FlowPlan,
  findField: FindDecisionField
): Promise<void> {
  for (const decision of plan.decisions ?? []) {
    const source = plan.nodes.find((node) => node.id === decision.parentNodeId);
    const formId = source?.gate?.type === 'form' ? source.gate.formId : null;
    if (!formId) {
      throw new Error(`The “${decision.fieldName || 'Decision'}” decision must follow a form step`);
    }

    const field = await findField(decision.fieldId);
    const fieldType = field?.globalField?.fieldType ?? field?.fieldType;
    if (!field || field.formId !== formId || field.isOptional || fieldType !== decision.fieldType) {
      throw new Error(`Decision field “${decision.fieldName}” is no longer eligible`);
    }

    if (decision.fieldType !== 'SINGLE_SELECT') continue;
    const expected = enumValues(field.globalField?.fieldEnum ?? field.fieldEnum);
    const configured = decision.routes.flatMap((route) =>
      route.key === 'otherwise' || route.value === undefined ? [] : [route.value]
    );
    if (
      expected.length !== configured.length ||
      expected.some((value) => !configured.includes(value))
    ) {
      throw new Error(`Decision routes for “${decision.fieldName}” no longer match its options`);
    }
  }
}

/** Prisma adapter for non-Zero HTTP board creation. */
export async function validateFlowDecisionFieldsWithPrisma(plan: FlowPlan): Promise<void> {
  await validateFlowDecisionFields(plan, (fieldId) =>
    db.formFields.findUnique({
      where: { id: fieldId },
      select: {
        formId: true,
        isOptional: true,
        fieldType: true,
        fieldEnum: true,
        globalField: { select: { fieldType: true, fieldEnum: true } },
      },
    })
  );
}
