import type { ReactNode } from 'react';
import type { DashboardToolCall } from '@xyne/shared';
import type { ToolInvocation } from '../../Chat/XyneAISidebar/utils/XyneAITypes';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolInvocations: ToolInvocation[];
  reasoning?: string;
}

export interface ContextChip {
  icon?: ReactNode;
  label: string;
  maxWidth?: number;
}

export interface SuggestComponentsArgs {
  message: string;
  suggestions: ReadonlyArray<{ label: string; prompt: string }>;
}

export interface ToolCallContext {
  abort: () => void;
}

export type ToolCallResult = { status: 'completed' } | { status: 'error'; message: string };

export type ToolCallHandler = (
  call: DashboardToolCall,
  ctx: ToolCallContext,
) => ToolCallResult | Promise<ToolCallResult> | void;
