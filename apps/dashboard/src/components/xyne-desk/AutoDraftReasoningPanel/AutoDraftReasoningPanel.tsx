import { ReactElement, useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { apiInstance } from '../../../services/clients/apiClient';
import { ActivityBlock } from '../../Chat/XyneAISidebar/components/ActivityBlock';
import type { ToolInvocation } from '../../Chat/XyneAISidebar/utils/XyneAITypes';

interface InsightResponse {
  available: boolean;
  reasoning: string | null;
  /** Raw claw tool invocations (toolName, args, result, citations, …). */
  toolInvocations: ToolInvocation[];
}

interface AutoDraftReasoningPanelProps {
  conversationId: string;
  channelId: string;
}

function ReasoningSkeleton(): ReactElement {
  return (
    <div className='flex flex-col gap-3' aria-label='Loading reasoning'>
      <div className='h-2.5 w-24 rounded bg-muted animate-pulse' />
      <div className='space-y-1.5 rounded-md bg-muted/40 p-3'>
        <div className='h-2.5 w-full rounded bg-muted animate-pulse' />
        <div className='h-2.5 w-5/6 rounded bg-muted animate-pulse' />
        <div className='h-2.5 w-2/3 rounded bg-muted animate-pulse' />
      </div>
    </div>
  );
}

/**
 * "How this draft was generated" for the Support right-panel "Reasoning" tab.
 * Renders with the EXACT same component the XyneAI sidebar uses for a completed
 * assistant turn (`ActivityBlock` → reasoning + collapsible tool-call list with
 * citations), so the UI/dropdowns match 1:1. Nothing is stored Spaces-side —
 * this reads straight from claw via the `/email/:conversationId/autodraft-insight`
 * read-through endpoint.
 */
export const AutoDraftReasoningPanel = ({
  conversationId,
  channelId,
}: AutoDraftReasoningPanelProps): ReactElement => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [data, setData] = useState<InsightResponse | null>(null);

  const fetchInsight = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(false);
    try {
      const res = await apiInstance.get<InsightResponse>(
        `/email/${conversationId}/autodraft-insight`,
        { params: { channelId } },
      );
      setData(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [conversationId, channelId]);

  useEffect(() => {
    void fetchInsight();
  }, [fetchInsight]);

  if (loading) return <ReasoningSkeleton />;

  if (error) {
    return (
      <div className='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
        <span>Couldn’t load the agent’s reasoning.</span>
        <button
          type='button'
          onClick={() => void fetchInsight()}
          data-track-category='Support'
          data-track-name='RetryAutoDraftInsight'
          className='font-medium text-[#6276be] hover:underline'
        >
          Retry
        </button>
      </div>
    );
  }

  const reasoning = data?.reasoning?.trim() || '';
  const tools = data?.toolInvocations ?? [];
  const hasContent = reasoning.length > 0 || tools.length > 0;

  if (!hasContent) {
    return (
      <div className='flex flex-col items-center justify-center py-12 text-center text-xs text-muted-foreground'>
        <Sparkles size={20} className='mb-2 opacity-40' />
        No reasoning or tool calls were recorded for this draft.
      </div>
    );
  }

  return (
    <ActivityBlock
      reasoning={reasoning || undefined}
      toolInvocations={tools}
      streaming={false}
      fillHeight
    />
  );
};
