import { ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { Wrench, Sparkles, ChevronRight, Brain } from 'lucide-react';
import { apiInstance } from '../../../services/clients/apiClient';
import { cn } from '../../../utils/classNames';

/**
 * A single tool call as persisted by claw. Fields are best-effort — claw's
 * ToolInvocation shape varies by provider, so everything is optional and
 * rendered defensively.
 */
interface ToolInvocation {
  toolName?: string;
  toolCallId?: string;
  status?: string;
  result?: unknown;
  args?: unknown;
  durationMs?: number;
  isError?: boolean;
}

interface InsightResponse {
  available: boolean;
  reasoning: string | null;
  toolInvocations: ToolInvocation[];
}

interface AutoDraftReasoningPanelProps {
  conversationId: string;
  channelId: string;
}

/**
 * Render a value as readable text. Objects (and JSON-encoded strings) are
 * pretty-printed so a result like `{"content":[{"type":"text",…}]}` reads as an
 * indented block instead of a one-line blob.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        /* not JSON — fall through to the raw string */
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable]';
  }
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

/** A collapsible tool-call card, mirroring the Claw UI's invocation blocks. */
function ToolCallCard({ tool }: { tool: ToolInvocation }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const argsStr = useMemo(() => formatValue(tool.args), [tool.args]);
  const resultStr = useMemo(() => formatValue(tool.result), [tool.result]);
  const preview = useMemo(
    () => (resultStr || argsStr).replace(/\s+/g, ' ').trim().slice(0, 120),
    [resultStr, argsStr],
  );

  return (
    <li
      className={cn(
        'rounded-lg border bg-background',
        tool.isError ? 'border-destructive/40' : 'border-border/60',
      )}
    >
      <button
        type='button'
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        data-track-category='Support'
        data-track-name='ToggleAutoDraftToolCall'
        className='flex w-full items-start gap-2 px-2.5 py-1.5 text-left'
      >
        <ChevronRight
          size={12}
          className={cn(
            'mt-0.5 flex-shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <Wrench
              size={12}
              className={cn(
                'flex-shrink-0',
                tool.isError ? 'text-destructive' : 'text-muted-foreground',
              )}
            />
            <span className='font-mono text-[12px] font-medium text-foreground'>
              {tool.toolName ?? 'tool'}
            </span>
            {tool.isError && (
              <span className='rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive'>
                error
              </span>
            )}
            {typeof tool.durationMs === 'number' && (
              <span className='ml-auto flex-shrink-0 text-[10px] tabular-nums text-muted-foreground'>
                {tool.durationMs}ms
              </span>
            )}
          </div>
          {!expanded && preview && (
            <p className='mt-0.5 truncate font-mono text-[11px] text-muted-foreground'>{preview}</p>
          )}
        </div>
      </button>

      {expanded && (
        <div className='space-y-2 border-t border-border/60 px-2.5 py-2'>
          {argsStr && (
            <div>
              <div className='mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
                Input
              </div>
              <pre className='max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-foreground/90'>
                {argsStr}
              </pre>
            </div>
          )}
          <div>
            <div className='mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
              Output
            </div>
            <pre className='max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-foreground/90'>
              {resultStr || '(empty)'}
            </pre>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Embedded "how this draft was generated" content for the Support right-panel
 * "Reasoning" tab — mirrors how DraftSourcesPanel renders inside the Sources
 * tab, and the Claw UI's reasoning + tool-call blocks.
 *
 * Nothing is stored on the Spaces side — this fetches on mount straight from
 * claw via the `/email/:conversationId/autodraft-insight` read-through endpoint.
 */
export const AutoDraftReasoningPanel = ({
  conversationId,
  channelId,
}: AutoDraftReasoningPanelProps): ReactElement => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [data, setData] = useState<InsightResponse | null>(null);
  // Thinking is collapsed by default — expand on demand, like the Claw UI.
  const [thinkingOpen, setThinkingOpen] = useState(false);

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
    <div className='flex flex-col gap-4'>
      {reasoning && (
        <div className='rounded-lg border border-border/60 bg-muted/20'>
          <button
            type='button'
            onClick={() => setThinkingOpen(v => !v)}
            aria-expanded={thinkingOpen}
            data-track-category='Support'
            data-track-name='ToggleAutoDraftThinking'
            className='flex w-full items-center gap-2 px-3 py-2 text-left'
          >
            <ChevronRight
              size={12}
              className={cn(
                'flex-shrink-0 text-muted-foreground transition-transform',
                thinkingOpen && 'rotate-90',
              )}
            />
            <Brain size={12} className='flex-shrink-0 text-muted-foreground' />
            <span className='text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
              Thinking
            </span>
            <span className='ml-auto flex-shrink-0 text-[10px] tabular-nums text-muted-foreground'>
              {reasoning.length} chars
            </span>
          </button>
          {thinkingOpen && (
            <div className='whitespace-pre-wrap border-t border-border/60 px-3 py-2 text-[13px] leading-relaxed text-foreground'>
              {reasoning}
            </div>
          )}
        </div>
      )}

      {tools.length > 0 && (
        <div>
          <div className='mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
            Tool calls ({tools.length})
          </div>
          <ul className='flex flex-col gap-1.5'>
            {tools.map((t, i) => (
              <ToolCallCard key={t.toolCallId ?? `${t.toolName ?? 'tool'}-${i}`} tool={t} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
