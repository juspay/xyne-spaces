import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Braces,
  BrainCircuit,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  CirclePlay,
  CircleSlash,
  Copy,
  FileText,
  ListTree,
  Maximize2,
  MessagesSquare,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  User,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { fetchV2DebugArtifacts } from '../../../../services/XyneAI/XyneAISessionsV2Service';
import type { DebugArtifactBundle, DebugEventRecord } from '../utils/XyneAITypes';

interface AskAIDebugPanelProps {
  open: boolean;
  inline?: boolean;
  width?: number;
  minWidth?: number;
  conversationId: string;
  agentSlug: string;
  liveEvents: DebugEventRecord[];
  running: boolean;
  artifactsReadyVersion: number;
  selectedTurnIndex: number | null;
  selectedTurnLive: boolean;
  /** Branching-safe turn selection. When set, the panel renders ONLY the run
   *  whose data.sessionId matches — chronological turn indexes don't survive
   *  branching (the Nth visible assistant may not be the Nth run by time once
   *  siblings exist). Caller derives this from Message.debugSessionId. */
  selectedSessionId?: string | null;
  onClose: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function get<T>(obj: Record<string, unknown>, key: string): T | undefined {
  const value = obj[key];
  return typeof value !== 'undefined' ? (value as T) : undefined;
}

function getString(obj: Record<string, unknown>, key: string): string {
  return asString(obj[key]);
}

function getNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === 'number' ? value : undefined;
}

function getBool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getArray<T>(obj: Record<string, unknown>, key: string): T[] | undefined {
  const value = obj[key];
  return Array.isArray(value) ? (value as T[]) : undefined;
}

function formatTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !['{', '['].includes(trimmed[0] ?? '')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function truncate(value: string, limit = 220): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function messageText(message: Record<string, unknown>): string {
  if (typeof message['content'] === 'string') return message['content'];
  if (!Array.isArray(message['content'])) return '';
  const content = message['content'] as unknown[];
  const textBlocks = content
    .map(block => {
      if (!isRecord(block)) return '';
      if (typeof block['text'] === 'string') return block['text'];
      return '';
    })
    .filter(Boolean)
    .join('\n');
  if (textBlocks) return textBlocks;
  return content
    .map(block =>
      isRecord(block) && typeof block['thinking'] === 'string' ? block['thinking'] : '',
    )
    .filter(Boolean)
    .join('\n');
}

function messageTime(message: Record<string, unknown>): string {
  const value = message['createdAt'] ?? message['timestamp'];
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  return typeof value === 'string' ? value : '';
}

function displayMessageText(message: Record<string, unknown>): string {
  const text = messageText(message);
  if (asString(message['role']) !== 'user') return text;
  const match = /## (?:Query|User Reply)\s*\n([\s\S]*)$/m.exec(text);
  return match?.[1]?.trim() || text;
}

function messageLabel(role: string): string {
  if (role === 'user') return 'User';
  if (role === 'assistant') return 'Assistant';
  if (role === 'system') return 'System';
  return role || 'Message';
}

function jsonTypeLabel(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (isRecord(value)) {
    const count = Object.keys(value).length;
    return `${count} key${count === 1 ? '' : 's'}`;
  }
  if (value === null) return 'null';
  return typeof value;
}

function JsonPrimitive({ value }: { value: unknown }) {
  if (value === null) return <span className='text-neutral-500'>null</span>;
  if (value === undefined) return <span className='text-neutral-500'>undefined</span>;
  if (typeof value === 'string') {
    return (
      <span className='whitespace-pre-wrap break-words text-emerald-300'>
        {JSON.stringify(value)}
      </span>
    );
  }
  if (typeof value === 'number') return <span className='text-amber-300'>{String(value)}</span>;
  if (typeof value === 'boolean') return <span className='text-violet-300'>{String(value)}</span>;
  return <span className='break-words text-zinc-300'>{prettyJson(value)}</span>;
}

function JsonNode({
  label,
  value,
  depth,
  defaultExpandedDepth,
}: {
  label?: string;
  value: unknown;
  depth: number;
  defaultExpandedDepth: number;
}) {
  const expandable = Array.isArray(value) || isRecord(value);
  const [expanded, setExpanded] = useState(depth < defaultExpandedDepth);

  if (!expandable) {
    return (
      <div className='flex min-w-0 gap-1.5 py-px font-mono text-[11px] leading-5'>
        {label !== undefined && (
          <span className='shrink-0 text-sky-300'>{JSON.stringify(label)}:</span>
        )}
        <JsonPrimitive value={value} />
      </div>
    );
  }

  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  const openBracket = Array.isArray(value) ? '[' : '{';
  const closeBracket = Array.isArray(value) ? ']' : '}';

  return (
    <div className='font-mono text-[11px] leading-5'>
      <button
        type='button'
        onClick={() => setExpanded(current => !current)}
        className='flex w-full min-w-0 items-center gap-1 py-px text-left hover:bg-white/5'
        data-track-category='XyneAI'
        data-track-name='DEBUG_JSON_TOGGLE'
      >
        <ChevronDown
          size={11}
          className={`shrink-0 text-neutral-500 transition-transform ${expanded ? '' : '-rotate-90'}`}
        />
        {label !== undefined && (
          <span className='shrink-0 text-sky-300'>{JSON.stringify(label)}:</span>
        )}
        <span className='text-neutral-400'>{openBracket}</span>
        {!expanded && <span className='text-neutral-500'>{jsonTypeLabel(value)}</span>}
        {!expanded && <span className='text-neutral-400'>{closeBracket}</span>}
      </button>
      {expanded && (
        <div className='ml-[5px] border-l border-neutral-700 pl-3'>
          {entries.map(([key, child]) => (
            <JsonNode
              key={key}
              label={key}
              value={child}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
            />
          ))}
          <div className='text-neutral-400'>{closeBracket}</div>
        </div>
      )}
    </div>
  );
}

