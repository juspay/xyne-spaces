import React from 'react';
import {
  Brain,
  Code2,
  Eye,
  Shield,
  GitBranch,
  Bug,
  Bot,
  Twitch,
  Ghost,
  Laugh,
  Skull,
  UserRoundCog,
  User,
} from 'lucide-react';
import { AgentInfo } from './AgentChatView.utils';

export interface AgentAvatarProps {
  agentInfo: AgentInfo;
  size?: 'xs' | 'sm' | 'md';
}

export const AgentAvatar: React.FC<AgentAvatarProps> = ({ agentInfo, size = 'md' }) => {
  const dim = size === 'xs' ? 'w-4 h-4' : size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const iconSize = size === 'xs' ? 10 : size === 'sm' ? 14 : 18;

  const renderIcon = () => {
    switch (agentInfo.icon) {
      case 'twitch':
        return <Twitch size={iconSize} strokeWidth={2.5} />;
      case 'ghost':
        return <Ghost size={iconSize} strokeWidth={2.5} />;
      case 'laugh':
        return <Laugh size={iconSize} strokeWidth={2.5} />;
      case 'skull':
        return <Skull size={iconSize} strokeWidth={2.5} />;
      case 'brain':
        return <Brain size={iconSize} strokeWidth={2.5} />;
      case 'code':
        return <Code2 size={iconSize} strokeWidth={2.5} />;
      case 'eye':
        return <Eye size={iconSize} strokeWidth={2.5} />;
      case 'shield':
        return <Shield size={iconSize} strokeWidth={2.5} />;
      case 'git':
        return <GitBranch size={iconSize} strokeWidth={2.5} />;
      case 'bug':
        return <Bug size={iconSize} strokeWidth={2.5} />;
      case 'user-round-cog':
        return <UserRoundCog size={iconSize} strokeWidth={2.5} />;
      case 'user':
        return <User size={iconSize} strokeWidth={2.5} />;
      case 'bot':
      default:
        return <Bot size={iconSize} strokeWidth={2.5} />;
    }
  };

  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-bold flex-shrink-0 ${agentInfo.avatarBg} ${agentInfo.avatarText} select-none shadow-sm`}
      title={agentInfo.name}
    >
      {renderIcon()}
    </div>
  );
};
