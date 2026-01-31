export interface InvestigationResult {
  success: boolean;
  bugId: string;
  investigationCompleted: boolean;
  investigationCompletedAt: string;
  investigationResult?: string;
  investigationError?: string;
  investigationApiStatus: 'success' | 'failed';
}

export interface WorkflowTriggerResult {
  success: boolean;
  workflowType: 'BUG_WORKFLOW' | 'CODER_WORKFLOW';
  ticketId?: string;
  error?: string;
  responseStatus?: number;
}

export interface MerchantTokenResult {
  success: boolean;
  token?: string;
  error?: string;
  responseStatus?: number;
}

export interface GeniusInvestigationResult {
  success: boolean;
  investigationOutput?: string;
  error?: string;
  responseStatus?: number;
}

export interface InvestigationWorkflowOutput {
  investigationResult: InvestigationResult;
  bugWorkflowTrigger?: WorkflowTriggerResult;
  coderWorkflowTrigger?: WorkflowTriggerResult;
}

export interface InvestigationWorkflowParallelOutput {
  geniusInvestigation?: GeniusInvestigationResult;
  bugWorkflow?: any;
  coderWorkflow?: any;
}