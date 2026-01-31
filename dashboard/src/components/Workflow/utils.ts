import { FieldPath } from 'react-hook-form';
import type { WorkflowFieldSchema, WorkflowTypeSchema } from '../Tickets/types';

/**
 * Interface for workflow trigger form data
 */
export interface TriggerWorkflowFormData {
  workflowType: string;
  context: string;
  title?: string;
  description?: string;
  customFields: Record<string, unknown>;
}

/**
 * Interface for ticket data used to pre-fill workflow fields
 */
export interface TicketData {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  assignedTo?: string;
  conversationId?: string;
}

/**
 * Mapping of workflow field names to ticket data properties
 */
export const WORKFLOW_FIELD_MAPPING: Record<string, keyof TicketData> = {
  title: 'title',
  description: 'description',
  bugId: 'id',
  ticketId: 'id',
  reportedBy: 'createdBy',
  assignedTo: 'assignedTo',
  // Add more mappings as needed
};

/**
 * Validates a workflow field value based on its schema
 * @param field The field schema to validate against
 * @param value The value to validate
 * @returns Error message if validation fails, null if valid
 */
export function validateCustomField(field: WorkflowFieldSchema, value: unknown): string | null {
  if (field.required && (value === undefined || value === null || value === '')) {
    return `${field.name} is required`;
  }

  if (value !== undefined && value !== null && value !== '') {
    switch (field.type) {
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          return `${field.name} must be a valid number`;
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          return `${field.name} must be true or false`;
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          return `${field.name} must be an array`;
        }
        break;
      case 'string':
        if (typeof value !== 'string') {
          return `${field.name} must be a string`;
        }
        break;
    }
  }

  return null;
}

/**
 * Gets field mapping for auto-filling workflow fields from ticket data
 * @param ticketData The ticket data to map from
 * @param workflowSchema The workflow schema to map to
 * @returns Object with field mappings
 */
export function getFieldMappings(
  ticketData: TicketData,
  workflowSchema?: WorkflowTypeSchema,
): Record<string, unknown> {
  const fieldsToFill: Record<string, unknown> = {};

  if (workflowSchema?.schema) {
    workflowSchema.schema.forEach((field: WorkflowFieldSchema) => {
      const fieldNameLower = field.name.toLowerCase();

      switch (fieldNameLower) {
        case 'title':
          fieldsToFill[field.name] = ticketData.title;
          break;
        case 'description':
          fieldsToFill[field.name] = ticketData.description;
          break;
        case 'bugid':
        case 'ticketid':
          fieldsToFill[field.name] = ticketData.id;
          break;
        case 'reportedby':
        case 'reported_by':
        case 'createdby':
        case 'created_by':
          fieldsToFill[field.name] = ticketData.createdBy;
          break;
        case 'assignedto':
        case 'assigned_to':
          fieldsToFill[field.name] = ticketData.assignedTo || '';
          break;
        case 'severity':
          fieldsToFill[field.name] = 'medium'; // Default severity
          break;
      }
    });
  }

  return fieldsToFill;
}

/**
 * Updates form values when a workflow type is selected
 * @param setValue React Hook Form setValue function
 * @param ticketData Ticket data to pre-fill with
 * @param selectedWorkflow Selected workflow type
 */
export function updateFormWithTicketData(
  setValue: (name: FieldPath<TriggerWorkflowFormData>, value: unknown) => void,
  ticketData: TicketData,
  selectedWorkflow: WorkflowTypeSchema,
): void {
  const fieldsToFill = getFieldMappings(ticketData, selectedWorkflow);

  Object.entries(fieldsToFill).forEach(([fieldName, value]) => {
    setValue(`customFields.${fieldName}` as FieldPath<TriggerWorkflowFormData>, value);
  });

  // Also set context field with ticket description
  if (ticketData.description) {
    const contextValue = `Ticket: ${ticketData.title}\n\n${ticketData.description}`;
    setValue('context', contextValue);
  }
}

/**
 * Pre-fills workflow form data with ticket information based on field mappings
 * @param ticketData The ticket data to extract values from
 * @param workflowSchema The schema of the selected workflow (optional, for more sophisticated mapping)
 * @returns Partial form data with pre-filled values
 */
export function preFillWorkflowFields(
  ticketData: TicketData,
  workflowSchema?: WorkflowTypeSchema,
): Partial<TriggerWorkflowFormData> {
  const customFields: Record<string, unknown> = {};

  // Fill custom fields based on mapping
  Object.entries(WORKFLOW_FIELD_MAPPING).forEach(([workflowField, ticketField]) => {
    const value = ticketData[ticketField];
    if (value !== undefined && value !== null) {
      customFields[workflowField] = value;
    }
  });

  // Additional mapping based on workflow schema if available
  if (workflowSchema?.schema) {
    workflowSchema.schema.forEach((field: WorkflowFieldSchema) => {
      // If field is in our mapping, it's already handled above
      if (!WORKFLOW_FIELD_MAPPING[field.name]) {
        // Add any additional custom logic for unmapped fields here
        // For example, you could derive values from existing ticket data
        switch (field.name) {
          case 'priority':
            // Example: Set default priority based on ticket title/content
            customFields[field.name] = 'medium';
            break;
          case 'assignedTo':
            // Example: Leave empty for manual selection
            customFields[field.name] = '';
            break;
          default:
            // Leave other fields empty for user input
            break;
        }
      }
    });
  }

  return {
    title: ticketData.title,
    description: ticketData.description,
    customFields,
  };
}

/**
 * Gets field options for select/dropdown fields
 * @param field The workflow field schema
 * @returns Array of options for the field
 */
export function getFieldOptions(
  field: WorkflowFieldSchema,
): Array<{ label: string; value: string }> {
  const fieldNameLower = field.name.toLowerCase();

  if (field.type === 'boolean') {
    return [
      { label: 'Yes', value: 'true' },
      { label: 'No', value: 'false' },
    ];
  }

  if (field.enumValues && field.enumValues.length > 0) {
    return field.enumValues.map(opt => ({
      label: opt,
      value: opt,
    }));
  }

  if (fieldNameLower === 'severity' || fieldNameLower === 'priority') {
    return [
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
      { label: 'Critical', value: 'critical' },
    ];
  }

  return [];
}

/**
 * Gets default value for a field based on its type and configuration
 * @param field The workflow field schema
 * @returns Default value for the field
 */
export function getFieldValue(field: WorkflowFieldSchema): unknown {
  switch (field.type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}
