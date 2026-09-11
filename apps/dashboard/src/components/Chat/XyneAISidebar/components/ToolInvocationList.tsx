import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Loader2, ChevronRight, Check, AlertCircle, Link2, CircleSlash, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ToolInvocation, ClawCitation } from '../utils/XyneAITypes';
import { buildClawCitationUrl, getClawCitationLabel } from '../utils/clawCitationUrl';
import { activityAccent } from './activityShared';

interface ToolInvocationListProps {
  invocations: ToolInvocation[];
  /** When the parent message was cancelled mid-stream, any invocation still in
   *  status='running' should render as cancelled (not as a perpetual spinner).
   *  Backend marks the message status='cancelled', but in-flight tool rows it
   *  emitted via pushInvocation never got their tool_execution_end frame —
   *  they stay 'running' in the array. Normalize at the render boundary. */
  messageAborted?: boolean | undefined;
}

/**
 * Turn a raw tool id like `Xyne_Spaces__spaces-create-ticket` or
 * `merge_pull_request` into a user-facing label like "Create Ticket" /
 * "Merge Pull Request". Strips the MCP server prefix if present, then
 * title-cases words separated by `-` or `_`.
 */
function humanizeToolName(raw: string): string {
  if (!raw) return raw;
  const stripped = raw.includes('__') ? raw.split('__').slice(1).join('__') : raw;
  const trimmed = stripped.includes(':') ? stripped.split(':').slice(-1)[0]! : stripped;
  return trimmed
    .split(/[-_]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function ToolInvocationList({
  invocations,
  messageAborted = false,
}: ToolInvocationListProps): ReactElement {
  // Normalize once per render — child invocations inside subagents inherit the
  // cancelled state from their parent message via this single sweep, so the
  // tree walker below doesn't need a second pass.
  const normalized = useMemo<ToolInvocation[]>(() => {
    if (!messageAborted) return invocations;
    return invocations.map(inv =>
      inv.status === 'running' || (inv.background && inv.backgroundState === 'running')
        ? { ...inv, status: 'cancelled' as const }
        : inv,
    );
  }, [invocations, messageAborted]);

  const roots: ToolInvocation[] = [];
  const childrenByParent = new Map<string, ToolInvocation[]>();

  for (const inv of normalized) {
    if (inv.parentToolCallId) {
      const list = childrenByParent.get(inv.parentToolCallId) ?? [];
      list.push(inv);
      childrenByParent.set(inv.parentToolCallId, list);
    } else {
      roots.push(inv);
    }
  }

  const toRender = roots.length > 0 ? roots : Array.from(childrenByParent.values()).flat();

  return (
    <div className='space-y-1'>
      {toRender.map((inv, i) => (
        <InvocationItem key={inv.toolCallId ?? `${inv.toolName}-${i}`} invocation={inv}>
          {inv.toolCallId ? childrenByParent.get(inv.toolCallId) : undefined}
        </InvocationItem>
      ))}
    </div>
  );
}

interface InvocationItemProps {
  invocation: ToolInvocation;
  children?: ToolInvocation[] | undefined;
}

interface CitationListProps {
  citations: ClawCitation[];
}

function CitationList({ citations }: CitationListProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const MAX_VISIBLE = 3;
  const hasOverflow = citations.length > MAX_VISIBLE;

  return (
    <div>
      <button
        onClick={() => hasOverflow && setExpanded(!expanded)}
        className={`flex w-full items-center justify-between ${hasOverflow ? 'cursor-pointer hover:text-foreground' : ''} text-muted-foreground/70 mb-1 text-[10px] uppercase tracking-wide`}
        type='button'
        data-track-category='XyneAI'
        data-track-name='toggle-citations-expand'
      >
        <span>Citations ({citations.length})</span>
        {hasOverflow && (
          <span className='text-[10px]'>
            {expanded ? 'Show less' : `Show all ${citations.length}`}
          </span>
        )}
      </button>
      <ul className={`space-y-1 ${expanded ? 'max-h-48 overflow-y-auto pr-1' : ''}`}>
        {(expanded ? citations : citations.slice(0, MAX_VISIBLE)).map((citation, idx) => {
          const url = buildClawCitationUrl(citation);
          const label = getClawCitationLabel(citation);

          return (
            <li key={idx} className='flex items-start gap-1.5'>
              <Link2 size={10} className='mt-0.5 shrink-0 text-muted-foreground/50' />
              {url ? (
                <Link
                  to={url}
                  className='break-all text-[10px] text-blue-500 hover:text-blue-600 hover:underline'
                  onClick={e => e.stopPropagation()}
                  data-track-category='XyneAI'
                  data-track-name='open-citation-link'
                >
                  {label}
                </Link>
              ) : (
                <span className='break-all text-[10px] text-muted-foreground'>{label}</span>
              )}
            </li>
          );
        })}
        {!expanded && hasOverflow && (
          <li className='text-[10px] text-muted-foreground/50 pl-4'>
            +{citations.length - MAX_VISIBLE} more
          </li>
        )}
      </ul>
    </div>
  );
}

function InvocationItem({ invocation, children }: InvocationItemProps): ReactElement {
  const [expanded, setExpanded] = useState(false);

  const isSubagent = children && children.length > 0;
  const isRunning = invocation.status === 'running';
  const isCancelled = invocation.status === 'cancelled';
  // A subagent spawned with run_in_background: the wrapper tool call returned
  // immediately (status='completed'), so its live state lives in backgroundState.
  const isBackground = invocation.background === true;
  const bgState = invocation.backgroundState;
  const isBackgroundRunning = isBackground && bgState === 'running' && !isCancelled;
  const runningChildren = children?.filter(c => c.status === 'running').length ?? 0;
  const completedChildren = (children?.length ?? 0) - runningChildren;
  // The subagent's currently-running inner tool — surfaced live on the card so a
  // busy subagent reads as busy without the user expanding it.
  const runningChild = children?.find(c => c.status === 'running');

  // Get a simple preview of what the tool is doing
  const getActionPreview = () => {
    const args = invocation.args ?? {};
    if (args['question']) return args['question'] as string;
    if (args['query']) return args['query'] as string;
    if (args['title']) return args['title'] as string;
    return null;
  };

  const preview = getActionPreview();

  return (
    // Subagents get a distinct bordered card so a nested LLM run reads as more
    // than a plain tool row; ordinary tools stay borderless.
    <div className={isSubagent ? `group border px-1.5 ${activityAccent.card}` : 'group'}>
      <button
        onClick={() => setExpanded(!expanded)}
        className='flex w-full items-center gap-2 py-1 text-left transition-colors hover:text-foreground'
        type='button'
        data-track-category='XyneAI'
        data-track-name='toggle-tool-invocation'
      >
        <ChevronRight
          size={14}
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />

        <div className='flex min-w-0 flex-1 items-center gap-2'>
          {/* Status indicator */}
          {isCancelled ? (
            // Subtle Stopped marker — same visual weight as the success Check
            // but always visible, so a user scanning a cancelled message sees
            // which tools were mid-flight when they hit Stop.
            <CircleSlash size={12} className='shrink-0 text-muted-foreground' />
          ) : isBackgroundRunning ? (
            // Detached background subagent still running — a slow gray clock,
            // deliberately distinct from the accent spinner of a BLOCKING tool
            // so it reads as "fired and kept going", not "waiting on this".
            <Clock size={12} className='animate-pulse shrink-0 text-muted-foreground' />
          ) : isRunning ? (
            <Loader2 size={12} className={`animate-spin shrink-0 ${activityAccent.text}`} />
          ) : invocation.isError || bgState === 'error' ? (
            // Errors are the only red — kept faint (red-400), not full destructive.
            <AlertCircle size={12} className='shrink-0 text-red-400' />
          ) : isBackground ? (
            // Completed background subagent — keep the check always visible so a
            // finished detached task reads as resolved, not hover-revealed.
            <Check size={12} className='shrink-0 text-emerald-500' />
          ) : (
            <Check
              size={12}
              className='shrink-0 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity'
            />
          )}

          {/* Tool name — subagents read as a group via the hairline box + the
              medium-weight name + child count, not a colored badge. */}
          <span
            className={`text-xs ${isSubagent ? 'font-medium text-foreground/80' : 'text-muted-foreground'}`}
          >
            {humanizeToolName(invocation.toolName)}
          </span>

          {/* Background (run_in_background) tag */}
          {isBackground && (
            <span
              className={`shrink-0 rounded px-1 text-[9px] uppercase tracking-wide ${activityAccent.bgChip}`}
            >
              {bgState === 'error'
                ? 'background · failed'
                : bgState === 'completed'
                  ? 'background · done'
                  : 'background'}
            </span>
          )}

          {/* Subagent indicator */}
          {isSubagent && (
            <span className='shrink-0 text-[10px] text-muted-foreground/70'>
              ({runningChildren > 0 ? `${completedChildren}/${children?.length}` : children?.length}
              )
            </span>
          )}

          {/* Live running child — what the subagent is doing right now */}
          {isSubagent && runningChild && !expanded && (
            <span className={`truncate text-[10px] ${activityAccent.soft}`}>
              ↳ {humanizeToolName(runningChild.toolName)}…
            </span>
          )}

          {/* Preview text */}
          {preview && !expanded && (
            <span className='truncate text-[11px] text-muted-foreground/70'>{preview}</span>
          )}

          {/* Duration */}
          <span className='ml-auto shrink-0 text-[10px] text-muted-foreground/60 tabular-nums'>
            {isBackgroundRunning
              ? 'running…'
              : isRunning
                ? '…'
                : isCancelled
                  ? 'stopped'
                  : `${invocation.durationMs}ms`}
          </span>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className='ml-3 border-l border-border pl-3 mt-1 space-y-2 text-[11px]'>
          {/* Arguments */}
          {Object.keys(invocation.args ?? {}).length > 0 && (
            <div>
              <div className='text-muted-foreground/70 mb-0.5 text-[10px] uppercase tracking-wide'>
                Arguments
              </div>
              <pre className='overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1.5 font-mono text-muted-foreground text-[10px]'>
                {JSON.stringify(invocation.args, null, 2)}
              </pre>
            </div>
          )}

          {/* Result. Cancelled rows have no result body — show a one-line
              "Stopped before completion" instead of an empty pre block. */}
          {!isRunning && !isCancelled && (
            <div>
              <div className='text-muted-foreground/70 mb-0.5 text-[10px] uppercase tracking-wide'>
                Result
              </div>
              <pre
                className={`overflow-x-auto whitespace-pre-wrap break-all rounded px-2 py-1.5 font-mono text-[10px] ${
                  invocation.isError
                    ? 'bg-red-400/10 text-red-400'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {invocation.result || '(no result)'}
              </pre>
            </div>
          )}
          {isCancelled && (
            <div className='text-[10px] italic text-muted-foreground/70'>
              Stopped before completion
            </div>
          )}

          {/* Nested tool calls */}
          {/* Citations */}
          {invocation.citations && invocation.citations.length > 0 && (
            <CitationList citations={invocation.citations} />
          )}

          {/* Nested tool calls */}
          {children && children.length > 0 && (
            <div className='pt-1'>
              <div className='text-muted-foreground/70 mb-1 text-[10px] uppercase tracking-wide'>
                Nested calls
              </div>
              <div className='space-y-0.5'>
                {children.map((child, i) => (
                  <InvocationItem
                    key={child.toolCallId ?? `${child.toolName}-${i}`}
                    invocation={child}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
