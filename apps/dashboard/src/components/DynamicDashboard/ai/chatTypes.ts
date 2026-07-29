import type { ReactNode } from 'react';
import type { QueryVisualizationType } from '@xyne/shared';
import type { ToolInvocation } from '../../Chat/XyneAISidebar/utils/XyneAITypes';

export interface DrillPayload {
  title: string;
  visualType: QueryVisualizationType;
  queryPlan: unknown;
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolInvocations: ToolInvocation[];
  reasoning?: string;
  drill?: DrillPayload;
}

export interface ContextChip {
  icon?: ReactNode;
  label: string;
  maxWidth?: number;
  onRemove?: () => void;
}

export interface SuggestComponentsArgs {
  message: string;
  suggestions: ReadonlyArray<{ label: string; prompt: string }>;
}

export type ToolCallResult = { status: 'completed' } | { status: 'error'; message: string };
