import { FormContextType, FormEntityType } from '@xyne/shared';

// Available context types
export const FORM_CONTEXT_TYPES = [
  FormContextType.BOARD,
  FormContextType.STAGE,
  FormContextType.WORKSPACE,
];
export type FormContextTypeLocal = FormContextType;

// Mapping of context types to their supported entity types
export const FORM_ENTITY_TYPES: Partial<Record<FormContextType, readonly FormEntityType[]>> = {
  [FormContextType.BOARD]: [FormEntityType.TICKET, FormEntityType.SUB_TICKET],
  [FormContextType.STAGE]: [FormEntityType.TICKET],
  // Channel fields: one form per workspace, set on each channel.
  [FormContextType.WORKSPACE]: [FormEntityType.CHANNEL],
};

export type FormEntityTypeLocal = FormEntityType;

// Helper function to get entity types for a given context
export function getEntityTypesForContext(contextType: FormContextType): readonly FormEntityType[] {
  return FORM_ENTITY_TYPES[contextType] ?? [];
}
