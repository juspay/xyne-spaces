import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, Wrench } from 'lucide-react';
import { cn } from '@/utils/classNames';
import XyneAISidebar from '@/components/Chat/XyneAISidebar/XyneAISidebar';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';

export const BUILDER_DRIVER_SLUG = 'ask-ai';

type PanelMode = 'builder' | 'preview';

export function AgentBuilderPanel({
  agent,
  onClose,
}: {
  agent: Agent;
  onClose: () => void;
}): ReactElement {
  const [mode, setMode] = useState<PanelMode>('builder');
  const isBuilder = mode === 'builder';

  const [previewStarted, setPreviewStarted] = useState(false);

  const seed = useMemo(
    () => ({ query: `Help me improve “${agent.name}”`, nonce: Date.now() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const queryClient = useQueryClient();
  const wasStreaming = useRef(false);
  const handleStreamingChange = useCallback(
    (isStreaming: boolean): void => {
      if (wasStreaming.current && !isStreaming) {
        void queryClient.invalidateQueries({ queryKey: clawAgentDetailKey(agent.slug) });
      }
      wasStreaming.current = isStreaming;
    },
    [queryClient, agent.slug],
  );

  const toggle = (): void => {
    if (isBuilder) setPreviewStarted(true);
    setMode(isBuilder ? 'preview' : 'builder');
  };

  return (
    <div className='agent-builder-pane flex h-full min-h-0 flex-col border-l border-border bg-background'>
      <div className='flex shrink-0 items-center justify-end px-3 pb-3 pt-5'>
        <button
          type='button'
          onClick={toggle}
          data-track-category='Claw Agents'
          data-track-name={`Agent builder: switch to ${isBuilder ? 'preview' : 'builder'}`}
          className='flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground'
        >
          {isBuilder ? (
            <Eye className='size-3.5' aria-hidden />
          ) : (
            <Wrench className='size-3.5' aria-hidden />
          )}
          {isBuilder ? 'Switch to preview' : 'Switch to builder'}
        </button>
      </div>

      <div className='relative min-h-0 flex-1'>
        <div className={cn('h-full', !isBuilder && 'hidden')}>
          <XyneAISidebar
            channelId={null}
            variant='sidebar'
            forcedAgentSlug={BUILDER_DRIVER_SLUG}
            startFreshChat
            initialQuery={seed.query}
            autoSendNonce={seed.nonce}
            visible={isBuilder}
            hideEmptyStateSuggestions
            hideHeader
            hideHeaderClose
            hideBackgroundStreamNotice
            onStreamingChange={handleStreamingChange}
            onClose={onClose}
          />
        </div>

        {previewStarted && (
          <div className={cn('h-full', isBuilder && 'hidden')}>
            <XyneAISidebar
              channelId={null}
              variant='sidebar'
              forcedAgentSlug={agent.slug}
              startFreshChat
              visible={!isBuilder}
              hideEmptyStateSuggestions
              hideHeader
              hideHeaderClose
              hideBackgroundStreamNotice
              showAgentHeader
              onClose={onClose}
            />
          </div>
        )}
      </div>
    </div>
  );
}
