import { type ReactElement } from 'react';
import { BotAvatar, type BotAvatarType } from 'bot-avatars';
import { botSeedForKey, botTypeForKey } from './agentBotShape';
import { useAgentAvatarDial } from './agentAvatarDial';
import { AgentFace } from './faces/AgentFace';

interface AgentBotAvatarProps {
  /** Stable id (slug or agent id). Picks the body when `type` is omitted. */
  agentKey?: string;
  /** Fixed body. The create flow and the thinking clover use this. */
  type?: BotAvatarType;
  busy?: boolean;
  asleep?: boolean;
  size?: number;
}

/** One bot face. Disabled agents sleep; a busy agent hops (V1) or scans (V2). */
export function AgentBotAvatar({
  agentKey = '',
  type,
  busy = false,
  asleep = false,
  size = 36,
}: AgentBotAvatarProps): ReactElement {
  const { version, builderFace, scanStyle } = useAgentAvatarDial();
  if (version === 2) {
    return (
      <AgentFace
        agent={type ? builderFace : agentKey || 'agent'}
        size={size}
        working={busy}
        asleep={asleep}
        style={scanStyle}
      />
    );
  }
  const shape = type ?? botTypeForKey(agentKey || 'agent');
  const state = asleep ? 'sleeping' : busy ? 'working' : 'default';
  return (
    <BotAvatar
      type={shape}
      state={state}
      size={size}
      seed={botSeedForKey(agentKey || shape)}
      aria-hidden
    />
  );
}
