import { useMemo, useState } from 'react';
import { TestClassificationForm } from './TestClassificationForm';
import XyneAISidebar from '../../Chat/XyneAISidebar/XyneAISidebar';
import type { ChannelClawAgent } from '../../../hooks/useChannelClawAgents';

export interface AutoDraftAgentChatPanelProps {
  channelId: string;
  autoDraftAgentSlug: string | null;
  clawAgents: ChannelClawAgent[];
}

// "Try it" — the real Ask AI sidebar shown side by side with a sample-email form, locked to the desk's auto-draft agent.
export const AutoDraftAgentChatPanel: React.FC<AutoDraftAgentChatPanelProps> = ({
  channelId,
  autoDraftAgentSlug,
  clawAgents,
}) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [autoSendNonce, setAutoSendNonce] = useState(0);
  const [pendingQuery, setPendingQuery] = useState('');
  const [finalResponse, setFinalResponse] = useState('');

  const activeAgent = useMemo(
    () => clawAgents.find(a => a.slug === autoDraftAgentSlug),
    [clawAgents, autoDraftAgentSlug],
  );
  const agentLabel = activeAgent?.name ?? 'Default (Xyne AI)';
  const agentColor = activeAgent?.color ?? 'var(--desk-accent)';

  const handleRunPreview = (): void => {
    if (!subject.trim() || !body.trim() || isStreaming) return;
    const query = `Draft a reply to this email.\n\nSubject: ${subject}\n\n${body}`;
    setFinalResponse('');
    setPendingQuery(query);
    setAutoSendNonce(n => n + 1);
  };

  return (
    <div className='flex h-full min-h-[480px] flex-col gap-3 md:flex-row md:items-stretch'>
      <div className='flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-none'>
        <div className='flex items-center gap-1.5'>
          <span
            className='inline-block h-2.5 w-2.5 shrink-0 rounded-full'
            style={{ backgroundColor: agentColor }}
          />
          <span className='text-desk-helper'>
            Try it — see what <span className='font-medium text-foreground'>{agentLabel}</span>{' '}
            would draft
          </span>
        </div>

        <TestClassificationForm
          title='Type a sample email to preview the draft reply'
          subjectValue={subject}
          onSubjectChange={setSubject}
          bodyValue={body}
          onBodyChange={setBody}
          isPreviewing={isStreaming}
          onRunPreview={handleRunPreview}
          runButtonLabel='Generate preview'
          runningButtonLabel='Generating…'
          subjectTrackName='AutoDraftPreviewSubject'
          bodyTrackName='AutoDraftPreviewBody'
          runTrackName='RunAutoDraftPreview'
        >
          {finalResponse && (
            <div className='whitespace-pre-wrap rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground'>
              {finalResponse}
            </div>
          )}
        </TestClassificationForm>
      </div>

      <div className='flex h-[80vh] w-full min-w-0 flex-col overflow-hidden rounded-[10px] border border-border bg-background md:w-[38%] md:min-w-[320px] md:max-w-[480px] md:shrink-0'>
        <div className='flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2'>
          <span
            className='inline-block h-2 w-2 shrink-0 rounded-full'
            style={{ backgroundColor: agentColor }}
          />
          <span className='truncate text-sm font-medium text-foreground'>{agentLabel}</span>
        </div>
        <div className='min-h-0 flex-1'>
          <XyneAISidebar
            // Remount per generate so each preview starts its own session instead of
            // appending to the previous conversation (startFreshChat only fires on mount).
            key={autoSendNonce}
            channelId={channelId}
            startFreshChat
            forcedAgentSlug={autoDraftAgentSlug}
            initialQuery={pendingQuery}
            autoSendNonce={autoSendNonce}
            onStreamingChange={setIsStreaming}
            onFinalResponse={setFinalResponse}
            variant='sidebar'
          />
        </div>
      </div>
    </div>
  );
};
