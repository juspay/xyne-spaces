import { type ReactElement } from 'react';
import { AgentFace } from './faces/AgentFace';

interface AgentBotAvatarProps {
  /** Stable id (slug or agent id), hashed to a face. */
  agentKey?: string;
  busy?: boolean;
  asleep?: boolean;
  size?: number;
}

/** One agent face. Disabled agents sleep; a busy agent scans. */
export function AgentBotAvatar({
  agentKey = '',
  busy = false,
  asleep = false,
  size = 36,
}: AgentBotAvatarProps): ReactElement {
  return <AgentFace agent={agentKey || 'agent'} size={size} working={busy} asleep={asleep} />;
}