function JsonViewerModal({
  value,
  title,
  onClose,
}: {
  value: unknown;
  title: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const modal = (
    <div className='fixed inset-0 z-[1000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm'>
      <div className='flex h-[min(900px,calc(100vh-24px))] w-[min(1200px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-[#101418] shadow-2xl'>
        <div className='flex h-11 shrink-0 items-center gap-2 border-b border-zinc-700 px-3'>
          <Braces size={14} className='text-sky-400' />
          <span className='min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100'>
            {title}
          </span>
          <span className='text-[10px] text-zinc-500'>{jsonTypeLabel(value)}</span>
          <button
            type='button'
            onClick={() => {
              void navigator.clipboard.writeText(prettyJson(value));
            }}
            className='rounded px-2 py-1 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-100'
            data-track-category='XyneAI'
            data-track-name='DEBUG_JSON_MODAL_COPY'
          >
            Copy
          </button>
          <button
            type='button'
            onClick={onClose}
            className='rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white'
            data-track-category='XyneAI'
            data-track-name='DEBUG_JSON_MODAL_CLOSE'
          >
            <X size={15} />
          </button>
        </div>
        <div className='min-h-0 flex-1 overflow-auto p-3'>
          <JsonNode value={value} depth={0} defaultExpandedDepth={999} />
        </div>
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}

function CopyJsonButton({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prettyJson(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type='button'
      onClick={() => void copy()}
      className='flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-zinc-400 hover:bg-white/10 hover:text-zinc-100'
      title='Copy JSON'
      data-track-category='XyneAI'
      data-track-name='DEBUG_JSON_COPY'
    >
      {copied ? <Check size={12} className='text-emerald-400' /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function JsonViewer({
  value,
  title = 'JSON',
  defaultExpandedDepth = 999,
}: {
  value: unknown;
  title?: string;
  defaultExpandedDepth?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const parsedValue = useMemo(() => parseJsonLike(value), [value]);
  return (
    <>
      <div className='overflow-hidden rounded-md border border-zinc-700/80 bg-[#101418] shadow-inner'>
        <div className='flex h-8 items-center gap-1.5 border-b border-zinc-700/80 px-2'>
          <Braces size={12} className='text-sky-400' />
          <span className='min-w-0 flex-1 truncate text-[10px] font-semibold text-zinc-300'>
            {title}
          </span>
          <span className='text-[9px] text-zinc-500'>{jsonTypeLabel(parsedValue)}</span>
          <CopyJsonButton value={parsedValue} />
          <button
            type='button'
            onClick={() => setExpanded(true)}
            className='rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white'
            title='Open expanded JSON viewer'
            data-track-category='XyneAI'
            data-track-name='DEBUG_JSON_EXPAND'
          >
            <Maximize2 size={12} />
          </button>
        </div>
        <div className='max-h-64 overflow-auto p-2'>
          <JsonNode value={parsedValue} depth={0} defaultExpandedDepth={defaultExpandedDepth} />
        </div>
      </div>
      {expanded && (
        <JsonViewerModal value={parsedValue} title={title} onClose={() => setExpanded(false)} />
      )}
    </>
  );
}

type StreamRateSample = {
  offsetMs: number;
  streamsPerSec: number;
  streamsCollected: number;
};

function streamRateSamples(value: unknown): StreamRateSample[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(sample => {
    if (!isRecord(sample)) return [];
    const offsetMs = getNumber(sample, 'offsetMs');
    const streamsPerSec = getNumber(sample, 'streamsPerSec');
    const streamsCollected = getNumber(sample, 'streamsCollected');
    if (offsetMs === undefined || streamsPerSec === undefined || streamsCollected === undefined)
      return [];
    return [{ offsetMs, streamsPerSec, streamsCollected }];
  });
}

function streamTone(rate: number): {
  dot: string;
  text: string;
  bar: string;
  label: string;
} {
  if (rate >= 20) {
    return {
      dot: 'bg-emerald-400',
      text: 'text-emerald-600 dark:text-emerald-300',
      bar: 'bg-emerald-400',
      label: 'Fast',
    };
  }
  if (rate >= 8) {
    return {
      dot: 'bg-amber-400',
      text: 'text-amber-600 dark:text-amber-300',
      bar: 'bg-amber-400',
      label: 'Moderate',
    };
  }
  return {
    dot: 'bg-rose-400',
    text: 'text-rose-600 dark:text-rose-300',
    bar: 'bg-rose-400',
    label: 'Slow',
  };
}

function downsampleStreamRates(samples: StreamRateSample[], maxPoints = 48): StreamRateSample[] {
  if (samples.length <= maxPoints) return samples;
  const bucketSize = samples.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, bucketIndex) => {
    const start = Math.floor(bucketIndex * bucketSize);
    const end = Math.max(start + 1, Math.floor((bucketIndex + 1) * bucketSize));
    const bucket = samples.slice(start, end);
    const last = bucket[bucket.length - 1]!;
    return {
      offsetMs: last.offsetMs,
      streamsPerSec: bucket.reduce((sum, sample) => sum + sample.streamsPerSec, 0) / bucket.length,
      streamsCollected: last.streamsCollected,
    };
  });
}

function combineStreamRateWindows(windows: StreamRateSample[][]): StreamRateSample[] {
  const combined: StreamRateSample[] = [];
  let elapsedOffset = 0;
  let collectedOffset = 0;
  for (const window of windows) {
    if (window.length === 0) continue;
    for (const sample of window) {
      combined.push({
        offsetMs: elapsedOffset + sample.offsetMs,
        streamsPerSec: sample.streamsPerSec,
        streamsCollected: collectedOffset + sample.streamsCollected,
      });
    }
    const last = window[window.length - 1]!;
    elapsedOffset += last.offsetMs + 1000;
    collectedOffset += last.streamsCollected;
  }
  return combined;
}

function StreamRateGraph({ samples }: { samples: StreamRateSample[] }) {
  if (samples.length === 0) return null;
  const displaySamples = downsampleStreamRates(samples);
  const peak = Math.max(...samples.map(sample => sample.streamsPerSec), 1);
  const average = samples.reduce((sum, sample) => sum + sample.streamsPerSec, 0) / samples.length;
  const total = samples.at(-1)?.streamsCollected ?? 0;
  const tone = streamTone(average);

  return (
    <div className='overflow-hidden rounded-md border border-xyne-border-subtle bg-xyne-surface/70'>
      <div className='flex items-center gap-3 border-b border-xyne-border-subtle px-2 py-1 text-[9px] text-xyne-fg-muted'>
        <span className='font-semibold uppercase tracking-wide text-xyne-fg-tertiary'>
          Stream rate
        </span>
        <span className={tone.text}>
          <strong className='text-xyne-fg-secondary'>Avg</strong> {average.toFixed(1)}/s
        </span>
        <span>
          <strong className='text-xyne-fg-secondary'>Peak</strong> {peak.toFixed(1)}/s
        </span>
        <span className='ml-auto'>
          <strong className='text-xyne-fg-secondary'>Collected</strong> {total}
        </span>
      </div>
      <div
        className='grid h-16 items-end gap-px px-2 pt-2'
        style={{ gridTemplateColumns: `repeat(${displaySamples.length}, minmax(0, 1fr))` }}
      >
        {displaySamples.map((sample, index) => (
          <div
            key={`${sample.offsetMs}-${index}`}
            className={`w-full rounded-t-sm ${sample.streamsPerSec >= 20 ? 'bg-emerald-400' : sample.streamsPerSec >= 8 ? 'bg-amber-400' : 'bg-rose-400'}`}
            style={{ height: `${Math.max(5, (sample.streamsPerSec / peak) * 100)}%` }}
            title={`${(sample.offsetMs / 1000).toFixed(1)}s · ${sample.streamsPerSec.toFixed(1)} streams/s`}
          />
        ))}
      </div>
      <div className='flex justify-between px-2 pb-1 text-[9px] text-neutral-400'>
        <span>0s</span>
        <span>{((samples.at(-1)?.offsetMs ?? 0) / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
}

function StreamRateStatus({
  rate,
  collected,
  live,
}: {
  rate: number;
  collected: number;
  live: boolean;
}) {
  const tone = streamTone(rate);
  return (
    <div className='flex items-center gap-2 border-b border-xyne-border-subtle bg-xyne-surface px-3 py-1.5 text-[10px]'>
      <span className={`h-2 w-2 animate-pulse rounded-full ${tone.dot}`} />
      <span className={`font-semibold ${tone.text}`}>{live ? 'Streaming' : 'Stream rate'}</span>
      <span className='font-mono text-xs text-xyne-fg-secondary'>{rate.toFixed(1)} streams/s</span>
      <span className='ml-auto text-xyne-fg-muted'>{collected} collected</span>
    </div>
  );
}

function eventTitle(kind: string, data: Record<string, unknown>): string {
  if (kind === 'tool_execution_start' || kind === 'tool_execution_end') {
    const name = getString(data, 'toolName');
    return name ? `Tool · ${name}` : 'Tool call';
  }
  if (kind === 'session_prompt') return 'LLM request';
  if (kind === 'assistant_turn_end') return 'Assistant response';
  if (kind === 'session_start') return 'Session started';
  if (kind === 'session_end') return 'Session completed';
  if (kind === 'session_cancelled') return 'Session cancelled';
  if (kind === 'session_error') return 'Error';
  if (kind === 'auto_retry_start') return 'Retry attempt';
  if (kind === 'compaction_start') return 'Context compaction started';
  if (kind === 'compaction_end') return 'Context compaction completed';
  return kind.replaceAll('_', ' ');
}

function eventIcon(kind: string): { Icon: typeof Bug; color: string } {
  if (kind === 'session_prompt')
    return { Icon: BrainCircuit, color: 'text-indigo-500 dark:text-indigo-400' };
  if (kind === 'tool_execution_start' || kind === 'tool_execution_end')
    return { Icon: Wrench, color: 'text-amber-500 dark:text-amber-400' };
  if (kind === 'assistant_turn_end')
    return { Icon: Bot, color: 'text-emerald-500 dark:text-emerald-400' };
  if (kind === 'session_start')
    return { Icon: CirclePlay, color: 'text-sky-500 dark:text-sky-400' };
  if (kind === 'session_end')
    return { Icon: CheckCircle2, color: 'text-cyan-500 dark:text-cyan-400' };
  if (kind === 'session_cancelled') return { Icon: CircleSlash, color: 'text-muted-foreground' };
  if (kind === 'session_error')
    return { Icon: AlertCircle, color: 'text-red-500 dark:text-red-400' };
  if (kind === 'auto_retry_start')
    return { Icon: RotateCcw, color: 'text-orange-500 dark:text-orange-400' };
  if (kind === 'compaction_start' || kind === 'compaction_end')
    return { Icon: Zap, color: 'text-violet-500 dark:text-violet-400' };
  return { Icon: CirclePlay, color: 'text-xyne-fg-tertiary' };
}

function eventSummary(kind: string, data: Record<string, unknown>): string {
  switch (kind) {
    case 'session_start':
      return getString(data, 'task');
    case 'session_prompt': {
      const count = getNumber(data, 'messageCount') ?? 0;
      return count ? `Sending ${count} message${count === 1 ? '' : 's'} to the model` : '';
    }
    case 'tool_execution_start':
    case 'tool_execution_end':
      return '';
    case 'assistant_turn_end':
      return getString(data, 'assistantText')
        ? truncate(getString(data, 'assistantText'), 240)
        : '';
    case 'compaction_start':
      return 'Conversation history is being condensed';
    case 'compaction_end':
      return 'Conversation history condensed';
    case 'auto_retry_start':
      return 'Retrying after a transient error';
    case 'session_error':
      return getString(data, 'error');
    case 'session_cancelled': {
      const reason = getString(data, 'reason');
      const len = getNumber(data, 'partialTextLength') ?? 0;
      const tools = getNumber(data, 'toolCount') ?? 0;
      const parts: string[] = [];
      if (reason) parts.push(reason);
      if (len) parts.push(`${len} char${len === 1 ? '' : 's'} streamed`);
      if (tools) parts.push(`${tools} tool${tools === 1 ? '' : 's'}`);
      return parts.join(' · ');
    }
    case 'session_end':
      return '';
    default:
      return '';
  }
}

function compactTimeline(events: Record<string, unknown>[]): Record<string, unknown>[] {
  const compacted: Record<string, unknown>[] = [];
  const pendingTools = new Map<string, number>();
  for (const event of events) {
    const kind = getString(event, 'kind');
    const toolCallId = getString(event, 'toolCallId');
    if (kind === 'tool_execution_start' && toolCallId) {
      pendingTools.set(toolCallId, compacted.length);
      compacted.push(event);
      continue;
    }
    if (kind === 'tool_execution_end' && toolCallId && pendingTools.has(toolCallId)) {
      const index = pendingTools.get(toolCallId)!;
      const start = compacted[index]!;
      const startData = get<Record<string, unknown>>(start, 'data');
      const eventData = get<Record<string, unknown>>(event, 'data');
      compacted[index] = {
        ...event,
        startedAt: getString(start, 'at'),
        data: {
          ...(startData ?? {}),
          ...(eventData ?? {}),
        },
      };
      pendingTools.delete(toolCallId);
      continue;
    }
    if (kind === 'stream_rate') continue;
    compacted.push(event);
  }
  return compacted;
}

type SubagentTraceGroup = {
  subagentName: string;
  parentToolCallId: string;
  trace: Record<string, unknown>;
};

function groupSubagentTraces(traces: DebugArtifactBundle['subagents']): SubagentTraceGroup[] {
  return traces
    .map(sub => ({
      subagentName: getString(sub.data, 'subagentName') || sub.fileName,
      parentToolCallId: getString(sub.data, 'parentToolCallId'),
      trace: sub.data,
    }))
    .filter(item => item.parentToolCallId);
}

function subagentTraceMapForSession(
  subagents: DebugArtifactBundle['subagents'],
  sessionId: string,
): Map<string, SubagentTraceGroup[]> {
  const map = new Map<string, SubagentTraceGroup[]>();
  for (const trace of groupSubagentTraces(subagents)) {
    if (getString(trace.trace, 'parentSessionId') !== sessionId) continue;
    const list = map.get(trace.parentToolCallId) ?? [];
    list.push(trace);
    map.set(trace.parentToolCallId, list);
  }
  return map;
}

function liveSubagentTraceMap(events: DebugEventRecord[]): Map<string, SubagentTraceGroup[]> {
  const grouped = new Map<string, DebugEventRecord[]>();
  for (const event of events) {
    if (!event.subagentName) continue;
    const key = `${event.parentToolCallId ?? 'unknown'}`;
    const list = grouped.get(key) ?? [];
    list.push(event);
    grouped.set(key, list);
  }
  const map = new Map<string, SubagentTraceGroup[]>();
  for (const [parentToolCallId, group] of grouped.entries()) {
    const first = group[0];
    if (!first) continue;
    const compacted = compactTimeline(group as unknown as Record<string, unknown>[]);
    const firstData = isRecord(first.data) ? first.data : {};
    const trace = {
      ...firstData,
      question: getString(firstData, 'question') || getString(firstData, 'task') || 'Subagent task',
      task: getString(firstData, 'task') || getString(firstData, 'question') || 'Subagent task',
      events: compacted,
    };
    const list = map.get(parentToolCallId) ?? [];
    list.push({
      subagentName: first.subagentName || 'Subagent',
      parentToolCallId,
      trace,
    });
    map.set(parentToolCallId, list);
  }
  return map;
}

function MessageSnapshot({ message }: { message: unknown }) {
  if (!isRecord(message)) return <JsonViewer value={message} title='Message' />;
  const role = getString(message, 'role');
  const content = displayMessageText(message);
  const status = getString(message, 'status');
  const createdAt = messageTime(message);
  const isAssistant = role === 'assistant';
  const isUser = role === 'user';
  const isSystem = role === 'system';
  const RoleIcon = isAssistant ? Bot : isSystem ? FileText : User;
  const roleIconColor = isAssistant
    ? 'text-emerald-500 dark:text-emerald-400'
    : isUser
      ? 'text-sky-500 dark:text-sky-400'
      : 'text-xyne-fg-tertiary';
  return (
    <details className='group/msg border-b border-xyne-border-subtle/40 py-2 last:border-b-0'>
      <summary className='cursor-pointer list-none'>
        <div className='flex items-baseline gap-2'>
          <ChevronDown
            size={10}
            className='shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/msg:rotate-0'
          />
          <RoleIcon size={11} className={`shrink-0 self-center ${roleIconColor}`} />
          <span className='text-[12px] font-semibold text-xyne-fg-primary'>
            {messageLabel(role)}
          </span>
          {createdAt && (
            <span className='text-[11px] text-xyne-fg-muted'>{formatTime(createdAt)}</span>
          )}
          {status && <span className='text-[11px] text-xyne-fg-muted'>· {status}</span>}
        </div>
        <p className='mt-1 ml-[29px] line-clamp-2 whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary group-open/msg:hidden'>
          {content || '(empty)'}
        </p>
      </summary>
      <div className='mt-1 space-y-2 pl-2'>
        <pre className='max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary'>
          {content || '(empty)'}
        </pre>
        <details>
          <summary className='cursor-pointer list-none text-[10px] text-xyne-fg-muted hover:text-xyne-fg-secondary'>
            Show raw message data
          </summary>
          <div className='mt-1'>
            <JsonViewer
              value={message}
              title={`${messageLabel(role)} snapshot`}
              defaultExpandedDepth={999}
            />
          </div>
        </details>
      </div>
    </details>
  );
}

function SubagentTraceInline({ traces }: { traces: SubagentTraceGroup[] }) {
  if (traces.length === 0) return null;
  return (
    <div className='mt-1 space-y-1.5'>
      <p className='flex items-center gap-1.5 text-[12px] font-semibold text-xyne-fg-secondary'>
        <Workflow size={12} className='text-cyan-600 dark:text-cyan-400' />
        Subagent trace{traces.length === 1 ? '' : 's'}
      </p>
      <div className='space-y-1.5'>
        {traces.map(sub => (
          <div
            key={`${sub.parentToolCallId}:${sub.subagentName}`}
            className='rounded-md bg-xyne-surface px-2'
          >
            <TurnPanel
              data={sub.trace}
              title={`${sub.subagentName}: ${truncate(getString(sub.trace, 'question') || 'Subagent task', 80)}`}
              defaultOpen={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function DebugEventItem({
  event,
  subagentTracesByParentToolCallId,
}: {
  event: unknown;
  subagentTracesByParentToolCallId?: Map<string, SubagentTraceGroup[]>;
}) {
  if (!isRecord(event)) return <JsonViewer value={event} title='Event' />;

  const kind = getString(event, 'kind') || 'event';
  const seq = getString(event, 'seq');
  const at = getString(event, 'at');
  const startedAt = getString(event, 'startedAt');
  const subagentName = getString(event, 'subagentName');
  const data = get<Record<string, unknown>>(event, 'data') ?? {};
  const isTool = kind.startsWith('tool_execution');
  const isPendingTool = kind === 'tool_execution_start';
  const dataIsError = getBool(data, 'isError') === true;
  const isError = kind === 'session_error' || (isTool && dataIsError);
  const duration = getString(data, 'durationMs');
  const toolCallId = getString(data, 'toolCallId') || getString(event, 'toolCallId');
  const subagentTraces =
    isTool && toolCallId && subagentTracesByParentToolCallId
      ? (subagentTracesByParentToolCallId.get(toolCallId) ?? [])
      : [];

  const title = eventTitle(kind, data);
  const summary = eventSummary(kind, data);
  const timestamp = isTool ? at || startedAt : at;
  const statusLabel = isTool ? (dataIsError ? 'Failed' : isPendingTool ? 'Running' : 'OK') : '';
  const { Icon: EventIcon, color: eventColor } = eventIcon(kind);

  return (
    <details className='group/event border-b border-xyne-border-subtle/50 last:border-b-0'>
      <summary className='cursor-pointer list-none py-2'>
        <div className='flex items-baseline gap-2'>
          <ChevronDown
            size={11}
            className='shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/event:rotate-0'
          />
          <EventIcon
            size={12}
            className={`shrink-0 self-center ${isError ? 'text-red-500 dark:text-red-400' : eventColor}`}
          />
          <span
            className={`text-[13px] font-semibold ${isError ? 'text-red-600 dark:text-red-400' : 'text-xyne-fg-primary'}`}
          >
            {title}
          </span>
          {subagentName && (
            <span className='text-[11px] text-cyan-600 dark:text-cyan-400'>
              subagent: {subagentName}
            </span>
          )}
          {isTool && duration && (
            <span className='text-[11px] text-xyne-fg-muted'>{duration}ms</span>
          )}
          {statusLabel && (
            <span
              className={`text-[11px] ${dataIsError ? 'text-red-600 dark:text-red-400' : isPendingTool ? 'text-amber-600 dark:text-amber-400' : 'text-xyne-fg-muted'}`}
            >
              {statusLabel}
            </span>
          )}
          {subagentTraces.length > 0 && (
            <span className='text-[11px] text-cyan-600 dark:text-cyan-400'>
              spawned {subagentTraces.length} subagent{subagentTraces.length === 1 ? '' : 's'}
            </span>
          )}
          <span className='ml-auto shrink-0 text-[11px] text-xyne-fg-muted'>
            {timestamp ? formatTime(timestamp) : ''}
          </span>
        </div>
        {summary && (
          <p className='mt-1 ml-[34px] line-clamp-2 whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary group-open/event:hidden'>
            {summary}
          </p>
        )}
      </summary>
      <div className='space-y-1.5 pb-3 pl-2 pt-1'>
        {kind === 'session_prompt' && (
          <div className='space-y-1.5'>
            {getString(data, 'systemPrompt') && (
              <details className='group/sp rounded-md bg-xyne-surface'>
                <summary className='flex cursor-pointer list-none items-baseline gap-2 px-2 py-1.5'>
                  <ChevronDown
                    size={11}
                    className='shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/sp:rotate-0'
                  />
                  <FileText size={11} className='shrink-0 self-center text-xyne-fg-tertiary' />
                  <span className='text-[12px] font-semibold text-xyne-fg-secondary'>
                    System prompt
                  </span>
                  <span className='ml-auto text-[11px] text-xyne-fg-muted'>
                    {getString(data, 'systemPrompt').length} chars
                  </span>
                </summary>
                <div className='px-2 pb-2 pt-1'>
                  <pre className='max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary'>
                    {getString(data, 'systemPrompt')}
                  </pre>
                </div>
              </details>
            )}
            {(getArray(data, 'messages')?.length ?? 0) > 0 && (
              <details className='group/im rounded-md bg-xyne-surface'>
                <summary className='flex cursor-pointer list-none items-baseline gap-2 px-2 py-1.5'>
                  <ChevronDown
                    size={11}
                    className='shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/im:rotate-0'
                  />
                  <MessagesSquare
                    size={11}
                    className='shrink-0 self-center text-xyne-fg-tertiary'
                  />
                  <span className='text-[12px] font-semibold text-xyne-fg-secondary'>
                    Input messages
                  </span>
                  <span className='ml-auto text-[11px] text-xyne-fg-muted'>
                    {getArray(data, 'messages')!.length} message
                    {getArray(data, 'messages')!.length === 1 ? '' : 's'}
                  </span>
                </summary>
                <div className='px-2 pb-2 pt-1'>
                  {getArray<unknown>(data, 'messages')!.map((msg, index) => (
                    <MessageSnapshot key={`${seq}-msg-${index}`} message={msg} />
                  ))}
                </div>
              </details>
            )}
            {getString(data, 'prompt') && (
              <details className='group/up rounded-md bg-xyne-surface'>
                <summary className='flex cursor-pointer list-none items-baseline gap-2 px-2 py-1.5'>
                  <ChevronDown
                    size={11}
                    className='shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/up:rotate-0'
                  />
                  <User size={11} className='shrink-0 self-center text-xyne-fg-tertiary' />
                  <span className='text-[12px] font-semibold text-xyne-fg-secondary'>
                    User prompt
                  </span>
                  <span className='ml-auto text-[11px] text-xyne-fg-muted'>
                    {getString(data, 'prompt').length} chars
                  </span>
                </summary>
                <div className='px-2 pb-2 pt-1'>
                  <pre className='max-h-64 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary'>
                    {getString(data, 'prompt')}
                  </pre>
                </div>
              </details>
            )}
            <details className='rounded-md bg-xyne-surface'>
              <summary className='cursor-pointer list-none px-2 py-1.5 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-secondary'>
                Show raw event data
              </summary>
              <div className='px-2 pb-2 pt-1'>
                <JsonViewer value={data} title='LLM event' />
              </div>
            </details>
          </div>
        )}

        {kind === 'tool_execution_start' && (
          <div className='space-y-1.5'>
            {get(data, 'args') !== undefined && (
              <div className='space-y-1 rounded-md bg-xyne-surface px-2 py-1.5'>
                <p className='text-[12px] font-semibold text-xyne-fg-secondary'>Arguments</p>
                <JsonViewer
                  value={get(data, 'args')}
                  title='Arguments'
                  defaultExpandedDepth={999}
                />
              </div>
            )}
            <SubagentTraceInline traces={subagentTraces} />
          </div>
        )}

        {kind === 'tool_execution_end' && (
          <div className='space-y-1.5'>
            {get(data, 'args') !== undefined && (
              <div className='space-y-1 rounded-md bg-xyne-surface px-2 py-1.5'>
                <p className='text-[12px] font-semibold text-xyne-fg-secondary'>Arguments</p>
                <JsonViewer
                  value={get(data, 'args')}
                  title='Arguments'
                  defaultExpandedDepth={999}
                />
              </div>
            )}
            {/* Vespa query — emitted by kb-search and spaces-search. Lives on
                  data.debug.payloads (one entry per Vespa hit: "exact" + optional
                  "fuzzy-fallback"). Renders the YQL string verbatim so it can be
                  copy-pasted into a Vespa shell for replay. */}
            {(() => {
              const debugBlock = get<Record<string, unknown>>(data, 'debug');
              const payloads = isRecord(debugBlock)
                ? getArray<Record<string, unknown>>(debugBlock, 'payloads')
                : undefined;
              if (!payloads || payloads.length === 0) return null;
              return (
                <div className='space-y-1 rounded-md bg-xyne-surface px-2 py-1.5'>
                  <p className='text-[12px] font-semibold text-xyne-fg-secondary'>Vespa query</p>
                  {payloads.map((p, i) => (
                    <div key={i} className='space-y-1'>
                      {typeof p['stage'] === 'string' && (
                        <p className='text-[11px] text-xyne-fg-muted'>stage: {p['stage']}</p>
                      )}
                      {typeof p['yql'] === 'string' && (
                        <pre className='max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-xyne-bg p-2 text-[11px] leading-relaxed text-xyne-fg-secondary'>
                          {p['yql']}
                        </pre>
                      )}
                      {isRecord(p['vespaParams']) && (
                        <details className='rounded-md bg-xyne-bg'>
                          <summary className='cursor-pointer list-none px-2 py-1.5 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-secondary'>
                            Bound params + ranking inputs
                          </summary>
                          <div className='px-2 pb-2 pt-1'>
                            <JsonViewer value={p['vespaParams']} title='vespaParams' />
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
            {get(data, 'result') !== undefined && (
              <div className='space-y-1 rounded-md bg-xyne-surface px-2 py-1.5'>
                <p className='text-[12px] font-semibold text-xyne-fg-secondary'>Result</p>
                <JsonViewer value={get(data, 'result')} title='Result' defaultExpandedDepth={999} />
              </div>
            )}
            <SubagentTraceInline traces={subagentTraces} />
          </div>
        )}

        {kind === 'assistant_turn_end' && (
          <div className='space-y-1.5'>
            {getString(data, 'assistantText') && (
              <pre className='max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-xyne-surface p-2 text-[12px] leading-relaxed text-xyne-fg-secondary'>
                {getString(data, 'assistantText')}
              </pre>
            )}
            {(isRecord(get(data, 'usage')) ||
              getNumber(data, 'streamChars') !== undefined ||
              getNumber(data, 'streamCharsPerSec') !== undefined ||
              getNumber(data, 'streamTextChars') !== undefined ||
              getNumber(data, 'streamThinkingChars') !== undefined) && (
              <div className='flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-xyne-surface px-2 py-1.5 text-[11px] text-xyne-fg-secondary'>
                {(() => {
                  const usage = get<Record<string, unknown>>(data, 'usage');
                  if (!isRecord(usage)) return null;
                  const input =
                    getString(usage, 'input_tokens') || getString(usage, 'input') || '0';
                  const output =
                    getString(usage, 'output_tokens') || getString(usage, 'output') || '0';
                  return (
                    <span>
                      <span className='text-xyne-fg-muted'>Usage:</span> {input} in / {output} out
                    </span>
                  );
                })()}
                {getNumber(data, 'streamChars') !== undefined && (
                  <span>
                    <span className='text-xyne-fg-muted'>Chars:</span>{' '}
                    {getNumber(data, 'streamChars')}
                  </span>
                )}
                {getNumber(data, 'streamCharsPerSec') !== undefined && (
                  <span>
                    <span className='text-xyne-fg-muted'>Rate:</span>{' '}
                    {getString(data, 'streamCharsPerSec')} chars/s
                  </span>
                )}
                {getNumber(data, 'streamTextChars') !== undefined && (
                  <span>
                    <span className='text-xyne-fg-muted'>Text:</span>{' '}
                    {getNumber(data, 'streamTextChars')}
                  </span>
                )}
                {getNumber(data, 'streamThinkingChars') !== undefined && (
                  <span>
                    <span className='text-xyne-fg-muted'>Thinking:</span>{' '}
                    {getNumber(data, 'streamThinkingChars')}
                  </span>
                )}
              </div>
            )}
            {(getArray(data, 'streamRateSamples')?.length ?? 0) > 0 && (
              <StreamRateGraph samples={streamRateSamples(getArray(data, 'streamRateSamples'))} />
            )}
          </div>
        )}

        {kind === 'session_error' && getString(data, 'error') && (
          <pre className='whitespace-pre-wrap rounded-md bg-xyne-surface p-2 text-[12px] leading-relaxed text-red-700 dark:text-red-300'>
            {getString(data, 'error')}
          </pre>
        )}

        {kind === 'session_end' && (
          <div className='flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-xyne-surface px-2 py-1.5 text-[11px] text-xyne-fg-secondary'>
            {getNumber(data, 'textLength') !== undefined && (
              <span>
                <span className='text-xyne-fg-muted'>Length:</span> {getNumber(data, 'textLength')}
              </span>
            )}
            {getNumber(data, 'durationMs') !== undefined && (
              <span>
                <span className='text-xyne-fg-muted'>Duration:</span>{' '}
                {getNumber(data, 'durationMs')}ms
              </span>
            )}
            {getNumber(data, 'streamChars') !== undefined && (
              <span>
                <span className='text-xyne-fg-muted'>Chars:</span> {getNumber(data, 'streamChars')}
              </span>
            )}
            {getNumber(data, 'streamCharsPerSec') !== undefined && (
              <span>
                <span className='text-xyne-fg-muted'>Rate:</span>{' '}
                {getString(data, 'streamCharsPerSec')} chars/s
              </span>
            )}
            {(() => {
              const usage = get<Record<string, unknown>>(data, 'tokenUsage');
              if (!isRecord(usage)) return null;
              return (
                <span>
                  <span className='text-xyne-fg-muted'>Tokens:</span> {getString(usage, 'input')} in
                  / {getString(usage, 'output')} out
                </span>
              );
            })()}
          </div>
        )}

        {![
          'session_prompt',
          'tool_execution_start',
          'tool_execution_end',
          'assistant_turn_end',
          'session_error',
          'session_end',
          'session_cancelled',
        ].includes(kind) && (
          <details className='rounded-md bg-xyne-surface'>
            <summary className='cursor-pointer list-none px-2 py-1.5 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-secondary'>
              Show raw event data
            </summary>
            <div className='px-2 pb-2 pt-1'>
              <JsonViewer value={data} title='Event data' />
            </div>
          </details>
        )}
      </div>
    </details>
  );
}

function TurnPanel({
  data,
  title,
  defaultOpen = true,
  subagentTracesByParentToolCallId,
  isSelected = false,
}: {
  data: Record<string, unknown>;
  title: string;
  defaultOpen?: boolean;
  subagentTracesByParentToolCallId?: Map<string, SubagentTraceGroup[]>;
  isSelected?: boolean;
}) {
  const dataEvents = getArray(data, 'events');
  const events = compactTimeline(
    dataEvents
      ? dataEvents.filter(isRecord).filter(event => getString(event, 'kind') !== 'stream_rate')
      : [],
  );
  const streamSamples = combineStreamRateWindows(
    events.flatMap(event => {
      const eventData = get<Record<string, unknown>>(event, 'data');
      return getString(event, 'kind') === 'assistant_turn_end' && eventData
        ? [streamRateSamples(getArray(eventData, 'streamRateSamples'))]
        : [];
    }),
  );
  const tokens = get<Record<string, unknown>>(data, 'tokenUsage');
  const latency = get<Record<string, unknown>>(data, 'latency');
  const streamChars = getNumber(data, 'streamChars');
  const streamThinkingChars = getNumber(data, 'streamThinkingChars');
  const streamTextChars = getNumber(data, 'streamTextChars');
  const streamCharsPerSec = getNumber(data, 'streamCharsPerSec');
  const toolsUsed = getArray(data, 'toolsUsed') ?? [];
  const isSubagent = Boolean(getString(data, 'subagentName'));
  const TurnIcon = isSubagent ? Workflow : MessageSquareText;
  const turnIconColor = isSubagent ? 'text-cyan-600 dark:text-cyan-400' : 'text-xyne-fg-tertiary';
  const headerMeta = [
    getString(data, 'provider'),
    getString(data, 'model'),
    toolsUsed.length ? `${toolsUsed.length} tools` : '',
    `${events.length} events`,
  ]
    .filter(Boolean)
    .join(' · ');
  const hasStreamMetrics =
    Boolean(tokens) ||
    Boolean(latency) ||
    streamSamples.length > 0 ||
    streamChars !== undefined ||
    streamTextChars !== undefined ||
    streamThinkingChars !== undefined ||
    streamCharsPerSec !== undefined;

  return (
    <details open={defaultOpen} className='group/turn border-b border-xyne-border last:border-b-0'>
      <summary className='cursor-pointer list-none py-2'>
        <div className='flex items-baseline gap-2'>
          <ChevronDown
            size={13}
            className='shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/turn:rotate-0'
          />
          <TurnIcon size={13} className={`shrink-0 self-center ${turnIconColor}`} />
          <div className='min-w-0 flex-1'>
            <p className='truncate text-[14px] font-semibold text-xyne-fg-primary'>{title}</p>
            {headerMeta && <p className='truncate text-[11px] text-xyne-fg-muted'>{headerMeta}</p>}
          </div>
        </div>
      </summary>

      <div className={`space-y-2 pb-3 pl-2 pt-1 ${isSelected ? 'bg-xyne-surface-subtle/60' : ''}`}>
        {Boolean(
          getString(data, 'task') ||
          getString(data, 'question') ||
          getString(data, 'providerError'),
        ) && (
          <p
            className={`text-[12px] leading-relaxed ${getString(data, 'providerError') ? 'text-red-600 dark:text-red-400' : 'text-xyne-fg-secondary'}`}
          >
            {getString(data, 'providerError') ||
              getString(data, 'question') ||
              getString(data, 'task')}
          </p>
        )}

        {hasStreamMetrics && (
          <details className='group/sm'>
            <summary className='flex cursor-pointer list-none items-baseline gap-2 py-1'>
              <ChevronDown
                size={11}
                className='shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/sm:rotate-0'
              />
              <Activity size={11} className='shrink-0 self-center text-xyne-fg-tertiary' />
              <span className='text-[12px] font-semibold text-xyne-fg-secondary'>
                Stream metrics
              </span>
            </summary>
            <div className='space-y-2 pb-1 pl-2 pt-1.5'>
              {(tokens ||
                latency ||
                streamChars !== undefined ||
                streamTextChars !== undefined ||
                streamThinkingChars !== undefined ||
                streamCharsPerSec !== undefined) && (
                <div className='flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-xyne-fg-secondary'>
                  {tokens && (
                    <span>
                      <span className='text-xyne-fg-muted'>Tokens:</span>{' '}
                      {getString(tokens, 'input')} in / {getString(tokens, 'output')} out
                    </span>
                  )}
                  {latency && (
                    <span>
                      <span className='text-xyne-fg-muted'>Total:</span>{' '}
                      {getString(latency, 'totalMs')}ms
                    </span>
                  )}
                  {latency && (
                    <span>
                      <span className='text-xyne-fg-muted'>LLM:</span>{' '}
                      {getString(latency, 'llmTotalMs')}ms
                    </span>
                  )}
                  {streamCharsPerSec !== undefined && (
                    <span>
                      <span className='text-xyne-fg-muted'>Stream:</span>{' '}
                      {streamCharsPerSec.toFixed(1)} chars/s
                    </span>
                  )}
                  {streamChars !== undefined && (
                    <span>
                      <span className='text-xyne-fg-muted'>Chars:</span> {streamChars}
                    </span>
                  )}
                  {streamTextChars !== undefined && (
                    <span>
                      <span className='text-xyne-fg-muted'>Text:</span> {streamTextChars}
                    </span>
                  )}
                  {streamThinkingChars !== undefined && (
                    <span>
                      <span className='text-xyne-fg-muted'>Thinking:</span> {streamThinkingChars}
                    </span>
                  )}
                </div>
              )}
              {streamSamples.length > 0 && <StreamRateGraph samples={streamSamples} />}
            </div>
          </details>
        )}

        {events.length > 0 && (
          <details open className='group/tl'>
            <summary className='flex cursor-pointer list-none items-baseline gap-2 py-1'>
              <ChevronDown
                size={11}
                className='shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/tl:rotate-0'
              />
              <ListTree size={11} className='shrink-0 self-center text-xyne-fg-tertiary' />
              <span className='text-[12px] font-semibold text-xyne-fg-secondary'>Timeline</span>
              <span className='ml-auto text-[11px] text-xyne-fg-muted'>
                {events.length} event{events.length === 1 ? '' : 's'}
              </span>
            </summary>
            <div className='pl-1 pt-1'>
              {events.map((event, index) => (
                <DebugEventItem
                  key={`${getString(event, 'seq')}-${index}`}
                  event={event}
                  {...(subagentTracesByParentToolCallId
                    ? { subagentTracesByParentToolCallId }
                    : {})}
                />
              ))}
            </div>
          </details>
        )}

        <details className='group/raw'>
          <summary className='cursor-pointer list-none py-1 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-secondary'>
            Show raw run data
          </summary>
          <div className='pl-2 pt-1'>
            <JsonViewer value={{ ...data, events }} title='Run artifact' />
          </div>
        </details>
      </div>
    </details>
  );
}

function conversationPairs(
  messages: unknown[],
): Array<{ user: Record<string, unknown>; assistant?: Record<string, unknown> }> {
  const pairs: Array<{ user: Record<string, unknown>; assistant?: Record<string, unknown> }> = [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const role = getString(message, 'role');
    if (role === 'user') {
      pairs.push({ user: message });
    } else if (role === 'assistant' && pairs.length > 0 && !pairs[pairs.length - 1]?.assistant) {
      pairs[pairs.length - 1]!.assistant = message;
    }
  }
  return pairs;
}

function liveStreamStatus(
  events: DebugEventRecord[],
): { rate: number; collected: number; live: boolean } | null {
  const latestBySource = new Map<string, DebugEventRecord>();
  for (const event of events) {
    if (event.kind !== 'stream_rate') continue;
    const source = event.subagentName
      ? `${event.subagentName}:${event.parentToolCallId ?? 'unknown'}`
      : 'root';
    latestBySource.set(source, event);
  }
  if (latestBySource.size === 0) return null;
  let rate = 0;
  let collected = 0;
  let live = false;
  for (const event of latestBySource.values()) {
    const eventData = isRecord(event.data) ? event.data : {};
    const active = eventData['active'] === true;
    if (active && typeof eventData['streamsPerSec'] === 'number')
      rate += eventData['streamsPerSec'];
    if (typeof eventData['streamsCollected'] === 'number')
      collected += eventData['streamsCollected'];
    live ||= active;
  }
  return { rate, collected, live };
}

function persistedStreamStatus(
  bundle: DebugArtifactBundle | null,
): { rate: number; collected: number; live: false } | null {
  if (!bundle) return null;
  const candidates = [bundle.debugSession, ...(bundle.runs ?? []).map(run => run.data)].filter(
    (candidate): candidate is Record<string, unknown> => Boolean(candidate),
  );
  let latest: Record<string, unknown> | null = null;
  let latestAt = '';
  for (const candidate of candidates) {
    const events = getArray(candidate, 'events') ?? [];
    for (const event of events) {
      if (!isRecord(event) || getString(event, 'kind') !== 'assistant_turn_end') continue;
      const eventData = get<Record<string, unknown>>(event, 'data');
      if (!eventData) continue;
      const at = getString(event, 'at');
      if (!latest || at >= latestAt) {
        latest = eventData;
        latestAt = at;
      }
    }
  }
  if (!latest) return null;
  const samples = streamRateSamples(getArray(latest, 'streamRateSamples'));
  const collected = getNumber(latest, 'streamsCollected') ?? samples.at(-1)?.streamsCollected ?? 0;
  if (samples.length === 0 && collected === 0) return null;
  const rate =
    samples.length > 0
      ? samples.reduce((sum, sample) => sum + sample.streamsPerSec, 0) / samples.length
      : 0;
  return { rate, collected, live: false };
}

function DebugSessionBody({
  bundle,
  selectedTurnIndex,
  selectedSessionId,
}: {
  bundle: DebugArtifactBundle;
  selectedTurnIndex?: number | null;
  selectedSessionId?: string | null;
}) {
  const root = bundle.debugSession;
  const rootEvents = getArray(root ?? {}, 'events') ?? bundle.debugEvents ?? [];
  const persistedRuns = (bundle.runs ?? [])
    .slice()
    .sort((a, b) => getString(a.data, 'startedAt').localeCompare(getString(b.data, 'startedAt')));
  const historicalMessages = getArray(root ?? {}, 'messages') ?? [];
  const historicalPairs = conversationPairs(historicalMessages);
  const legacyPairs = historicalPairs.slice(
    0,
    Math.max(0, historicalPairs.length - persistedRuns.length),
  );
  const turnCount = legacyPairs.length + persistedRuns.length || historicalPairs.length;
  const subagents = bundle.subagents.slice().sort((a, b) => {
    const aStarted = getString(a.data, 'startedAt');
    const bStarted = getString(b.data, 'startedAt');
    return aStarted.localeCompare(bStarted);
  });

  return (
    <div className='space-y-2'>
      <div className='flex items-baseline justify-between pb-1'>
        <p className='text-[13px] font-semibold text-xyne-fg-primary'>Conversation turns</p>
        <p className='text-[11px] text-xyne-fg-muted'>
          {turnCount} turn{turnCount === 1 ? '' : 's'}
        </p>
      </div>

      {legacyPairs.map((pair, index) => {
        // Hide legacy pairs entirely when a sessionId selector is active —
        // those rows don't have a sessionId to match against, so the user's
        // pinned run can't be among them. Mirrors v3 DebugDrawer.
        if (selectedSessionId !== null) return null;
        if (selectedTurnIndex !== null && selectedTurnIndex !== index) return null;
        const useRootTimeline = persistedRuns.length === 0 && index === legacyPairs.length - 1;
        const rootSessionId = getString(root ?? {}, 'sessionId');
        return (
          <TurnPanel
            key={`legacy-turn-${index}`}
            title={`Turn ${index + 1}: ${truncate(displayMessageText(pair.user) || 'User request', 90)}`}
            data={
              useRootTimeline && root
                ? { ...root, events: rootEvents }
                : {
                    startedAt: messageTime(pair.user),
                    finishedAt: pair.assistant ? messageTime(pair.assistant) : '',
                    events: [],
                  }
            }
            defaultOpen={useRootTimeline}
            isSelected={selectedTurnIndex !== null}
            {...(useRootTimeline && rootSessionId
              ? {
                  subagentTracesByParentToolCallId: subagentTraceMapForSession(
                    subagents,
                    rootSessionId,
                  ),
                }
              : {})}
          />
        );
      })}

      {persistedRuns.length > 0
        ? persistedRuns.map((run, index) => {
            const turnIndex = legacyPairs.length + index;
            // Branching-safe: prefer sessionId match. Chronological turn order
            // doesn't survive sibling branches (regenerate, edit-user), so the
            // turn-index path picks the wrong run as soon as branches exist.
            const runSessionId = getString(run.data, 'sessionId');
            if (selectedSessionId !== null && runSessionId !== selectedSessionId) return null;
            if (
              selectedSessionId === null &&
              selectedTurnIndex !== null &&
              selectedTurnIndex !== turnIndex
            )
              return null;
            return (
              <TurnPanel
                key={run.fileName}
                title={`Turn ${legacyPairs.length + index + 1}: ${truncate(getString(run.data, 'task') || 'User request', 90)}`}
                data={run.data}
                defaultOpen={index === persistedRuns.length - 1}
                isSelected={selectedTurnIndex !== null || selectedSessionId !== null}
                subagentTracesByParentToolCallId={subagentTraceMapForSession(
                  subagents,
                  runSessionId,
                )}
              />
            );
          })
        : legacyPairs.length === 0 &&
          historicalPairs.length === 0 &&
          selectedSessionId === null &&
          (selectedTurnIndex === null || selectedTurnIndex === 0) && (
            <TurnPanel
              title='Latest run'
              data={root ? { ...root, events: rootEvents } : { events: [] }}
              defaultOpen
              isSelected={selectedTurnIndex !== null}
              {...(root
                ? {
                    subagentTracesByParentToolCallId: subagentTraceMapForSession(
                      subagents,
                      getString(root, 'sessionId'),
                    ),
                  }
                : {})}
            />
          )}
    </div>
  );
}

export function AskAIDebugPanel({
  open,
  inline = false,
  width = 460,
  minWidth = 460,
  conversationId,
  agentSlug,
  liveEvents,
  running,
  artifactsReadyVersion,
  selectedTurnIndex,
  selectedTurnLive,
  selectedSessionId = null,
  onClose,
}: AskAIDebugPanelProps) {
  const [bundle, setBundle] = useState<DebugArtifactBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const previousReady = useRef(artifactsReadyVersion);
  const runningRef = useRef(running);
  const bundleRef = useRef(bundle);
  runningRef.current = running;
  bundleRef.current = bundle;
  const liveRate = useMemo(() => liveStreamStatus(liveEvents), [liveEvents]);
  const savedRate = useMemo(() => persistedStreamStatus(bundle), [bundle]);
  const streamStatus = running && liveRate ? liveRate : (savedRate ?? liveRate);
  const liveSubagentTracesByParentToolCallId = useMemo(
    () => liveSubagentTraceMap(liveEvents),
    [liveEvents],
  );

  useEffect(() => {
    bundleRef.current = null;
    setBundle(null);
    setError(null);
  }, [conversationId, agentSlug]);

  useEffect(() => {
    if (!open || !conversationId) return;
    const readyChanged = artifactsReadyVersion !== previousReady.current;
    previousReady.current = artifactsReadyVersion;
    if (runningRef.current && !readyChanged && bundleRef.current) return;
    let cancelled = false;
    setLoading(!bundleRef.current && !runningRef.current);
    const load = async () => {
      const attempts = readyChanged ? 3 : 1;
      for (let attempt = 0; attempt < attempts && !cancelled; attempt += 1) {
        try {
          const data = await fetchV2DebugArtifacts(conversationId, agentSlug);
          if (!cancelled) {
            setBundle(data);
            setError(null);
          }
          break;
        } catch (err) {
          if (attempt < attempts - 1) {
            await new Promise(resolve => window.setTimeout(resolve, 400));
          } else if (!cancelled && !runningRef.current) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      }
      if (!cancelled) setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, agentSlug, artifactsReadyVersion, refresh]);

  if (!open) return null;

  const liveRootEvents = liveEvents.filter(event => !event.subagentName);
  const liveData: Record<string, unknown> = {
    events: liveRootEvents,
    messages: [],
    task: 'Live response',
  };

  const panel = (
    <>
      <div className='flex shrink-0 items-center gap-2 border-b border-xyne-border-subtle px-3 py-2'>
        <div className='flex h-7 w-7 items-center justify-center rounded-md bg-xyne-brand-ghost text-xyne-brand'>
          <Bug size={14} />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-[12px] font-semibold text-xyne-fg-primary'>
            {selectedSessionId
              ? `Run ${selectedSessionId.slice(0, 8)}`
              : selectedTurnIndex === null
                ? 'Ask AI Debugger'
                : `Response ${selectedTurnIndex + 1} Debugger`}
          </p>
          <p className='truncate text-[10px] text-xyne-fg-muted'>
            {agentSlug} {conversationId ? `· ${conversationId}` : ''}
          </p>
        </div>
        <button
          type='button'
          onClick={() => setRefresh(value => value + 1)}
          disabled={!conversationId || loading}
          className='inline-flex items-center gap-1 rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle px-2 py-1 text-[10px] font-medium text-xyne-fg-secondary transition hover:border-xyne-border hover:bg-xyne-surface disabled:cursor-not-allowed disabled:opacity-50'
          data-track-category='XyneAI'
          data-track-name='DEBUG_PANEL_REFRESH'
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <button
          type='button'
          onClick={onClose}
          className='flex h-7 w-7 items-center justify-center rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle text-xyne-fg-secondary transition hover:border-xyne-border hover:bg-xyne-surface hover:text-xyne-fg-primary'
          aria-label='Close debugger'
          data-track-category='XyneAI'
          data-track-name='DEBUG_PANEL_CLOSE'
        >
          <X size={16} />
        </button>
      </div>

      {streamStatus && (
        <StreamRateStatus
          rate={streamStatus.rate}
          collected={streamStatus.collected}
          live={running && streamStatus.live}
        />
      )}

      <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5 [overflow-anchor:none]'>
        {conversationId &&
          running &&
          liveEvents.length > 0 &&
          selectedSessionId === null &&
          (selectedTurnIndex === null || selectedTurnLive) && (
            <div className='mb-2.5'>
              <div className='mb-1 flex items-baseline gap-2'>
                <p className='text-[12px] font-semibold text-xyne-fg-secondary'>Live run</p>
                <p className='text-[11px] text-xyne-fg-muted'>
                  updates while the request is in flight
                </p>
              </div>
              <TurnPanel
                data={liveData}
                title='Live response'
                defaultOpen
                {...(liveSubagentTracesByParentToolCallId.size > 0
                  ? { subagentTracesByParentToolCallId: liveSubagentTracesByParentToolCallId }
                  : {})}
              />
            </div>
          )}

        {!conversationId ? (
          running && liveEvents.length > 0 ? (
            <div className='space-y-4'>
              <div>
                <div className='mb-1 flex items-baseline gap-2'>
                  <p className='text-[12px] font-semibold text-xyne-fg-secondary'>Live run</p>
                  <p className='text-[11px] text-xyne-fg-muted'>waiting for conversation id</p>
                </div>
                <TurnPanel
                  data={liveData}
                  title='Live response'
                  defaultOpen
                  {...(liveSubagentTracesByParentToolCallId.size > 0
                    ? { subagentTracesByParentToolCallId: liveSubagentTracesByParentToolCallId }
                    : {})}
                />
              </div>
              <p className='border-t border-xyne-border-subtle pt-3 text-[12px] text-xyne-fg-muted'>
                The conversation record will appear here once the backend assigns an id.
              </p>
            </div>
          ) : (
            <p className='py-6 text-[13px] text-xyne-fg-muted'>
              Open a conversation to inspect its runtime trace.
            </p>
          )
        ) : loading && !bundle ? (
          <div className='space-y-3'>
            <div className='h-24 animate-pulse rounded-md bg-xyne-surface-subtle' />
            <div className='h-72 animate-pulse rounded-md bg-xyne-surface-subtle' />
          </div>
        ) : error && !bundle ? (
          <p className='py-4 text-[13px] text-red-700 dark:text-red-300'>{error}</p>
        ) : bundle ? (
          <DebugSessionBody
            bundle={bundle}
            selectedTurnIndex={selectedTurnIndex}
            selectedSessionId={selectedSessionId}
          />
        ) : (
          <p className='py-6 text-[13px] text-xyne-fg-muted'>
            No debugger artifacts found for this conversation.
          </p>
        )}
      </div>
    </>
  );

  if (inline) {
    return (
      <div
        className='flex h-full min-h-0 shrink-0 flex-col border-l border-xyne-border-subtle bg-xyne-surface shadow-2xl'
        style={{ width, minWidth }}
      >
        {panel}
      </div>
    );
  }

  return (
    <div
      className='flex h-full min-h-0 shrink-0 flex-col border-l border-xyne-border-subtle bg-xyne-surface shadow-2xl'
      style={{ width, minWidth }}
    >
      {panel}
    </div>
  );
}
