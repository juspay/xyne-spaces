/**
 * Node action types for workflow operations
 */
export type NodeAction = 'restart' | 'pause' | 'resume' | 'stop' | 'approve' | 'reject';

/**
 * Step detail tab types
 */
export type StepDetailTab = 'summary' | 'input' | 'output' | 'audit';

/**
 * Action configuration with label, icon, and description
 */
export interface ActionConfig {
  label: string;
  icon: string;
  description?: string;
}

/**
 * Centralized action configuration
 * Extracted from TaskNode.tsx actionLabel and actionIcon mappings
 */
export const ACTION_CONFIG: Record<NodeAction, ActionConfig> = {
  restart: {
    label: 'Restart',
    icon: 'restart',
    description: 'Restart this step from the beginning',
  },
  pause: {
    label: 'Pause',
    icon: 'pause',
    description: 'Pause the workflow execution',
  },
  resume: {
    label: 'Resume',
    icon: 'play',
    description: 'Resume the paused workflow',
  },
  stop: {
    label: 'Stop',
    icon: 'stop',
    description: 'Stop the workflow execution',
  },
  approve: {
    label: 'Approve',
    icon: 'check-circle',
    description: 'Approve this step',
  },
  reject: {
    label: 'Reject',
    icon: 'cross',
    description: 'Reject this step',
  },
};

/**
 * Get action label from action type
 */
export const getActionLabel = (action: NodeAction): string => {
  return ACTION_CONFIG[action]?.label || action;
};

/**
 * Get action icon from action type
 */
export const getActionIcon = (action: NodeAction): string => {
  return ACTION_CONFIG[action]?.icon || 'code';
};

/**
 * Get action description from action type
 */
export const getActionDescription = (action: NodeAction): string => {
  return ACTION_CONFIG[action]?.description || '';
};

/**
 * Tab configuration for StepDetails component
 */
export interface TabConfig {
  id: StepDetailTab;
  label: string;
  icon?: string;
  description?: string;
}

/**
 * Step detail tabs configuration
 * Extracted from StepDetails.tsx tab array
 */
export const STEP_DETAIL_TABS: TabConfig[] = [
  {
    id: 'summary',
    label: 'Summary',
    icon: 'analysis',
    description: 'Step overview with status and metadata',
  },
  {
    id: 'input',
    label: 'Input',
    icon: 'code',
    description: 'Input data passed to this step',
  },
  {
    id: 'output',
    label: 'Output',
    icon: 'check-circle',
    description: 'Output data produced by this step',
  },
  {
    id: 'audit',
    label: 'Audit Trail',
    icon: 'list',
    description: 'Execution timeline and child executions',
  },
];

/**
 * Get tab configuration by ID
 */
export const getTabConfig = (tabId: StepDetailTab): TabConfig | undefined => {
  return STEP_DETAIL_TABS.find(tab => tab.id === tabId);
};

/**
 * Keywords used for detecting agentic workflow nodes
 */
export const AGENTIC_KEYWORDS = ['agent', 'ai', 'llm', 'artificial', 'intelligence'];

/**
 * Default node styling constants
 */
export const NODE_STYLING = {
  DEFAULT_WIDTH: 'w-64',
  DEFAULT_MIN_HEIGHT: 'min-h-[140px]',
  DEFAULT_PADDING: 'p-4',
  DEFAULT_BORDER_RADIUS: 'rounded-xl',
  DEFAULT_SHADOW: 'shadow-sm',
  HOVER_SHADOW: 'hover:shadow-lg',
  HOVER_TRANSFORM: 'hover:-translate-y-1',
  TRANSITION: 'transition-all duration-300',
} as const;

/**
 * Loading stage configuration for progressive loading
 */
export const LOADING_CONFIG = {
  TOTAL_STAGES: 5,
  STAGE_DELAY_MS: 250,
  MIN_HEIGHT: 600,
} as const;

/**
 * Edge styling configuration for workflow graph
 * Uses CSS variable for default color that responds to theme
 */
export const EDGE_STYLING = {
  DEFAULT_COLOR: 'var(--status-new)', // Theme-aware fallback
  DEFAULT_WIDTH: 2,
  MULTI_EDGE_WIDTH: 1.5,
  ARROW_SIZE: 14,
  STROKE_WIDTH: 1.5,
  // Palette colors use CSS variables for theme-aware theming
  PALETTE: [
    'var(--status-scheduled)',
    'var(--status-success)',
    'var(--status-pending)',
    'var(--status-failure)',
  ],
} as const;

/**
 * Prefix added to explicit user replies (reruns / chat) so we can distinguish
 * them from automatic orchestrator-generated user_message steps.
 */
export const USER_REPLY_PREFIX = '[user_reply] ';

/**
 * Maximum characters shown in UserMessageRenderer before truncation.
 */
export const USER_MESSAGE_CHAR_LIMIT = 300;

export const RA_URL: string = 'https://research-agent.sso.internal.svc.k8s.office.mum.juspay.net/';

/**
 * Common workflow status types used across components
 */
export type WorkflowStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'paused'
  | 'not_executed'
  | 'waiting'
  | 'pending'
  | 'success'
  | 'failure';
