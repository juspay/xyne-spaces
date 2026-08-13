import { useCallback, type ReactElement } from 'react';
import { AskAIDebugPanel } from '../../components/Chat/XyneAISidebar/components/AskAIDebugPanel';
import type { DebugArtifactBundle } from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';
import { apiInstance } from '../../services/clients/apiClient';
import { useExternalDebuggerStore } from '../../store/useExternalDebuggerStore';

export function SdlcDebuggerPanel(): ReactElement | null {
  const target = useExternalDebuggerStore(state => state.target);
  const close = useExternalDebuggerStore(state => state.close);
  const repoId = target?.repoId;
  const executionId = target?.executionId;
  const fetchArtifacts = useCallback(async (): Promise<DebugArtifactBundle> => {
    if (!repoId || !executionId) throw new Error('Debugger target is unavailable');
    const response = await apiInstance.get<{ success: boolean; data: DebugArtifactBundle }>(
      `/sdlc/repositories/${repoId}/executions/${executionId}/debug`,
    );
    if (!response.data.success) throw new Error('Failed to fetch debug artifacts');
    return response.data.data;
  }, [executionId, repoId]);

  if (!target) return null;
  return (
    <AskAIDebugPanel
      open
      inline
      fill
      conversationId={target.conversationId}
      agentSlug='ask-ai'
      liveEvents={[]}
      running={target.running}
      // An SDLC execution may contain several Claw attempts under one
      // conversation (provider recovery mints a fresh AgentRun session). This
      // panel represents the whole execution, so show all attempts and let the
      // debugger open the latest one instead of pinning the original session.
      selectedSessionId={null}
      fetchArtifacts={fetchArtifacts}
      onClose={close}
    />
  );
}
