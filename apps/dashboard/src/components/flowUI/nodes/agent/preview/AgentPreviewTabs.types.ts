import type { AgentIdentity } from '@xyne/shared';
import type { AgentCapabilityInteraction } from '../AgentIdentityBlock';

export type AgentPreviewTab = 'persona' | 'tools' | 'knowledge';

export interface AgentPreviewTabProps {
  agent: AgentIdentity;
}

export interface AgentPreviewToolsProps extends AgentPreviewTabProps {
  interactive?: AgentCapabilityInteraction | undefined;
}

export type AgentPreviewTabsProps = AgentPreviewToolsProps;

export const AGENT_PREVIEW_TABS: { id: AgentPreviewTab; label: string }[] = [
  { id: 'persona', label: 'Persona' },
  { id: 'tools', label: 'Tools' },
  { id: 'knowledge', label: 'Knowledge' },
];
