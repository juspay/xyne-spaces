import type { ReactElement } from 'react';
import { AgentBotAvatar } from '@/components/agents/AgentBotAvatar';

/**
 * An agent's face while it is being built: its own, picked by the draft's id
 * when the draft starts and saved with the agent, so it doesn't change on Save
 * or as the name is typed. The canvas, its test chat and the Drafts list in
 * Agent Hub all draw it from here, so a draft looks the same everywhere.
 */
export function DraftAgentAvatar({
  avatarKey,
  size,
  busy = false,
}: {
  avatarKey: string;
  size: number;
  busy?: boolean;
}): ReactElement {
  return <AgentBotAvatar agentKey={avatarKey} busy={busy} size={size} />;
}
