import type { ReactElement } from 'react';
import { useSelector } from '@xstate/react';
import XyneAISidebar from '../../components/Chat/XyneAISidebar/XyneAISidebar';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { SdlcChatHeader } from './SdlcChatHeader';
import { shouldUseInlineAssistantDebugger } from './sdlcChatPolicy';

interface SdlcAssistantPanelProps {
  canOpenConversations: boolean;
  onOpenConversations: () => void;
  onClose: () => void;
}

/**
 * SDLC adapter for the core Assistant module. It owns only shell wiring; all
 * conversation, streaming, history, context, composer, and message behavior
 * remains inside the shared XyneAISidebar.
 */
export function SdlcAssistantPanel({
  canOpenConversations,
  onOpenConversations,
  onClose,
}: SdlcAssistantPanelProps): ReactElement {
  const channelId = useSelector(xyneAIActor, state => state.context.channelId);
  const threadInfo = useSelector(xyneAIActor, state => state.context.threadInfo);
  const startFreshChat = useSelector(xyneAIActor, state => state.context.startFreshChat);
  const canvasInfo = useSelector(xyneAIActor, state => state.context.canvasInfo);
  const initialContextSelections = useSelector(
    xyneAIActor,
    state => state.context.initialContextSelections,
  );
  const contextOpenNonce = useSelector(xyneAIActor, state => state.context.contextOpenNonce);
  const kbCollectionId = useSelector(xyneAIActor, state => state.context.kbCollectionId);
  const kbChannelId = useSelector(xyneAIActor, state => state.context.kbChannelId);
  const kbDocId = useSelector(xyneAIActor, state => state.context.kbDocId);
  const kbDocName = useSelector(xyneAIActor, state => state.context.kbDocName);
  const kbOpenNonce = useSelector(xyneAIActor, state => state.context.kbOpenNonce);
  const researchContext = useSelector(xyneAIActor, state => state.context.researchContext);
  const initialQuery = useSelector(xyneAIActor, state => state.context.initialQuery);
  const autoSendNonce = useSelector(xyneAIActor, state => state.context.autoSendNonce);

  return (
    <aside className='flex h-full min-w-0 flex-col bg-transparent' aria-label='SDLC Assistant'>
      <SdlcChatHeader
        activeTab='ai'
        canOpenConversations={canOpenConversations}
        onOpenConversations={onOpenConversations}
        onOpenAI={() => undefined}
        onClose={onClose}
      />
      <div className='min-h-0 flex-1'>
        <XyneAISidebar
          channelId={channelId}
          threadInfo={threadInfo}
          startFreshChat={startFreshChat}
          canvasInfo={canvasInfo}
          initialContextSelections={initialContextSelections}
          contextOpenNonce={contextOpenNonce}
          kbCollectionId={kbCollectionId ?? ''}
          kbChannelId={kbChannelId ?? ''}
          kbDocId={kbDocId ?? ''}
          kbDocName={kbDocName ?? ''}
          kbOpenNonce={kbOpenNonce}
          researchContext={researchContext}
          initialQuery={initialQuery ?? undefined}
          autoSendNonce={autoSendNonce}
          onClose={onClose}
          preserveStreamingOnClose
          hideHeaderClose
          denseHeader
          debuggerPresentation={shouldUseInlineAssistantDebugger(true) ? 'split' : 'replace'}
        />
      </div>
    </aside>
  );
}
