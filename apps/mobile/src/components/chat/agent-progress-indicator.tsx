import { memo, useCallback, useEffect, type ReactElement } from 'react';
import { DeviceEventEmitter, Pressable, Text, View } from 'react-native';
import { Square } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AgentSpinner } from '@/src/components/ui/agent-spinner';
import { useAuth } from '@/src/contexts/AuthContext';
import { AGENT_PROGRESS_CLEARED_EVENT, useAgentProgress } from '@/src/hooks/useAgentProgress';
import { apiPost } from '@/src/services/apiClient';
import { showMessageToast } from '@/src/utils/toast';

type AgentProgressIndicatorProps = {
  sessionId: string | undefined;
  conversationId: string | undefined;
  channelId?: string | undefined;
  onActiveChange?: (active: boolean) => void;
};

const AgentProgressIndicatorComponent = ({
  sessionId,
  conversationId,
  channelId,
  onActiveChange,
}: AgentProgressIndicatorProps): ReactElement | null => {
  const { user } = useAuth();
  const muted = useCSSVariable('--color-foreground') as string;
  const { agents, clearAll } = useAgentProgress(sessionId, channelId);

  const isActive = agents.length > 0;
  useEffect(() => {
    onActiveChange?.(isActive);
  }, [isActive, onActiveChange]);

  const currentUserId = user?.user_id;
  const myAgent = agents.find(
    agent => agent.triggeredByUserId !== null && agent.triggeredByUserId === currentUserId,
  );

  const handleAbortAgent = useCallback(async (): Promise<void> => {
    if (!conversationId) return;
    const slug = myAgent?.agentSlug;
    if (!slug) return;
    try {
      await apiPost(`/conversations/${encodeURIComponent(conversationId)}/agent-cancel`, {
        agentSlug: slug,
      });
      clearAll();
      DeviceEventEmitter.emit(AGENT_PROGRESS_CLEARED_EVENT, { conversationId });
    } catch {
      showMessageToast('Failed to stop agent. Only the person who started it can stop.', 'error');
    }
  }, [clearAll, conversationId, myAgent?.agentSlug]);

  if (agents.length === 0) return null;

  return (
    <View
      className='w-full flex-row items-center gap-2 bg-conversation-input-surface px-3'
      style={{ minHeight: 20, paddingBottom: 4 }}
      accessibilityLiveRegion='polite'
    >
      <View className='min-w-0 flex-1 flex-row flex-wrap gap-3 ml-2'>
        {agents.map(agent => (
          <View
            key={agent.agentUserId ?? agent.agentSlug ?? 'agent'}
            className='max-w-full flex-row items-center gap-1.5'
          >
            <AgentSpinner size={12} color={muted} />
            <Text className='shrink text-[11px] text-foreground' numberOfLines={1}>
              {agent.agentName ? (
                <Text className='text-[11px] font-semibold text-foreground'>
                  {agent.agentName}{' '}
                </Text>
              ) : null}
              {agent.toolLabel ?? 'working…'}
            </Text>
          </View>
        ))}
      </View>

      {myAgent ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Stop agent'
          hitSlop={8}
          onPress={() => void handleAbortAgent()}
          className='shrink-0 items-center justify-center rounded-full bg-red-500 p-1'
        >
          <Square size={12} color='#ffffff' fill='#ffffff' />
        </Pressable>
      ) : null}
    </View>
  );
};

const AgentProgressIndicator = memo(AgentProgressIndicatorComponent);
AgentProgressIndicator.displayName = 'AgentProgressIndicator';

export { AgentProgressIndicator };
