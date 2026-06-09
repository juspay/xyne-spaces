import { useState } from 'react';
import type { ReactElement } from 'react';
import { Loader2, ChevronRight, Check, AlertCircle, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ToolInvocation, ClawCitation } from '../utils/XyneAITypes';

interface ToolInvocationListProps {
  invocations: ToolInvocation[];
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

export function ToolInvocationList({ invocations }: ToolInvocationListProps): ReactElement {
  const roots: ToolInvocation[] = [];
  const childrenByParent = new Map<string, ToolInvocation[]>();

  for (const inv of invocations) {
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

/**
 * Build a URL for a citation based on its kind
 */
function buildCitationUrl(citation: ClawCitation): string | null {
  if (citation.kind === 'external' && citation.url) {
    return citation.url;
  }

  if (citation.kind === 'thread' && citation.channelId && citation.conversationId) {
    // Use relative URL with hash fragment to open thread panel (matches v1 format)
    return `/chat/dir/${citation.channelId}/${citation.conversationId}#origin=${citation.conversationId}`;
  }

  if (citation.kind === 'canvas' && citation.viewAccessId) {
    // Use relative URL to preserve workspace prefix
    return `/chat/canvas/${citation.viewAccessId}`;
  }

  if (
    citation.kind === 'ticket' &&
    citation.ticketId &&
    citation.channelId &&
    citation.conversationId
  ) {
    // Ticket URL format: /chat/dir/{channelId}/{conversationId}/{ticketId}?selectedTab=thread
    return `/chat/dir/${citation.channelId}/${citation.conversationId}/${citation.ticketId}?selectedTab=thread`;
  }

  return null;
}

/**
 * Get a display label for a citation
 */
function getCitationLabel(citation: ClawCitation): string {
  if (citation.label) return citation.label;

  if (citation.kind === 'thread') {
    if (citation.channelName) {
      return `Thread in #${citation.channelName}`;
    }
    return 'Spaces thread';
  }

  if (citation.kind === 'canvas') return 'Canvas';
  if (citation.kind === 'ticket') return `Ticket ${citation.ticketId || ''}`.trim();
  if (citation.kind === 'external') return 'Source link';

  return 'Reference';
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
        data-track-category='xyne-ai'
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
          const url = buildCitationUrl(citation);
          const label = getCitationLabel(citation);

          return (
            <li key={idx} className='flex items-start gap-1.5'>
              <Link2 size={10} className='mt-0.5 shrink-0 text-muted-foreground/50' />
              {url ? (
                <Link
                  to={url}
                  className='break-all text-[10px] text-blue-500 hover:text-blue-600 hover:underline'
                  onClick={e => e.stopPropagation()}
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
  const runningChildren = children?.filter(c => c.status === 'running').length ?? 0;
  const completedChildren = (children?.length ?? 0) - runningChildren;

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
    <div className='group'>
      <button
        onClick={() => setExpanded(!expanded)}
        className='flex w-full items-center gap-2 py-1 text-left transition-colors hover:text-foreground'
        type='button'
        data-track-category='xyne-ai'
        data-track-name='toggle-tool-invocation'
      >
        <ChevronRight
          size={14}
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />

        <div className='flex min-w-0 flex-1 items-center gap-2'>
          {/* Status indicator */}
          {isRunning ? (
            <Loader2 size={12} className='animate-spin shrink-0 text-blue-500' />
          ) : invocation.isError ? (
            <AlertCircle size={12} className='shrink-0 text-destructive' />
          ) : (
            <Check
              size={12}
              className='shrink-0 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity'
            />
          )}

          {/* Tool name */}
          <span className='text-xs text-muted-foreground'>
            {humanizeToolName(invocation.toolName)}
          </span>

          {/* Subagent indicator */}
          {isSubagent && (
            <span className='text-[10px] text-muted-foreground/70'>
              ({runningChildren > 0 ? `${completedChildren}/${children?.length}` : children?.length}
              )
            </span>
          )}

          {/* Preview text */}
          {preview && !expanded && (
            <span className='truncate text-[11px] text-muted-foreground/70'>{preview}</span>
          )}

          {/* Duration */}
          <span className='ml-auto shrink-0 text-[10px] text-muted-foreground/60 tabular-nums'>
            {isRunning ? '…' : `${invocation.durationMs}ms`}
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

          {/* Result */}
          {!isRunning && (
            <div>
              <div className='text-muted-foreground/70 mb-0.5 text-[10px] uppercase tracking-wide'>
                Result
              </div>
              <pre
                className={`overflow-x-auto whitespace-pre-wrap break-all rounded px-2 py-1.5 font-mono text-[10px] ${
                  invocation.isError
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {invocation.result || '(no result)'}
              </pre>
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
