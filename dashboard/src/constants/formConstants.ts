import { FormContextType, FormEntityType } from '@xyne/shared';

// Available context types
export const FORM_CONTEXT_TYPES = [FormContextType.BOARD];
export type FormContextTypeLocal = FormContextType;

// Mapping of context types to their supported entity types
export const FORM_ENTITY_TYPES = {
  [FormContextType.BOARD]: [FormEntityType.TICKET],
} as const;

export type FormEntityTypeLocal = FormEntityType;

// Helper function to get entity types for a given context
export function getEntityTypesForContext(contextType: FormContextType): readonly FormEntityType[] {
  return FORM_ENTITY_TYPES[contextType];
}
