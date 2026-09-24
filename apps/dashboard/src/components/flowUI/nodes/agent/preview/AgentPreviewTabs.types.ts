import type { AgentIdentity } from '@xyne/shared';
import type { DraftAgentEditor } from '../useDraftAgentEditor';

export type AgentPreviewTab = 'persona' | 'tools' | 'knowledge';

export interface AgentPreviewTabProps {
  agent: AgentIdentity;
}

export interface AgentPreviewEditableProps extends AgentPreviewTabProps {
  editor?: DraftAgentEditor | undefined;
}

export type AgentPreviewToolsProps = AgentPreviewEditableProps;

export type AgentPreviewTabsProps = AgentPreviewEditableProps;

export const AGENT_PREVIEW_TABS: { id: AgentPreviewTab; label: string }[] = [
  { id: 'persona', label: 'Persona' },
  { id: 'tools', label: 'Tools' },
  { id: 'knowledge', label: 'Knowledge' },
];
