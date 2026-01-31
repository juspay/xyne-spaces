/**
 * Ticket and Workflow Type Definitions
 * Shared types for ticket creation and workflow management
 */

export interface WorkflowFieldSchema {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
  defaultValue?: unknown;
  nestedFields?: WorkflowFieldSchema[];
}

export interface WorkflowTypeSchema {
  id: string;
  label: string;
  description: string;
  category: string;
  icon?: string;
  requiresRepo?: boolean;
  priority?: 'low' | 'medium' | 'high';
  experimental?: boolean;
  estimatedDuration?: number;
  schema: WorkflowFieldSchema[];
}

export interface WorkflowTypesAPIResponse {
  workflowTypes: WorkflowTypeSchema[];
}
