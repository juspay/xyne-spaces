import type { FlowComponentType, FlowComponent } from '@xyne/shared';
import type { ComponentType, ReactNode } from 'react';
import { TextNode } from './TextNode';
import { HeadingNode } from './HeadingNode';
import { ButtonNode } from './ButtonNode';
import { InputNode } from './InputNode';
import { TextareaNode } from './TextareaNode';
import { SelectNode } from './SelectNode';
import { CheckboxNode } from './CheckboxNode';
import { RadioNode } from './RadioNode';
import { RowNode, ColumnNode, CardNode } from './ContainerNodes';
import { DividerNode } from './DividerNode';
import { ImageNode } from './ImageNode';
import { TableNode } from './TableNode';
import { LinkNode } from './LinkNode';
import { PlanNode } from './PlanNode';
import { PrNode } from './PrNode';
import { CallScheduleNode } from './CallScheduleNode';
import { UserQuestionNode } from './UserQuestionNode';
import { CodeNode } from './CodeNode';
import { DiffNode } from './DiffNode';
import { TicketNode } from './TicketNode';
import { ChartNode } from './ChartNode';
import { AgentNode } from './AgentNode';
import { AgentSummaryNode } from './AgentSummaryNode';
import { McpConfigureNode } from './McpConfigureNode';
import { SlashCommandArtifactNode } from '../../Chat/SlashCommandArtifacts';
// PrApprovalNode is intentionally NOT imported/registered for now — the component
// is kept in ./PrApprovalNode.tsx but unlinked so 'pr_approval' isn't a live artifact.

// Base props interface that all node components extend
export interface NodeComponentBaseProps {
  node: FlowComponent;
  children?: ReactNode;
}

const registry = new Map<FlowComponentType, ComponentType<NodeComponentBaseProps>>();

export const NodeRegistry = {
  register: (type: FlowComponentType, component: ComponentType<NodeComponentBaseProps>): void => {
    registry.set(type, component);
  },
  get: (type: FlowComponentType): ComponentType<NodeComponentBaseProps> | undefined => {
    return registry.get(type);
  },
};

// Register synchronously at module load.
//
// This was previously done via dynamic import() inside an async initializeRegistry(), which
// made FlowRenderer gate rendering on a promise that had no error handling: a single failed
// chunk load (common in Electron right after an app update, when chunk filenames change, or on
// a transient read race) left the renderer stuck forever on its loading skeleton — showing as
// "empty space" that only a full reload could fix. These node components are leaf modules (none
// import back into NodeRegistry/FlowRenderer), so eager static imports are safe and remove the
// race entirely — the registry is always ready before any flow renders.
NodeRegistry.register('text', TextNode);
NodeRegistry.register('heading', HeadingNode);
NodeRegistry.register('button', ButtonNode);
NodeRegistry.register('input', InputNode);
NodeRegistry.register('textarea', TextareaNode);
NodeRegistry.register('dropdown', SelectNode); // single-option dropdown
NodeRegistry.register('select', RadioNode); // single-option radio group
NodeRegistry.register('multiselect', CheckboxNode); // multi-option checkbox group
NodeRegistry.register('row', RowNode);
NodeRegistry.register('column', ColumnNode);
NodeRegistry.register('card', CardNode);
NodeRegistry.register('divider', DividerNode);
NodeRegistry.register('image', ImageNode);
NodeRegistry.register('table', TableNode);
NodeRegistry.register('link', LinkNode);
NodeRegistry.register('plan', PlanNode);
NodeRegistry.register('pr', PrNode);
// NodeRegistry.register('pr_approval', PrApprovalNode); // unlinked for now
NodeRegistry.register('call_schedule', CallScheduleNode);
NodeRegistry.register('user_question', UserQuestionNode);
NodeRegistry.register('code', CodeNode);
NodeRegistry.register('diff', DiffNode);
NodeRegistry.register('ticket', TicketNode);
NodeRegistry.register('chart', ChartNode);
NodeRegistry.register('agent', AgentNode);
NodeRegistry.register('agent_summary', AgentSummaryNode);
NodeRegistry.register('mcpConfigure', McpConfigureNode);
NodeRegistry.register('slash_command_artifact', SlashCommandArtifactNode);

/**
 * Kept for backward compatibility with existing callers/imports.
 * Registration now happens eagerly at module load, so this is a resolved no-op.
 */
export const initializeRegistry = async (): Promise<void> => {};
