/**
 * Flow UI Types v2 — Structured JSON-based UI rendering system
 */

// ============================================================================
// COMPONENT TYPE UNION
// ============================================================================

export type FlowComponentType =
  | 'text'
  | 'heading'
  | 'button'
  | 'input'
  | 'textarea'
  | 'dropdown'     // single-option dropdown (was 'select')
  | 'select'       // single-option radio group (was 'radio')
  | 'multiselect'  // multi-option checkbox group (was 'checkbox')
  | 'date'
  | 'row'
  | 'column'
  | 'card'
  | 'divider'
  | 'image'
  | 'link'
  | 'table'
  | 'plan'
  | 'pr'
  | 'pr_approval'
  | 'call_schedule'
  | 'user_question'
  | 'code'
  | 'diff'
  | 'ticket'
  | 'chart'
  | 'agent'
  | 'mcpConfigure'
  | 'slash_command_artifact'
  | 'agent_summary'
  | 'mcp_suggest'


export interface FlowComponent {
  id: string;
  type: FlowComponentType;
  props?: Record<string, unknown>;
  children?: FlowComponent[];
  style?: FlowComponentStyle;
  hidden?: boolean | string;
  disabled?: boolean | string;
}

export interface FlowComponentStyle {
  padding?: string;
  margin?: string;
  gap?: string;
  align?: 'left' | 'center' | 'right' | 'stretch';
  width?: string;
  maxWidth?: string;
  minWidth?: string;
  backgroundColor?: string;
  borderRadius?: string;
  border?: string;
  borderLeft?: string;
}

// Backward-compat aliases
/** @deprecated Use FlowComponent */
export type FlowNode = FlowComponent;
/** @deprecated Use FlowComponentType */
export type FlowNodeType = FlowComponentType;
/** @deprecated Use FlowComponentStyle */
export type FlowNodeStyle = FlowComponentStyle;

// ============================================================================
// ACTION DEFINITIONS (v2 — no endpoint/method/headers in JSON)
// ============================================================================

export type FlowAction =
  | { type: 'submit'; actionId: string; successMessage?: string; errorMessage?: string }
  | { type: 'inputChange'; actionId: string; debounceMs?: number }
  | { type: 'update_state'; stateUpdates: Record<string, unknown>; successMessage?: string }
  | { type: 'close_screen'; finalMessage?: string }
  | { type: 'navigate'; target: string }
  | { type: 'copy'; value: string; successMessage?: string };

// ============================================================================
// VALIDATION RULES
// ============================================================================

export interface ValidationRule {
  type: 'required' | 'min' | 'max' | 'minLength' | 'maxLength' | 'pattern' | 'email' | 'custom';
  value?: unknown;
  message: string;
}

export interface SelectOption {
  label: string;
  value: string;
  icon?: string;
  disabled?: boolean;
  description?: string;
}

// Plan artifact types (ProposedTodo, ExecTodo, PlanProps, PlanPhase) are defined
// in validation/flowSchema.ts and inferred from the zod schema so the runtime
// contract and the TS types can't drift. Both are re-exported from the package root.

// ============================================================================
// FLOW STATE (v2 — adds loadingComponentIds)
// ============================================================================

export interface FlowState {
  values: Record<string, unknown>;
  touched: Record<string, boolean>;
  errors: Record<string, string>;
  submitting: boolean;
  submitted: boolean;
  history: string[];
  loadingComponentIds: string[];
}

// ============================================================================
// FLOW DEFINITION (v2)
// ============================================================================

export interface FlowDefinition {
  version: '2.0';
  screenId: string;
  title?: string;
  components: FlowComponent[];
  data?: Record<string, unknown>;
  state: FlowState;
}

// ============================================================================
// WIRE TYPES — frontend → Xyne backend
// ============================================================================

export interface ActionRequest {
  actionId: string;
  type: 'submit' | 'inputChange';
  values: Record<string, unknown>;
  context: {
    flowJSON: FlowDefinition;
    messageId: string;
    conversationId: string;
  };
}

// ============================================================================
// WIRE TYPES — Xyne backend → frontend
// ============================================================================

export type AppActionResponse =
  | { type: 'open_screen'; flowJSON: FlowDefinition; message?: string }
  | { type: 'next_screen'; flowJSON: FlowDefinition; message?: string }
  | { type: 'close_screen'; finalMessage?: string; message?: string }
  | {
      type: 'update_screen_data';
      data: Record<string, unknown>;
      componentUpdates?: Record<string, Partial<Pick<FlowComponent, 'props' | 'hidden' | 'disabled'>>>;
    }
  | { type: 'ack'; message?: string }
  | { type: 'error'; message: string; code?: string };

// ============================================================================
// MESSAGE METADATA (v2)
// ============================================================================

export interface FlowUIMetadata {
  hasFlowUI: true;
  flowVersion: '2.0';
  flowId: string;
  appId: string;
  flowJSON: FlowDefinition;
  [key: string]: unknown;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isFlowMessage(metadata: unknown): metadata is FlowUIMetadata {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    'hasFlowUI' in metadata &&
    (metadata as Record<string, unknown>).hasFlowUI === true
  );
}

export function isFlowDefinition(obj: unknown): obj is FlowDefinition {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'version' in obj &&
    (obj as Record<string, unknown>).version === '2.0' &&
    'screenId' in obj &&
    'components' in obj &&
    Array.isArray((obj as Record<string, unknown>).components)
  );
}
