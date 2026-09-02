import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  ChevronRight,
  CirclePlay,
  Copy,
  FileText,
  Lightbulb,
  ListTree,
  Maximize2,
  MessagesSquare,
  MessageSquareText,
  Quote,
  RefreshCw,
  RotateCcw,
  User,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchV2DebugArtifacts } from '../../../../services/XyneAI/XyneAISessionsV2Service';
import { debugArtifactFailureState } from './debugArtifactPollingPolicy';
import { mergeLiveDebugTimeline } from './unifiedDebugTimeline';
import type {
  DebugArtifactBundle,
  DebugEventRecord,
  FollowUpDiagnostic,
} from '../utils/XyneAITypes';

/** Inlined from claw's `toolFormat`: deep-parse JSON-in-strings and unwrap MCP
 *  `[{type:"text",text}]` content blocks so the tree viewer expands nested
 *  payloads instead of showing one escaped blob. Depth-bounded. */
function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !['{', '['].includes(trimmed[0] ?? '')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}
function unwrapContentBlocks(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const texts: string[] = [];
  for (const block of value) {
    if (!isRecord(block) || block['type'] !== 'text' || typeof block['text'] !== 'string')
      return null;
    texts.push(block['text']);
  }
  return texts.join('\n');
}
function deepParseJson(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  const parsed = tryParseJson(value);
  const unwrapped = unwrapContentBlocks(parsed);
  if (unwrapped !== null) return deepParseJson(unwrapped, depth + 1);
  if (Array.isArray(parsed)) return parsed.map(item => deepParseJson(item, depth + 1));
  if (isRecord(parsed)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed)) out[key] = deepParseJson(val, depth + 1);
    return out;
  }
  return parsed;
}

/** True when the dashboard is on the `midnight` (dark) theme. The dashboard
 *  toggles themes via a `data-theme` attribute on <html> and never sets a
 *  `.dark` class, so Tailwind `dark:` variants are inert app-wide. We scope a
 *  `dark` class onto this panel's root (below) only under midnight, so claw's
 *  `dark:` accent styling lights up inside the debugger without changing the
 *  app-wide theme strategy. */
function useIsMidnightTheme(): boolean {
  const [isDark, setIsDark] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme') === 'midnight',
  );
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.getAttribute('data-theme') === 'midnight');
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

type AskAIDebugPanelProps = {
  open: boolean;
  agentSlug: string;
  conversationId: string | null | undefined;
  onClose: () => void;
  inline?: boolean;
  width?: number;
  minWidth?: number;
  fill?: boolean;
  liveEvents?: DebugEventRecord[];
  running?: boolean;
  artifactsReadyVersion?: number;
  selectedTurnIndex?: number | null;
  selectedTurnLive?: boolean;
  /** Branching-safe turn selection. When set, the drawer renders ONLY the run
   *  whose data.sessionId matches — chronological turn indexes don't survive
   *  branching (the Nth visible assistant may not be the Nth run by time
   *  once siblings exist). Caller derives this from runByAssistantMsgId. */
  selectedSessionId?: string | null;
  /** When set, after the panel opens it expands + scrolls to the tool-call event
   *  whose toolCallId matches — used by generic auto-citation chips in the chat
   *  ("show the tool call in debug panel"). Matched via the `data-tool-call-id`
   *  attribute each event row carries. */
  focusToolCallId?: string | null;
  fetchArtifacts?: (conversationId: string, agentSlug: string) => Promise<DebugArtifactBundle>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Stringify an event `seq` id (number or string) for React keys — avoids
 *  no-base-to-string / restrict-template tripping on the `unknown` event shape. */
function seqKey(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function messageText(message: Record<string, unknown>): string {
  // compactionSummary / branchSummary messages carry their text in `summary`,
  // not `content` — without this they render as "(empty)".
  if (typeof message['summary'] === 'string') return message['summary'];
  if (typeof message['content'] === 'string') return message['content'];
  if (!Array.isArray(message['content'])) return '';
  const textBlocks = message['content']
    .map(block => {
      if (!isRecord(block)) return '';
      if (typeof block['text'] === 'string') return block['text'];
      return '';
    })
    .filter(Boolean)
    .join('\n');
  if (textBlocks) return textBlocks;
  return message['content']
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
  const match = /## (?:Query|User Reply)\s*\n([\s\S]*)$/.exec(text);
  return match?.[1]?.trim() || text;
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
  if (!trimmed) return value;
  if (!['{', '['].includes(trimmed[0] ?? '')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
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
  if (value === null) return <span className='text-xyne-fg-muted'>null</span>;
  if (value === undefined) return <span className='text-xyne-fg-muted'>undefined</span>;
  if (typeof value === 'string') {
    // Multi-line or long strings (markdown, code, search results) render as raw
    // text with real newlines on their own line — `JSON.stringify` would escape
    // them to a single unreadable `\n`-laden quoted line.
    if (value.includes('\n') || value.length > 120) {
      return (
        <span className='mt-0.5 block break-words whitespace-pre-wrap text-emerald-700 dark:text-emerald-300'>
          {value}
        </span>
      );
    }
    return (
      <span className='break-words whitespace-pre-wrap text-emerald-700 dark:text-emerald-300'>
        {JSON.stringify(value)}
      </span>
    );
  }
  if (typeof value === 'number')
    return <span className='text-amber-700 dark:text-amber-300'>{String(value)}</span>;
  if (typeof value === 'boolean')
    return <span className='text-violet-700 dark:text-violet-300'>{String(value)}</span>;
  // Leftover leaf kinds (bigint / symbol / function). Cast away the `unknown`
  // object case so the linter is happy; String() renders them fine at runtime.
  return <span className='break-words text-xyne-fg-secondary'>{String(value as bigint)}</span>;
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
          <span className='shrink-0 text-sky-700 dark:text-sky-300'>{JSON.stringify(label)}:</span>
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
        data-track-category='XyneAI'
        data-track-name='DEBUG_JSON_NODE_TOGGLE'
        onClick={() => setExpanded(current => !current)}
        className='flex w-full min-w-0 items-center gap-1 py-px text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
      >
        <ChevronDown
          size={11}
          className={`shrink-0 text-xyne-fg-muted transition-transform ${expanded ? '' : '-rotate-90'}`}
        />
        {label !== undefined && (
          <span className='shrink-0 text-sky-700 dark:text-sky-300'>{JSON.stringify(label)}:</span>
        )}
        <span className='text-xyne-fg-muted'>{openBracket}</span>
        {!expanded && <span className='text-xyne-fg-muted'>{jsonTypeLabel(value)}</span>}
        {!expanded && <span className='text-xyne-fg-muted'>{closeBracket}</span>}
      </button>
      {expanded && (
        <div className='ml-[5px] border-l border-xyne-border pl-3'>
          {entries.map(([key, child]) => (
            <JsonNode
              key={key}
              label={key}
              value={child}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
            />
          ))}
          <div className='text-xyne-fg-muted'>{closeBracket}</div>
        </div>
      )}
    </div>
  );
}

function CopyJsonButton({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      // Strings copy verbatim (markdown/text stays usable); structured values
      // copy as pretty JSON.
      await navigator.clipboard.writeText(typeof value === 'string' ? value : prettyJson(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type='button'
      data-track-category='XyneAI'
      data-track-name='DEBUG_JSON_COPY'
      onClick={() => void copy()}
      className='flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-xyne-fg-muted hover:bg-black/5 dark:hover:bg-white/10 hover:text-xyne-fg-primary'
      title='Copy'
    >
      {copied ? (
        <Check size={12} className='text-emerald-600 dark:text-emerald-400' />
      ) : (
        <Copy size={12} />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
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
    <div
      role='presentation'
      // Portalled to <body>, so when this opens above the twin's reasoning
      // popover it is a SIBLING of it, not a child — Radix therefore counts
      // clicks here as "outside" and Escape would close both layers at once.
      // `data-debug-json-modal` is what that popover's onInteractOutside /
      // onEscapeKeyDown guards match on to yield to this layer instead.
      // `pointer-events-auto` is belt-and-braces: harmless now the popover is
      // non-modal, and it keeps this usable if it is ever hosted under a modal
      // dialog, which zeroes body pointer-events.
      data-debug-json-modal=''
      className='pointer-events-auto fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm'
      onMouseDown={event => {
        // Close only on a true backdrop click — clicks inside the dialog don't
        // bubble a close (avoids a stop-propagation handler on the dialog, which
        // a non-interactive role isn't allowed to carry).
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-label={title}
        className='flex h-[min(900px,calc(100vh-24px))] w-[min(1200px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface shadow-2xl'
      >
        <div className='flex h-11 shrink-0 items-center gap-2 border-b border-xyne-border px-3'>
          <Braces size={14} className='text-sky-600 dark:text-sky-400' />
          <span className='min-w-0 flex-1 truncate text-xs font-semibold text-xyne-fg-primary'>
            {title}
          </span>
          <span className='text-[10px] text-xyne-fg-muted'>{jsonTypeLabel(value)}</span>
          <CopyJsonButton value={value} />
          <button
            type='button'
            data-track-category='XyneAI'
            data-track-name='DEBUG_JSON_MODAL_CLOSE'
            onClick={onClose}
            className='rounded p-1 text-xyne-fg-muted hover:bg-black/5 dark:hover:bg-white/10 hover:text-xyne-fg-primary'
            title='Close'
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
      <div className='overflow-hidden rounded-md border border-xyne-border bg-xyne-surface-sunken shadow-inner'>
        <div className='flex h-8 items-center gap-1.5 border-b border-xyne-border px-2'>
          <Braces size={12} className='text-sky-600 dark:text-sky-400' />
          <span className='min-w-0 flex-1 truncate text-[10px] font-semibold text-xyne-fg-secondary'>
            {title}
          </span>
          <span className='text-[9px] text-xyne-fg-muted'>{jsonTypeLabel(parsedValue)}</span>
          <CopyJsonButton value={parsedValue} />
          <button
            type='button'
            data-track-category='XyneAI'
            data-track-name='DEBUG_JSON_EXPAND'
            onClick={() => setExpanded(true)}
            className='rounded p-1 text-xyne-fg-muted hover:bg-black/5 dark:hover:bg-white/10 hover:text-xyne-fg-primary'
            title='Open expanded JSON viewer'
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

/** Markdown body shared by the result view and any other rendered-text surface. */
function MarkdownBody({ text }: { text: string }) {
  return (
    <div className='prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-table:my-2 prose-hr:my-2 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-th:border prose-td:border prose-th:border-xyne-border prose-td:border-xyne-border'>
      <Markdown remarkPlugins={[remarkGfm]}>{text || '_(empty)_'}</Markdown>
    </div>
  );
}

type ResultView = 'tree' | 'raw' | 'markdown';

/**
 * Renders a tool-call result readably with a view switch. Results arrive as a
 * string: compact JSON, an MCP content-block array, or plain text. We deep-parse
 * it — structured payloads default to an expandable tree (nested JSON-in-string
 * unwrapped); string payloads default to raw text with a Markdown toggle so
 * agent answers, summaries, and docs can be read rendered in the same panel.
 */
function ToolResultView({ value }: { value: unknown }) {
  const parsed = useMemo(() => deepParseJson(value), [value]);
  const isString = typeof parsed === 'string';
  const rawText = useMemo(
    () => (typeof parsed === 'string' ? parsed : prettyJson(parsed)),
    [parsed],
  );

  // Markdown only makes sense for text results; structured JSON gets Tree/Raw.
  const views: Array<{ id: ResultView; label: string }> = isString
    ? [
        { id: 'raw', label: 'Text' },
        { id: 'markdown', label: 'Markdown' },
      ]
    : [
        { id: 'tree', label: 'Tree' },
        { id: 'raw', label: 'Raw' },
      ];
  const [view, setView] = useState<ResultView>(isString ? 'raw' : 'tree');
  const [expanded, setExpanded] = useState(false);
  const activeView = views.some(v => v.id === view) ? view : views[0]!.id;

  return (
    <>
      <div className='overflow-hidden rounded-md border border-xyne-border bg-xyne-surface-sunken shadow-inner'>
        <div className='flex h-8 items-center gap-1.5 border-b border-xyne-border px-2'>
          <Braces size={12} className='text-sky-600 dark:text-sky-400' />
          <span className='min-w-0 flex-1 truncate text-[10px] font-semibold text-xyne-fg-secondary'>
            Result
          </span>
          <div className='flex items-center gap-0.5 rounded border border-xyne-border bg-xyne-surface p-0.5'>
            {views.map(v => (
              <button
                key={v.id}
                type='button'
                data-track-category='XyneAI'
                data-track-name='DEBUG_TOOL_RESULT_VIEW'
                onClick={() => setView(v.id)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${activeView === v.id ? 'bg-xyne-brand text-xyne-fg-inverse' : 'text-xyne-fg-muted hover:text-xyne-fg-primary'}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <CopyJsonButton value={isString ? rawText : parsed} />
          {activeView !== 'markdown' && (
            <button
              type='button'
              data-track-category='XyneAI'
              data-track-name='DEBUG_TOOL_RESULT_EXPAND'
              onClick={() => setExpanded(true)}
              className='rounded p-1 text-xyne-fg-muted hover:bg-black/5 dark:hover:bg-white/10 hover:text-xyne-fg-primary'
              title='Open expanded viewer'
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>
        <div className='max-h-72 overflow-auto p-2'>
          {activeView === 'tree' && (
            <JsonNode value={parsed} depth={0} defaultExpandedDepth={999} />
          )}
          {activeView === 'raw' && (
            <pre className='whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-xyne-fg-secondary'>
              {rawText || '(empty)'}
            </pre>
          )}
          {activeView === 'markdown' && <MarkdownBody text={rawText} />}
        </div>
      </div>
      {expanded && (
        <JsonViewerModal value={parsed} title='Result' onClose={() => setExpanded(false)} />
      )}
    </>
  );
}

function truncate(text: string, limit = 320): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
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
    const offsetMs = typeof sample['offsetMs'] === 'number' ? sample['offsetMs'] : null;
    const streamsPerSec =
      typeof sample['streamsPerSec'] === 'number' ? sample['streamsPerSec'] : null;
    const streamsCollected =
      typeof sample['streamsCollected'] === 'number' ? sample['streamsCollected'] : null;
    return offsetMs !== null && streamsPerSec !== null && streamsCollected !== null
      ? [{ offsetMs, streamsPerSec, streamsCollected }]
      : [];
  });
}

function streamRateTone(rate: number): { dot: string; text: string; bar: string; label: string } {
  if (rate >= 20)
    return {
      dot: 'bg-emerald-400',
      text: 'text-emerald-600 dark:text-emerald-300',
      bar: 'bg-emerald-400',
      label: 'Fast',
    };
  if (rate >= 8)
    return {
      dot: 'bg-amber-400',
      text: 'text-amber-600 dark:text-amber-300',
      bar: 'bg-amber-400',
      label: 'Moderate',
    };
  return {
    dot: 'bg-red-400',
    text: 'text-red-600 dark:text-red-300',
    bar: 'bg-red-400',
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
    elapsedOffset += last.offsetMs + 1_000;
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
  return (
    <div className='overflow-hidden rounded-md border border-xyne-border-subtle bg-xyne-surface/70'>
      <div className='flex items-center gap-3 border-b border-xyne-border-subtle px-2 py-1 text-[9px] text-xyne-fg-muted'>
        <span className='font-semibold uppercase tracking-wide text-xyne-fg-tertiary'>
          Stream rate
        </span>
        <span>
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
        {displaySamples.map((sample, index) => {
          const tone = streamRateTone(sample.streamsPerSec);
          return (
            <div
              key={`${sample.offsetMs}-${index}`}
              className={`w-full rounded-t-sm ${tone.bar} opacity-80 hover:opacity-100`}
              style={{ height: `${Math.max(4, (sample.streamsPerSec / peak) * 100)}%` }}
              title={`${(sample.offsetMs / 1000).toFixed(1)}s · ${sample.streamsPerSec.toFixed(1)} streams/s · ${sample.streamsCollected} collected`}
            />
          );
        })}
      </div>
      <div className='flex justify-between px-2 pb-1 text-[8px] text-xyne-fg-muted'>
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
  const tone = streamRateTone(rate);
  return (
    <div className='flex shrink-0 items-center gap-2 border-b border-xyne-border-subtle bg-xyne-surface-subtle/60 px-3 py-1.5 text-[10px]'>
      <span className={`h-2 w-2 rounded-full ${tone.dot} ${live ? 'animate-pulse' : ''}`} />
      <span className='font-semibold text-xyne-fg-secondary'>Streaming</span>
      <span className={`font-mono text-[12px] font-semibold ${tone.text}`}>
        {rate.toFixed(1)} streams/s
      </span>
      <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${tone.text}`}>
        {tone.label}
      </span>
      <span className='ml-auto text-xyne-fg-muted'>
        {collected} streams collected{live ? ' · live' : ' · persisted'}
      </span>
    </div>
  );
}

function messageLabel(role: string): string {
  if (role === 'user') return 'User';
  if (role === 'assistant') return 'Assistant';
  if (role === 'system') return 'System';
  return role || 'Message';
}

type TimelineEvent = Record<string, unknown> & { startedAt?: string };

function compactTimeline(events: unknown[]): TimelineEvent[] {
  const compacted: TimelineEvent[] = [];
  const pendingTools = new Map<string, number>();

  for (const value of events) {
    if (!isRecord(value) || ['message_update', 'stream_rate'].includes(asString(value['kind'])))
      continue;
    const event = value as TimelineEvent;
    const kind = asString(event['kind']);
    const toolCallId = asString(event['toolCallId']);
    if (kind === 'tool_execution_start' && toolCallId) {
      pendingTools.set(toolCallId, compacted.length);
      compacted.push(event);
      continue;
    }
    if (kind === 'tool_execution_end' && toolCallId && pendingTools.has(toolCallId)) {
      const index = pendingTools.get(toolCallId)!;
      const start = compacted[index]!;
      compacted[index] = {
        ...event,
        startedAt: asString(start['at']),
        data: {
          ...(isRecord(start['data']) ? start['data'] : {}),
          ...(isRecord(event['data']) ? event['data'] : {}),
        },
      };
      pendingTools.delete(toolCallId);
      continue;
    }
    compacted.push(event);
  }

  return compacted;
}

function eventTitle(kind: string, data: Record<string, unknown>): string {
  if (kind === 'tool_execution_start' || kind === 'tool_execution_end') {
    const name = asString(data['toolName']);
    return name ? `Tool · ${name}` : 'Tool call';
  }
  if (kind === 'session_prompt') return 'LLM request';
  if (kind === 'thinking') return 'Thinking';
  if (kind === 'assistant_turn_end') return 'Assistant response';
  if (kind === 'session_start') return 'Session started';
  if (kind === 'session_end') return 'Session completed';
  if (kind === 'session_error') return 'Error';
  if (kind === 'auto_retry_start') return 'Retry attempt';
  if (kind === 'compaction_start') return 'Context compaction started';
  if (kind === 'compaction_end') return 'Context compaction completed';
  if (kind === 'citation_reflection') return 'Citation check';
  if (kind === 'follow_up_suggestions') return 'Follow-up suggestions';
  if (kind === 'follow_up_generation_start') return 'Follow-up generation started';
  if (kind === 'follow_up_generation_end') return 'Follow-up generation completed';
  return kind.replaceAll('_', ' ');
}

/**
 * Structured-Trace row config per event kind: the short uppercase chip label,
 * the lucide icon, the 2px left-rail border color, and the chip text/bg.
 * `quiet` marks low-signal rows (LLM request) that recede via weight + opacity
 * rather than a hue. Colors are light/dark-safe Tailwind palette tokens — the
 * xyne fg-tertiary/fg-muted tokens are the SAME hex, so "quiet" can never come
 * from a second grey.
 */
type EventVisual = { Icon: typeof Bug; label: string; rail: string; chip: string; quiet?: boolean };

function eventVisual(kind: string, isError: boolean): EventVisual {
  if (isError)
    return {
      Icon: AlertCircle,
      label: kind === 'session_cancelled' ? 'CANCEL' : 'ERROR',
      rail: 'border-red-500',
      chip: 'bg-red-500/10 text-red-700 dark:text-red-300',
    };
  if (kind.startsWith('tool_execution'))
    return {
      Icon: Wrench,
      label: 'TOOL',
      rail: 'border-amber-500',
      chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    };
  switch (kind) {
    case 'session_start':
      return {
        Icon: CirclePlay,
        label: 'SESSION',
        rail: 'border-sky-500',
        chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
      };
    case 'session_prompt':
      return {
        Icon: BrainCircuit,
        label: 'LLM',
        rail: 'border-xyne-border-strong',
        chip: 'text-xyne-fg-muted',
        quiet: true,
      };
    case 'thinking':
      return {
        Icon: Lightbulb,
        label: 'THINK',
        rail: 'border-violet-500',
        chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
      };
    case 'assistant_turn_end':
      return {
        Icon: MessageSquareText,
        label: 'ASST',
        rail: 'border-emerald-500',
        chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      };
    case 'compaction_start':
    case 'compaction_end':
      return {
        Icon: Zap,
        label: 'COMPACT',
        rail: 'border-fuchsia-500',
        chip: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
      };
    case 'auto_retry_start':
      return {
        Icon: RotateCcw,
        label: 'RETRY',
        rail: 'border-orange-500',
        chip: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
      };
    case 'citation_reflection':
      return {
        Icon: Quote,
        label: 'CITE',
        rail: 'border-teal-500',
        chip: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
      };
    case 'session_end':
      return {
        Icon: CheckCircle2,
        label: 'DONE',
        rail: 'border-cyan-500',
        chip: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
      };
    case 'follow_up_suggestions':
    case 'follow_up_generation_start':
    case 'follow_up_generation_end':
      return {
        Icon: MessagesSquare,
        label: 'FOLLOW',
        rail: 'border-violet-500',
        chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
      };
    default:
      return {
        Icon: CirclePlay,
        label: kind.replaceAll('_', ' ').slice(0, 7).toUpperCase(),
        rail: 'border-xyne-border-strong',
        chip: 'text-xyne-fg-muted',
        quiet: true,
      };
  }
}

function persistedFollowUpLifecycleEvents(diagnostic: FollowUpDiagnostic): unknown[] {
  if (diagnostic.enabled === false || diagnostic.outcome === 'disabled') return [];
  const startedAt = diagnostic.generationStartedAt ?? diagnostic.startedAt;
  const start = {
    kind: 'follow_up_generation_start',
    seq: `follow-up-start-${diagnostic.sessionId}`,
    at: startedAt,
    data: diagnostic,
  };
  if (diagnostic.outcome === 'parallel_pending') return [start];
  return [
    start,
    {
      kind: 'follow_up_generation_end',
      seq: `follow-up-end-${diagnostic.sessionId}`,
      at: diagnostic.generationCompletedAt ?? diagnostic.completedAt ?? startedAt,
      data: diagnostic,
    },
  ];
}

/** Δ-from-origin label for the trace time column, e.g. "+0.0s", "+5.1s", "+1m04s". */
function formatDelta(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  if (s < 60) return `+${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `+${m}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

function DebugTimelineSection({
  title,
  data,
  defaultOpen = false,
  subagentTracesByParentToolCallId,
  selectedEventKey,
  onSelectEvent,
  timeMode = 'delta',
  followUpDiagnostic,
}: {
  title: string;
  data: Record<string, unknown> | null;
  defaultOpen?: boolean;
  subagentTracesByParentToolCallId?: Map<string, SubagentTraceGroup[]>;
  selectedEventKey?: string | null;
  onSelectEvent?: (key: string) => void;
  timeMode?: 'delta' | 'abs';
  followUpDiagnostic?: FollowUpDiagnostic | null;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const events = useMemo<unknown[]>(() => {
    const raw = data?.['events'];
    return Array.isArray(raw) ? (raw as unknown[]) : [];
  }, [data]);

  const visibleEvents = useMemo(() => {
    const compacted = compactTimeline(events);
    if (!followUpDiagnostic) return compacted;
    return [...compacted, ...persistedFollowUpLifecycleEvents(followUpDiagnostic)].sort((a, b) => {
      const aAt = isRecord(a) ? new Date(asString(a['at'])).getTime() : Number.NaN;
      const bAt = isRecord(b) ? new Date(asString(b['at'])).getTime() : Number.NaN;
      if (!Number.isFinite(aAt) || !Number.isFinite(bAt)) return 0;
      return aAt - bAt;
    });
  }, [events, followUpDiagnostic]);

  // Expand/collapse all timeline cards. The cards are native <details> elements
  // (no React state to lift), so we flip their `open` attribute through a ref.
  // Scoped to the timeline's direct-child cards — opens each tool/event card
  // without also unfurling every nested raw-data block inside them.
  const timelineRef = useRef<HTMLDivElement>(null);
  const setAllCards = (open: boolean) => {
    timelineRef.current?.querySelectorAll(':scope > details').forEach(node => {
      (node as HTMLDetailsElement).open = open;
    });
  };

  // Earliest event time = the origin for Δ timestamps in this run/turn.
  const originMs = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    for (const e of visibleEvents) {
      if (!isRecord(e)) continue;
      const t = Date.parse(asString(e['at']) || asString(e['startedAt']));
      if (Number.isFinite(t)) min = Math.min(min, t);
    }
    return Number.isFinite(min) ? min : undefined;
  }, [visibleEvents]);

  // Sub-steps (thinking / assistant / tool) indent under the spine; the LAST
  // assistant turn is the conclusion and stays flush.
  const lastAssistantIdx = useMemo(() => {
    let idx = -1;
    visibleEvents.forEach((e, i) => {
      if (isRecord(e) && asString(e['kind']) === 'assistant_turn_end') idx = i;
    });
    return idx;
  }, [visibleEvents]);

  const streamGraph = useMemo(
    () =>
      combineStreamRateWindows(
        events.flatMap(event => {
          if (
            !isRecord(event) ||
            asString(event['kind']) !== 'assistant_turn_end' ||
            !isRecord(event['data'])
          )
            return [];
          const samples = streamRateSamples(event['data']['streamRateSamples']);
          return samples.length > 0 ? [samples] : [];
        }),
      ),
    [events],
  );

  const toolsUsed = useMemo<unknown[]>(() => {
    const raw = data?.['toolsUsed'];
    return Array.isArray(raw) ? (raw as unknown[]) : [];
  }, [data]);

  const tokenUsage = isRecord(data?.['tokenUsage']) ? data?.['tokenUsage'] : null;
  const latency = isRecord(data?.['latency']) ? data?.['latency'] : null;
  const streamChars = typeof data?.['streamChars'] === 'number' ? data['streamChars'] : undefined;
  const streamThinkingChars =
    typeof data?.['streamThinkingChars'] === 'number' ? data['streamThinkingChars'] : undefined;
  const streamTextChars =
    typeof data?.['streamTextChars'] === 'number' ? data['streamTextChars'] : undefined;
  const streamCharsPerSec =
    typeof data?.['streamCharsPerSec'] === 'number' ? data['streamCharsPerSec'] : undefined;

  const headerMeta = [
    asString(data?.['provider']),
    asString(data?.['model']),
    toolsUsed.length ? `${toolsUsed.length} tools` : '',
    `${visibleEvents.length} events`,
  ]
    .filter(Boolean)
    .join(' · ');
  const TurnIcon = data?.['subagentName'] ? Workflow : MessageSquareText;
  const turnIconColor = data?.['subagentName']
    ? 'text-cyan-600 dark:text-cyan-400'
    : 'text-xyne-fg-tertiary';
  return (
    <details
      open={expanded}
      onToggle={event => setExpanded(event.currentTarget.open)}
      className='group/turn border-b border-xyne-border last:border-b-0'
    >
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

      {expanded && (
        <div className='ml-1.5 border-l border-xyne-border-subtle pl-4 pb-3 pt-1 space-y-2'>
          {Boolean(data?.['task'] || data?.['question'] || data?.['providerError']) && (
            <p
              className={`text-[12px] leading-relaxed ${data?.['providerError'] ? 'text-red-600 dark:text-red-400' : 'text-xyne-fg-secondary'}`}
            >
              {asString(data?.['providerError']) ||
                asString(data?.['question']) ||
                asString(data?.['task'])}
            </p>
          )}

          {(tokenUsage || latency || streamGraph.length > 0) && (
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
              <div className='ml-1.5 border-l border-xyne-border-subtle pl-4 pt-1.5 pb-1 space-y-2'>
                {(tokenUsage || latency) && (
                  <div className='flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-xyne-fg-secondary'>
                    {tokenUsage && (
                      <span>
                        <span className='text-xyne-fg-muted'>Tokens:</span>{' '}
                        {asString(tokenUsage['input'])} in / {asString(tokenUsage['output'])} out
                      </span>
                    )}
                    {latency && (
                      <span>
                        <span className='text-xyne-fg-muted'>Total:</span>{' '}
                        {asString(latency['totalMs'])}ms
                      </span>
                    )}
                    {latency && (
                      <span>
                        <span className='text-xyne-fg-muted'>LLM:</span>{' '}
                        {asString(latency['llmTotalMs'])}ms
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
                {streamGraph.length > 0 && <StreamRateGraph samples={streamGraph} />}
              </div>
            </details>
          )}

          {visibleEvents.length > 0 && (
            <details open className='group/tl'>
              <summary className='flex cursor-pointer list-none items-baseline gap-2 py-1'>
                <ChevronDown
                  size={11}
                  className='shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/tl:rotate-0'
                />
                <ListTree size={11} className='shrink-0 self-center text-xyne-fg-tertiary' />
                <span className='text-[12px] font-semibold text-xyne-fg-secondary'>Timeline</span>
                <div className='ml-auto flex items-baseline gap-2'>
                  <button
                    type='button'
                    data-track-category='XyneAI'
                    data-track-name='DEBUG_TIMELINE_EXPAND_ALL'
                    onClick={e => {
                      // Inside <summary> — stop the click from toggling the Timeline itself.
                      e.preventDefault();
                      e.stopPropagation();
                      setAllCards(true);
                    }}
                    className='text-[11px] text-xyne-fg-muted transition-colors hover:text-xyne-fg-secondary'
                  >
                    Expand all
                  </button>
                  <span className='text-[11px] text-xyne-fg-muted'>·</span>
                  <button
                    type='button'
                    data-track-category='XyneAI'
                    data-track-name='DEBUG_TIMELINE_COLLAPSE_ALL'
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAllCards(false);
                    }}
                    className='text-[11px] text-xyne-fg-muted transition-colors hover:text-xyne-fg-secondary'
                  >
                    Collapse all
                  </button>
                  <span className='text-[11px] text-xyne-fg-muted'>
                    {visibleEvents.length} event{visibleEvents.length === 1 ? '' : 's'}
                  </span>
                </div>
              </summary>
              <div ref={timelineRef} className='pt-1'>
                {visibleEvents.map((event, idx) => {
                  const ekind = isRecord(event) ? asString(event['kind']) : '';
                  const indented =
                    (ekind === 'thinking' ||
                      ekind === 'assistant_turn_end' ||
                      ekind.startsWith('tool_execution')) &&
                    idx !== lastAssistantIdx;
                  const ek = (isRecord(event) ? seqKey(event['seq']) : '') || String(idx);
                  return (
                    <DebugEventItem
                      key={ek}
                      event={event}
                      eventKey={ek}
                      displayIndex={idx + 1}
                      selected={selectedEventKey === ek}
                      onSelect={onSelectEvent}
                      subagentTracesByParentToolCallId={subagentTracesByParentToolCallId}
                      originMs={originMs}
                      timeMode={timeMode}
                      indented={indented}
                    />
                  );
                })}
              </div>
            </details>
          )}

          <details className='group/raw'>
            <summary className='cursor-pointer list-none py-1 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-secondary'>
              Show raw run data
            </summary>
            <div className='ml-1.5 border-l border-xyne-border-subtle pl-4 pt-1'>
              <JsonViewer value={{ ...data, events: visibleEvents }} title='Run artifact' />
            </div>
          </details>
        </div>
      )}
    </details>
  );
}

function MessageSnapshot({ message }: { message: unknown }) {
  if (!isRecord(message)) return <JsonViewer value={message} title='Message' />;
  const role = asString(message['role']);
  const content = displayMessageText(message);
  const status = asString(message['status']);
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
      <div className='ml-1.5 mt-1 border-l border-xyne-border-subtle pl-4 space-y-2'>
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
              title={`${messageLabel(role)} message`}
              defaultExpandedDepth={999}
            />
          </div>
        </details>
      </div>
    </details>
  );
}

function DebugEventItem({
  event,
  eventKey,
  selected = false,
  onSelect,
  subagentTracesByParentToolCallId,
  originMs,
  timeMode = 'delta',
  indented = false,
}: {
  event: unknown;
  eventKey: string;
  displayIndex?: number | undefined;
  selected?: boolean;
  onSelect?: ((key: string) => void) | undefined;
  subagentTracesByParentToolCallId?: Map<string, SubagentTraceGroup[]> | undefined;
  /** Run start (ms) used to compute Δ timestamps. */
  originMs?: number | undefined;
  /** "delta" → +Xs from run start (default); "abs" → wall-clock time. */
  timeMode?: 'delta' | 'abs';
  /** Sub-steps of a turn (thinking / assistant / tool) indent under the spine. */
  indented?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!isRecord(event)) {
    return <JsonViewer value={event} title='Event' />;
  }

  const kind = asString(event['kind']) || 'event';
  const seq = asString(event['seq']);
  const at = asString(event['at']);
  const startedAt = asString(event['startedAt']);
  const subagentName = asString(event['subagentName']);
  const data = isRecord(event['data']) ? event['data'] : {};
  const isTool = kind.startsWith('tool_execution');
  const isPendingTool = kind === 'tool_execution_start';
  const isError = kind === 'session_error' || (isTool && data['isError'] === true);
  const duration = asString(data['durationMs']);
  const subagentTraces =
    isTool && subagentTracesByParentToolCallId
      ? (subagentTracesByParentToolCallId.get(
          asString(data['toolCallId']) || asString(event['toolCallId']),
        ) ?? [])
      : [];

  const summary = eventSummary(kind, data);
  // LLM request is low-signal: its msg count rides on the title, so suppress the
  // redundant "Sending N messages" preview.
  const showSummary = Boolean(summary) && kind !== 'session_prompt';
  const timestamp = isTool ? at || startedAt : at;
  const visual = eventVisual(kind, isError);
  const VisualIcon = visual.Icon;

  // Title: tool name (mono) for tools; LLM request carries its msg count; the
  // final assistant turn is tagged; everything else uses its label.
  const msgCount = typeof data['messageCount'] === 'number' ? data['messageCount'] : null;
  const isFinalAssistant = kind === 'assistant_turn_end' && !indented;
  const titleText = isTool
    ? asString(data['toolName']) || 'tool'
    : kind === 'session_prompt'
      ? `LLM request${msgCount !== null ? ` · ${msgCount} msgs` : ''}`
      : isFinalAssistant
        ? 'Assistant response · final'
        : eventTitle(kind, data);
  const titleClass = isError
    ? 'font-semibold text-red-600 dark:text-red-400'
    : visual.quiet
      ? 'font-normal text-xyne-fg-tertiary opacity-70'
      : isTool
        ? 'font-mono font-medium text-xyne-fg-primary'
        : 'font-semibold text-xyne-fg-primary';

  // Time column: Δ-from-start by default (de-noises repeated wall-clock times),
  // absolute on the abs toggle and always on hover.
  const eventMs = timestamp ? Date.parse(timestamp) : NaN;
  const absTime = timestamp ? formatTime(timestamp) : '';
  const timeText =
    timeMode === 'abs' || originMs === undefined || !Number.isFinite(eventMs)
      ? absTime
      : formatDelta(eventMs - originMs);

  return (
    <details
      data-tool-call-id={asString(data['toolCallId']) || asString(event['toolCallId']) || undefined}
      open={expanded}
      onToggle={event => setExpanded(event.currentTarget.open)}
      className={`group/event border-l-2 ${visual.rail} ${indented ? 'ml-4' : ''} ${selected ? 'bg-xyne-surface-subtle/60' : 'hover:bg-black/[0.015] dark:hover:bg-white/[0.025]'}`}
    >
      <summary
        className='cursor-pointer list-none py-[5px] pl-2 pr-1'
        onPointerDown={() => onSelect?.(eventKey)}
      >
        <div className='flex items-center gap-2'>
          <span
            className={`flex w-[58px] shrink-0 items-center gap-1 rounded px-1 py-px text-[9px] font-bold uppercase tracking-[0.03em] ${visual.chip}`}
          >
            <VisualIcon size={10} className='shrink-0' />
            <span className='truncate'>{visual.label}</span>
          </span>
          <span className={`min-w-0 truncate text-[12.5px] leading-tight ${titleClass}`}>
            {titleText}
          </span>
          {subagentName && (
            <span className='shrink-0 rounded bg-cyan-500/10 px-1 text-[9px] text-cyan-700 dark:text-cyan-300'>
              {subagentName}
            </span>
          )}
          {subagentTraces.length > 0 && (
            <span className='shrink-0 text-[10px] text-cyan-600 dark:text-cyan-400'>
              +{subagentTraces.length} sub
            </span>
          )}
          <span className='ml-auto flex shrink-0 items-center font-mono text-[10.5px] tabular-nums'>
            <span className='w-[50px] text-right text-xyne-fg-secondary' title={absTime}>
              {timeText}
            </span>
            <span className='w-[50px] text-right text-xyne-fg-muted'>
              {isTool && duration ? `${duration}ms` : ''}
            </span>
            <span className='w-[58px] text-right'>
              {isTool &&
                (data['isError'] ? (
                  <span className='rounded bg-red-500/15 px-1 font-semibold text-red-700 dark:text-red-300'>
                    Failed
                  </span>
                ) : isPendingTool ? (
                  <span className='text-amber-600 dark:text-amber-400'>Running</span>
                ) : (
                  <span className='text-emerald-600 dark:text-emerald-400'>OK</span>
                ))}
            </span>
          </span>
          <ChevronRight
            size={11}
            className='ml-0.5 shrink-0 text-xyne-fg-tertiary opacity-0 transition group-hover/event:opacity-60 group-open/event:rotate-90'
          />
        </div>
        {showSummary && (
          <p
            className={`mt-0.5 line-clamp-2 whitespace-pre-wrap pl-[66px] pr-6 text-[12px] leading-relaxed group-open/event:hidden ${kind === 'thinking' ? 'italic text-xyne-fg-secondary' : 'text-xyne-fg-secondary'}`}
          >
            {summary}
          </p>
        )}
      </summary>
      {expanded && (
        <div
          className={`pl-[16px] pr-2 pb-3 pt-1 space-y-1.5 ${selected ? 'bg-xyne-surface-subtle/60' : ''}`}
        >
          {(kind === 'follow_up_suggestions' ||
            (kind === 'follow_up_generation_end' && typeof data['outcome'] === 'string')) && (
            <FollowUpDiagnosticsSection diagnostic={data as unknown as FollowUpDiagnostic} />
          )}
          {kind === 'session_prompt' && (
            <div className='space-y-1.5'>
              {typeof data['systemPrompt'] === 'string' && data['systemPrompt'] && (
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
                      {data['systemPrompt'].length} chars
                    </span>
                  </summary>
                  <div className='px-2 pb-2 pt-1'>
                    <pre className='max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary'>
                      {data['systemPrompt']}
                    </pre>
                  </div>
                </details>
              )}
              {Array.isArray(data['messages']) && data['messages'].length > 0 && (
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
                      {data['messages'].length} message{data['messages'].length === 1 ? '' : 's'}
                    </span>
                  </summary>
                  <div className='px-2 pb-2 pt-1'>
                    {(data['messages'] as unknown[]).map((msg, idx) => (
                      <MessageSnapshot key={`${seq}-msg-${idx}`} message={msg} />
                    ))}
                  </div>
                </details>
              )}
              {typeof data['prompt'] === 'string' && data['prompt'] && (
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
                      {data['prompt'].length} chars
                    </span>
                  </summary>
                  <div className='px-2 pb-2 pt-1'>
                    <pre className='max-h-64 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary'>
                      {data['prompt']}
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
              {'args' in data && (
                <div className='space-y-1 rounded-md bg-xyne-surface px-2 py-1.5'>
                  <p className='text-[12px] font-semibold text-xyne-fg-secondary'>Arguments</p>
                  <JsonViewer value={data['args']} title='Arguments' defaultExpandedDepth={999} />
                </div>
              )}
              <SubagentTraceInline traces={subagentTraces} />
            </div>
          )}

          {kind === 'tool_execution_end' && (
            <div className='space-y-1.5'>
              {'args' in data && (
                <div className='space-y-1 rounded-md bg-xyne-surface px-2 py-1.5'>
                  <p className='text-[12px] font-semibold text-xyne-fg-secondary'>Arguments</p>
                  <JsonViewer value={data['args']} title='Arguments' defaultExpandedDepth={999} />
                </div>
              )}
              {/* Vespa query — emitted by kb-search and spaces-search. Lives
                  on data.debug.payloads (one entry per Vespa hit: "exact" +
                  optional "fuzzy-fallback"). Renders the YQL string verbatim so
                  it can be copy-pasted into a Vespa shell for replay. */}
              {isRecord(data['debug']) && Array.isArray(data['debug']['payloads']) && (
                <div className='space-y-1 rounded-md bg-xyne-surface px-2 py-1.5'>
                  <p className='text-[12px] font-semibold text-xyne-fg-secondary'>Vespa query</p>
                  {(data['debug'] as { payloads: Array<Record<string, unknown>> }).payloads.map(
                    (p, i) => (
                      <div key={i} className='space-y-1'>
                        {typeof p['stage'] === 'string' && (
                          <p className='text-[11px] text-xyne-fg-muted'>stage: {p['stage']}</p>
                        )}
                        {typeof p['yql'] === 'string' && (
                          <pre className='max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-xyne-surface-sunken p-2 text-[11px] leading-relaxed text-xyne-fg-secondary'>
                            {p['yql']}
                          </pre>
                        )}
                        {isRecord(p['vespaParams']) && (
                          <details className='rounded-md bg-xyne-surface-sunken'>
                            <summary className='cursor-pointer list-none px-2 py-1.5 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-secondary'>
                              Bound params + ranking inputs
                            </summary>
                            <div className='px-2 pb-2 pt-1'>
                              <JsonViewer value={p['vespaParams']} title='vespaParams' />
                            </div>
                          </details>
                        )}
                      </div>
                    ),
                  )}
                </div>
              )}
              {'result' in data && (
                <div className='space-y-1 rounded-md bg-xyne-surface px-2 py-1.5'>
                  <p className='text-[12px] font-semibold text-xyne-fg-secondary'>Result</p>
                  <ToolResultView value={data['result']} />
                </div>
              )}
              <SubagentTraceInline traces={subagentTraces} />
            </div>
          )}

          {kind === 'thinking' && typeof data['text'] === 'string' && (
            // Match the collapsed preview exactly (italic sans, secondary, aligned
            // under the title) so expanding just reveals the FULL text in place,
            // not a heavier card with a different font.
            <p className='whitespace-pre-wrap pl-[58px] pr-6 text-[12px] italic leading-relaxed text-xyne-fg-secondary'>
              {data['text']}
            </p>
          )}

          {kind === 'assistant_turn_end' && (
            <div className='space-y-1.5'>
              {typeof data['assistantText'] === 'string' && (
                // Same casual-expand treatment as thinking (non-italic, matches the
                // assistant preview). Usage stats stay below as a metadata row.
                <p className='whitespace-pre-wrap pl-[58px] pr-6 text-[12px] leading-relaxed text-xyne-fg-secondary'>
                  {data['assistantText']}
                </p>
              )}
              {(isRecord(data['usage']) ||
                typeof data['streamChars'] === 'number' ||
                typeof data['streamCharsPerSec'] === 'number') && (
                <div className='flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-xyne-surface px-2 py-1.5 text-[11px] text-xyne-fg-secondary'>
                  {isRecord(data['usage']) && (
                    <span>
                      <span className='text-xyne-fg-muted'>Usage:</span>{' '}
                      {asString(data['usage']['input_tokens']) ||
                        asString(data['usage']['input']) ||
                        '0'}{' '}
                      in /{' '}
                      {asString(data['usage']['output_tokens']) ||
                        asString(data['usage']['output']) ||
                        '0'}{' '}
                      out
                    </span>
                  )}
                  {typeof data['streamChars'] === 'number' && (
                    <span>
                      <span className='text-xyne-fg-muted'>Chars:</span> {data['streamChars']}
                    </span>
                  )}
                  {typeof data['streamCharsPerSec'] === 'number' && (
                    <span>
                      <span className='text-xyne-fg-muted'>Rate:</span>{' '}
                      {asString(data['streamCharsPerSec'])} chars/s
                    </span>
                  )}
                  {typeof data['streamTextChars'] === 'number' && (
                    <span>
                      <span className='text-xyne-fg-muted'>Text:</span> {data['streamTextChars']}
                    </span>
                  )}
                  {typeof data['streamThinkingChars'] === 'number' && (
                    <span>
                      <span className='text-xyne-fg-muted'>Thinking:</span>{' '}
                      {data['streamThinkingChars']}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {kind === 'session_error' && typeof data['error'] === 'string' && (
            <pre className='whitespace-pre-wrap rounded-md bg-xyne-surface p-2 text-[12px] leading-relaxed text-red-700 dark:text-red-300'>
              {data['error']}
            </pre>
          )}

          {kind === 'session_end' && (
            <div className='flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-xyne-surface px-2 py-1.5 text-[11px] text-xyne-fg-secondary'>
              {typeof data['textLength'] === 'number' && (
                <span>
                  <span className='text-xyne-fg-muted'>Length:</span> {data['textLength']}
                </span>
              )}
              {typeof data['durationMs'] === 'number' && (
                <span>
                  <span className='text-xyne-fg-muted'>Duration:</span> {data['durationMs']}ms
                </span>
              )}
              {typeof data['streamChars'] === 'number' && (
                <span>
                  <span className='text-xyne-fg-muted'>Chars:</span> {data['streamChars']}
                </span>
              )}
              {typeof data['streamCharsPerSec'] === 'number' && (
                <span>
                  <span className='text-xyne-fg-muted'>Rate:</span>{' '}
                  {asString(data['streamCharsPerSec'])} chars/s
                </span>
              )}
              {isRecord(data['tokenUsage']) && (
                <span>
                  <span className='text-xyne-fg-muted'>Tokens:</span>{' '}
                  {asString(data['tokenUsage']['input'])} in /{' '}
                  {asString(data['tokenUsage']['output'])} out
                </span>
              )}
            </div>
          )}

          {![
            'session_prompt',
            'tool_execution_start',
            'tool_execution_end',
            'assistant_turn_end',
            'session_error',
            'session_end',
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
      )}
    </details>
  );
}

function eventSummary(kind: string, data: Record<string, unknown>): string {
  switch (kind) {
    case 'session_start':
      return asString(data['task']);
    case 'session_prompt': {
      const count = typeof data['messageCount'] === 'number' ? data['messageCount'] : 0;
      return count ? `Sending ${count} message${count === 1 ? '' : 's'} to the model` : '';
    }
    case 'tool_execution_start':
    case 'tool_execution_end':
      return '';
    case 'thinking':
      return typeof data['text'] === 'string' ? truncate(data['text'], 240) : '';
    case 'assistant_turn_end':
      return typeof data['assistantText'] === 'string' ? truncate(data['assistantText'], 240) : '';
    case 'compaction_start':
      return 'Conversation history is being condensed';
    case 'compaction_end': {
      if (typeof data['errorMessage'] === 'string' && data['errorMessage'])
        return truncate(data['errorMessage'], 240);
      // Show the compacted summary (the "response") when present; the full text
      // is in the raw event data. Falls back to the generic line for no-op/aborted.
      return typeof data['summary'] === 'string' && data['summary']
        ? truncate(data['summary'], 240)
        : 'Conversation history condensed';
    }
    case 'auto_retry_start':
      return 'Retrying after a transient error';
    case 'session_error':
      return asString(data['error']);
    case 'session_end':
      return '';
    case 'citation_reflection': {
      if (asString(data['phase']) === 'nudge') {
        const round = typeof data['round'] === 'number' ? data['round'] : 0;
        const maxRounds = typeof data['maxRounds'] === 'number' ? data['maxRounds'] : 0;
        return `Answer used sources but isn't cited — nudging the model to add citations (round ${round}/${maxRounds})`;
      }
      const outcome = asString(data['outcome']);
      const labels: Record<string, string> = {
        already_cited: 'Answer already cited — no action needed',
        no_citeable_sources: 'No citeable sources retrieved — nothing to enforce',
        fixed_after_nudge: 'Citations added after reflection',
        still_uncited: 'Still uncited after reflection',
        aborted: 'Reflection aborted (run cancelled)',
      };
      return labels[outcome] ?? outcome.replaceAll('_', ' ');
    }
    case 'follow_up_suggestions': {
      const count = typeof data['suggestionCount'] === 'number' ? data['suggestionCount'] : 0;
      const outcome = asString(data['outcome']).replaceAll('_', ' ');
      const source = asString(data['generationSource']);
      return `${outcome || 'unknown'} · ${count} suggestion${count === 1 ? '' : 's'}${source ? ` · ${source}` : ''}`;
    }
    case 'follow_up_generation_start': {
      const input = asString(data['generationInput']).replaceAll('_', ' ');
      const count =
        typeof data['conversationMessageCount'] === 'number' ? data['conversationMessageCount'] : 0;
      return `${input || 'prompt only'} · ${count} prior message${count === 1 ? '' : 's'}`;
    }
    case 'follow_up_generation_end': {
      const count = typeof data['suggestionCount'] === 'number' ? data['suggestionCount'] : 0;
      const source = asString(data['generationSource'] || data['source']);
      const outcome = asString(data['outcome'] || data['status']).replaceAll('_', ' ');
      const duration =
        typeof data['generationDurationMs'] === 'number'
          ? data['generationDurationMs']
          : typeof data['durationMs'] === 'number'
            ? data['durationMs']
            : null;
      return `${outcome || 'completed'} · ${count} suggestion${count === 1 ? '' : 's'}${source ? ` · ${source}` : ''}${duration !== null ? ` · ${duration} ms` : ''}`;
    }
    default:
      return '';
  }
}

type SubagentTraceGroup = {
  subagentName: string;
  parentToolCallId: string;
  trace: Record<string, unknown>;
};

function groupSubagentTraces(traces: DebugArtifactBundle['subagents']): SubagentTraceGroup[] {
  return traces
    .map(sub => ({
      subagentName: asString(sub.data['subagentName']) || sub.fileName,
      parentToolCallId: asString(sub.data['parentToolCallId']),
      trace: sub.data,
    }))
    .filter(item => item.parentToolCallId);
}

function SubagentTraceInline({ traces }: { traces: SubagentTraceGroup[] }) {
  if (traces.length === 0) return null;
  return (
    <div className='mt-1 space-y-1.5'>
      <p className='flex items-center gap-1.5 text-[12px] font-semibold text-xyne-fg-secondary'>
        <Workflow size={12} className='text-cyan-600 dark:text-cyan-400' />
        Subagent trace{traces.length === 1 ? '' : 's'}
      </p>
      <div>
        {traces.map(sub => (
          <DebugTimelineSection
            key={`${sub.parentToolCallId}:${sub.subagentName}`}
            title={`${sub.subagentName}: ${truncate(asString(sub.trace['question']) || 'Subagent task', 80)}`}
            data={sub.trace}
          />
        ))}
      </div>
    </div>
  );
}

function conversationPairs(
  messages: unknown[],
): Array<{ user: Record<string, unknown>; assistant?: Record<string, unknown> }> {
  const pairs: Array<{ user: Record<string, unknown>; assistant?: Record<string, unknown> }> = [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const role = asString(message['role']);
    if (role === 'user') {
      // Internal harness nudges (structured-output / verify-responses / citation
      // reflection) are delivered via session.prompt("<system>…") and land in the
      // transcript as user-role messages. They are NOT real conversation turns —
      // skip them so a post-response nudge doesn't spawn a phantom empty turn.
      if (messageText(message).trimStart().startsWith('<system>')) continue;
      pairs.push({ user: message });
    } else if (role === 'assistant' && pairs.length > 0 && !pairs[pairs.length - 1]?.assistant) {
      pairs[pairs.length - 1]!.assistant = message;
    }
  }
  return pairs;
}

function bundleContainsRun(
  bundle: DebugArtifactBundle,
  expected: { sessionId?: string; startedAt: number } | null,
): boolean {
  if (!expected) return true;
  const candidates = [bundle.debugSession, ...(bundle.runs ?? []).map(run => run.data)].filter(
    (candidate): candidate is Record<string, unknown> => Boolean(candidate),
  );
  return candidates.some(candidate => {
    if (expected.sessionId && asString(candidate['sessionId']) === expected.sessionId) return true;
    const startedAt = new Date(asString(candidate['startedAt'])).getTime();
    return Number.isFinite(startedAt) && startedAt >= expected.startedAt - 2_000;
  });
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
    const data = isRecord(event.data) ? event.data : {};
    const active = data['active'] === true;
    if (active && typeof data['streamsPerSec'] === 'number') rate += data['streamsPerSec'];
    if (typeof data['streamsCollected'] === 'number') collected += data['streamsCollected'];
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
    const events = Array.isArray(candidate['events']) ? candidate['events'] : [];
    for (const event of events) {
      if (
        !isRecord(event) ||
        asString(event['kind']) !== 'assistant_turn_end' ||
        !isRecord(event['data'])
      )
        continue;
      const at = asString(event['at']);
      if (!latest || at >= latestAt) {
        latest = event['data'];
        latestAt = at;
      }
    }
  }
  if (!latest) return null;
  const samples = streamRateSamples(latest['streamRateSamples']);
  const collected =
    typeof latest['streamsCollected'] === 'number'
      ? latest['streamsCollected']
      : (samples.at(-1)?.streamsCollected ?? 0);
  if (samples.length === 0 && collected === 0) return null;
  const rate =
    samples.length > 0
      ? samples.reduce((sum, sample) => sum + sample.streamsPerSec, 0) / samples.length
      : 0;
  return { rate, collected, live: false };
}

function FollowUpDiagnosticsSection({ diagnostic }: { diagnostic: FollowUpDiagnostic | null }) {
  if (!diagnostic) return null;
  const generated = diagnostic.persistedRecorder && diagnostic.suggestionCount === 3;
  const pending = !generated && diagnostic.outcome === 'parallel_pending';
  const intentionallyAbsent =
    diagnostic.outcome === 'disabled' || diagnostic.outcome === 'empty_answer';
  const failedToPersist = !generated && !pending && !intentionallyAbsent;
  const usedFallback = diagnostic.generationSource === 'fallback';
  return (
    <div className='space-y-2 pl-[66px] pr-2'>
      <div className='grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] leading-relaxed'>
        <span className='text-xyne-fg-muted'>V2 request flag</span>
        <span className='text-xyne-fg-secondary'>
          {diagnostic.enabledByV2Flag === undefined
            ? 'Not captured'
            : diagnostic.enabledByV2Flag
              ? 'Enabled'
              : 'Not set'}
        </span>
        <span className='text-xyne-fg-muted'>Generation outcome</span>
        <span className='font-mono text-xyne-fg-secondary'>{diagnostic.outcome}</span>
        <span className='text-xyne-fg-muted'>Generation source</span>
        <span
          className={
            usedFallback
              ? 'font-medium text-amber-700 dark:text-amber-300'
              : 'text-xyne-fg-secondary'
          }
        >
          {diagnostic.generationSource === undefined
            ? pending
              ? 'Pending'
              : 'Not captured'
            : usedFallback
              ? 'Fallback templates'
              : 'Fast model'}
        </span>
        <span className='text-xyne-fg-muted'>Generation input</span>
        <span className='text-xyne-fg-secondary'>
          {diagnostic.generationInput === 'prompt_only'
            ? 'User prompt only · parallel'
            : diagnostic.generationInput === 'conversation_history_and_prompt'
              ? `${diagnostic.conversationMessageCount ?? 0} prior messages + current prompt · parallel`
              : (diagnostic.generationInput ?? 'Not captured')}
        </span>
        <span className='text-xyne-fg-muted'>Agent grounding</span>
        <span className='text-xyne-fg-secondary'>
          {diagnostic.agentContextProvided === undefined
            ? 'Not captured'
            : diagnostic.agentContextProvided
              ? `${diagnostic.agentContextName ?? 'Selected agent'} · name + description`
              : 'Missing · domain-neutral mode'}
        </span>
        <span className='text-xyne-fg-muted'>Model</span>
        <span className='font-mono text-xyne-fg-secondary'>
          {diagnostic.generationModel ?? (pending ? 'Pending' : 'Not captured')}
        </span>
        <span className='text-xyne-fg-muted'>Generation time</span>
        <span className='text-xyne-fg-secondary'>
          {diagnostic.generationDurationMs === undefined
            ? pending
              ? 'Pending'
              : 'Not captured'
            : `${diagnostic.generationDurationMs} ms`}
        </span>
        <span className='text-xyne-fg-muted'>Answer length</span>
        <span className='text-xyne-fg-secondary'>
          {diagnostic.answerLength === undefined
            ? 'Not captured'
            : `${diagnostic.answerLength} chars`}
        </span>
        <span className='text-xyne-fg-muted'>Persisted recorder</span>
        <span className='text-xyne-fg-secondary'>
          {diagnostic.persistedRecorder ? 'Yes' : pending ? 'Pending' : 'No'}
        </span>
        <span className='text-xyne-fg-muted'>Suggestion count</span>
        <span className='text-xyne-fg-secondary'>{diagnostic.suggestionCount}</span>
      </div>
      {pending && (
        <p className='rounded bg-xyne-surface-subtle px-2 py-1.5 text-[11px] leading-relaxed text-xyne-fg-secondary'>
          Follow-up generation is still completing. This panel refreshes automatically; use Refresh
          if persistence is delayed.
        </p>
      )}
      {failedToPersist && (
        <p className='rounded bg-red-500/5 px-2 py-1.5 text-[11px] leading-relaxed text-red-700 dark:text-red-300'>
          No follow-up recorder was persisted for this response. The chips could not reach the
          completion event or conversation history.
        </p>
      )}
      {usedFallback && (
        <div className='rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200'>
          <div className='font-medium'>
            Fast-model generation failed; fallback suggestions were used.
          </div>
          <div className='mt-1 font-mono'>
            {diagnostic.failureCode ?? 'unknown_failure'}
            {diagnostic.httpStatus !== undefined ? ` · HTTP ${diagnostic.httpStatus}` : ''}
          </div>
          {diagnostic.failureMessage && <div className='mt-1'>{diagnostic.failureMessage}</div>}
        </div>
      )}
      {diagnostic.agentContextDescription && (
        <p className='rounded bg-xyne-surface-subtle px-2 py-1.5 text-[11px] leading-relaxed text-xyne-fg-secondary'>
          <span className='font-medium'>Agent description: </span>
          {diagnostic.agentContextDescription}
        </p>
      )}
      {(diagnostic.suggestions?.length ?? 0) > 0 && (
        <ol className='list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-xyne-fg-secondary'>
          {diagnostic.suggestions.map(suggestion => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

const FOLLOW_UP_DIAGNOSTIC_RETRY_DELAYS_MS = [
  500, 1_000, 2_000, 4_000, 8_000, 16_000, 32_000,
] as const;

function hasPendingFollowUpDiagnostic(
  bundle: DebugArtifactBundle | null,
  selectedSessionId: string | null,
): boolean {
  const diagnostics = bundle?.followUpDiagnostics ?? [];
  const diagnostic = selectedSessionId
    ? diagnostics.find(item => item.sessionId === selectedSessionId)
    : diagnostics[0];
  return diagnostic?.outcome === 'parallel_pending' && !diagnostic.persistedRecorder;
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
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<'delta' | 'abs'>('delta');
  const root = bundle.debugSession;
  const rootEvents = Array.isArray(root?.['events'])
    ? (root['events'] as Record<string, unknown>[])
    : (bundle.debugEvents ?? []);
  const archivedRuns = (bundle.runs ?? [])
    .slice()
    .sort((a, b) => asString(a.data['startedAt']).localeCompare(asString(b.data['startedAt'])));
  const rootSessionId = asString(root?.['sessionId']);
  const persistedRuns =
    root &&
    rootSessionId &&
    !archivedRuns.some(run => asString(run.data['sessionId']) === rootSessionId)
      ? [
          ...archivedRuns,
          {
            fileName: `active-${rootSessionId}.json`,
            data: { ...root, events: rootEvents },
          },
        ]
      : archivedRuns;
  const historicalMessages = Array.isArray(root?.['messages']) ? root['messages'] : [];
  const historicalPairs = conversationPairs(historicalMessages);
  const legacyPairs = historicalPairs.slice(
    0,
    Math.max(0, historicalPairs.length - persistedRuns.length),
  );
  const turnCount = legacyPairs.length + persistedRuns.length;
  const subagents = bundle.subagents.slice().sort((a, b) => {
    const aStarted = asString(a.data['startedAt']);
    const bStarted = asString(b.data['startedAt']);
    return aStarted.localeCompare(bStarted);
  });
  const subagentTracesBySession = new Map<string, SubagentTraceGroup[]>();
  for (const trace of groupSubagentTraces(subagents)) {
    const parentSessionId = asString(trace.trace['parentSessionId']);
    if (!parentSessionId) continue;
    const list = subagentTracesBySession.get(parentSessionId) ?? [];
    list.push(trace);
    subagentTracesBySession.set(parentSessionId, list);
  }

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between pb-1'>
        <p className='text-[13px] font-semibold text-xyne-fg-primary'>Conversation turns</p>
        <div className='flex items-center gap-2'>
          <div
            className='flex items-center gap-0.5 rounded border border-xyne-border bg-xyne-surface p-0.5'
            title='Timestamp display'
          >
            {(['delta', 'abs'] as const).map(m => (
              <button
                key={m}
                type='button'
                data-track-category='XyneAI'
                data-track-name='DEBUG_TIME_MODE'
                onClick={() => setTimeMode(m)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${timeMode === m ? 'bg-xyne-brand text-xyne-fg-inverse' : 'text-xyne-fg-muted hover:text-xyne-fg-primary'}`}
              >
                {m === 'delta' ? 'Δ' : 'abs'}
              </button>
            ))}
          </div>
          <p className='text-[11px] text-xyne-fg-muted'>
            {turnCount || historicalPairs.length} turn
            {(turnCount || historicalPairs.length) === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {legacyPairs.map((pair, index) => {
        // Hide legacy pairs entirely when a sessionId selector is active —
        // those rows pre-date the per-run files and can't be matched by sid.
        if (selectedSessionId !== null) return null;
        if (selectedTurnIndex !== null && selectedTurnIndex !== index) return null;
        const useRootTimeline = persistedRuns.length === 0 && index === legacyPairs.length - 1;
        const legacyTraces = useRootTimeline
          ? (subagentTracesBySession.get(asString(root?.['sessionId'] ?? '')) ?? [])
          : [];
        const legacyTracesByToolCallId = new Map<string, SubagentTraceGroup[]>();
        for (const trace of legacyTraces) {
          const list = legacyTracesByToolCallId.get(trace.parentToolCallId) ?? [];
          list.push(trace);
          legacyTracesByToolCallId.set(trace.parentToolCallId, list);
        }
        return (
          <DebugTimelineSection
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
            subagentTracesByParentToolCallId={legacyTracesByToolCallId}
            selectedEventKey={selectedEventKey}
            onSelectEvent={setSelectedEventKey}
            timeMode={timeMode}
          />
        );
      })}

      {persistedRuns.length > 0 ? (
        persistedRuns.map((run, index) => {
          const turnIndex = legacyPairs.length + index;
          // Branching-safe: prefer sessionId match. Chronological turn order
          // diverges from visible-path order once siblings exist.
          if (selectedSessionId !== null && asString(run.data['sessionId']) !== selectedSessionId)
            return null;
          if (
            selectedSessionId === null &&
            selectedTurnIndex !== null &&
            selectedTurnIndex !== turnIndex
          )
            return null;
          const traceGroups = subagentTracesBySession.get(asString(run.data['sessionId'])) ?? [];
          const subagentTracesByParentToolCallId = new Map<string, SubagentTraceGroup[]>();
          for (const trace of traceGroups) {
            const list = subagentTracesByParentToolCallId.get(trace.parentToolCallId) ?? [];
            list.push(trace);
            subagentTracesByParentToolCallId.set(trace.parentToolCallId, list);
          }
          const runSessionId = asString(run.data['sessionId']);
          const followUpDiagnostic = (bundle.followUpDiagnostics ?? []).find(
            diagnostic => diagnostic.sessionId === runSessionId,
          );
          return (
            <DebugTimelineSection
              key={run.fileName}
              title={`Turn ${legacyPairs.length + index + 1}: ${truncate(asString(run.data['task']) || 'User request', 90)}`}
              data={run.data}
              defaultOpen={index === persistedRuns.length - 1}
              subagentTracesByParentToolCallId={subagentTracesByParentToolCallId}
              selectedEventKey={selectedEventKey}
              onSelectEvent={setSelectedEventKey}
              timeMode={timeMode}
              {...(followUpDiagnostic ? { followUpDiagnostic } : {})}
            />
          );
        })
      ) : legacyPairs.length === 0 &&
        historicalPairs.length === 0 &&
        (selectedTurnIndex === null || selectedTurnIndex === 0) ? (
        <DebugTimelineSection
          title='Latest run'
          data={root ? { ...root, events: rootEvents } : null}
          defaultOpen
          subagentTracesByParentToolCallId={(() => {
            const traces = subagentTracesBySession.get(asString(root?.['sessionId'] ?? '')) ?? [];
            const map = new Map<string, SubagentTraceGroup[]>();
            for (const trace of traces) {
              const list = map.get(trace.parentToolCallId) ?? [];
              list.push(trace);
              map.set(trace.parentToolCallId, list);
            }
            return map;
          })()}
          selectedEventKey={selectedEventKey}
          onSelectEvent={setSelectedEventKey}
          timeMode={timeMode}
          {...(() => {
            const diagnostic = (bundle.followUpDiagnostics ?? []).find(
              item => item.sessionId === asString(root?.['sessionId']),
            );
            return diagnostic ? { followUpDiagnostic: diagnostic } : {};
          })()}
        />
      ) : null}

      {selectedTurnIndex === null &&
        subagents.filter(
          sub =>
            !persistedRuns.some(
              run => asString(run.data['sessionId']) === asString(sub.data['parentSessionId']),
            ),
        ).length > 0 && (
          <p className='border-t border-xyne-border-subtle pt-2 text-[12px] text-xyne-fg-muted'>
            Some subagent traces could not be matched to a parent turn. Open the raw run data in the
            relevant turn to inspect them.
          </p>
        )}
    </div>
  );
}

export function AskAIDebugPanel({
  open,
  agentSlug,
  conversationId,
  onClose,
  width = 460,
  minWidth,
  fill = false,
  liveEvents = [],
  running = false,
  artifactsReadyVersion = 0,
  selectedTurnIndex = null,
  selectedTurnLive: _selectedTurnLive = false,
  selectedSessionId = null,
  focusToolCallId = null,
  fetchArtifacts: fetchArtifactsOverride,
}: AskAIDebugPanelProps) {
  const isDark = useIsMidnightTheme();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bundle, setBundle] = useState<DebugArtifactBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const expectedRunRef = useRef<{ sessionId?: string; startedAt: number } | null>(null);
  const previousRunningRef = useRef(false);
  const previousArtifactsReadyVersionRef = useRef(artifactsReadyVersion);
  const followUpRefreshAttemptRef = useRef(0);
  const currentLiveStream = useMemo(() => liveStreamStatus(liveEvents), [liveEvents]);
  const savedStream = useMemo(() => persistedStreamStatus(bundle), [bundle]);
  const streamStatus =
    running && currentLiveStream ? currentLiveStream : (savedStream ?? currentLiveStream);
  const unifiedBundle = useMemo(
    () => mergeLiveDebugTimeline(bundle, liveEvents, conversationId ?? ''),
    [bundle, conversationId, liveEvents],
  );

  useEffect(() => {
    if (running && !previousRunningRef.current) {
      expectedRunRef.current = { startedAt: Date.now() };
    }
    previousRunningRef.current = running;
  }, [running]);

  useEffect(() => {
    const start = liveEvents.find(event => event.kind === 'session_start');
    if (!start) return;
    const sessionId = isRecord(start.data) ? asString(start.data['sessionId']) : '';
    const startedAt = new Date(start.at).getTime();
    expectedRunRef.current = {
      ...(sessionId ? { sessionId } : {}),
      startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    };
  }, [liveEvents]);

  useEffect(() => {
    setBundle(null);
    setError(null);
    followUpRefreshAttemptRef.current = 0;
    previousArtifactsReadyVersionRef.current = artifactsReadyVersion;
  }, [agentSlug, conversationId]);

  useEffect(() => {
    if (!open || !agentSlug || !conversationId) return;
    let cancelled = false;
    let inFlight = false;
    let pollTimer: number | undefined;
    const readinessChanged = artifactsReadyVersion !== previousArtifactsReadyVersionRef.current;
    previousArtifactsReadyVersionRef.current = artifactsReadyVersion;
    const failureState = debugArtifactFailureState({
      running,
      hasBundle: bundle !== null,
      hasLiveEvents: liveEvents.length > 0,
    });

    const fetchArtifacts = async (
      showError: boolean,
      requireCurrentRun = false,
    ): Promise<boolean> => {
      if (inFlight) return false;
      inFlight = true;
      try {
        const data = await (fetchArtifactsOverride ?? fetchV2DebugArtifacts)(
          conversationId,
          agentSlug,
        );
        if (cancelled) return false;
        setBundle(data);
        setError(null);
        if (requireCurrentRun && !bundleContainsRun(data, expectedRunRef.current)) return false;
        if (requireCurrentRun) {
          expectedRunRef.current = null;
        }
        return true;
      } catch (err) {
        if (!cancelled && showError && failureState.showError) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return false;
      } finally {
        inFlight = false;
      }
    };

    const scheduleNextPoll = (): void => {
      if (!running || liveEvents.length > 0 || cancelled) return;
      pollTimer = window.setTimeout(() => {
        if (cancelled) return;
        if (document.visibilityState === 'hidden') {
          scheduleNextPoll();
          return;
        }
        setRefreshVersion(version => version + 1);
      }, 2_500);
    };

    setLoading(!bundle && liveEvents.length === 0);
    setError(null);
    if (running && !readinessChanged) {
      void (async () => {
        const loaded = await fetchArtifacts(false);
        if (!cancelled) setLoading(loaded ? false : failureState.keepLoading);
        scheduleNextPoll();
      })();
      return () => {
        cancelled = true;
        if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      };
    }
    void (async () => {
      const requireCurrentRun = readinessChanged && expectedRunRef.current !== null;
      let loaded = false;
      const attempts = requireCurrentRun ? 3 : 1;
      for (let attempt = 0; attempt < attempts && !cancelled; attempt += 1) {
        loaded = await fetchArtifacts(false, requireCurrentRun);
        if (loaded) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!loaded && !cancelled) loaded = await fetchArtifacts(true, requireCurrentRun);
      if (!cancelled) setLoading(loaded ? false : failureState.keepLoading);
      scheduleNextPoll();
    })();

    return () => {
      cancelled = true;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [
    open,
    agentSlug,
    conversationId,
    artifactsReadyVersion,
    refreshVersion,
    fetchArtifactsOverride,
    liveEvents.length,
    running,
  ]);

  useEffect(() => {
    if (!open || !hasPendingFollowUpDiagnostic(bundle, selectedSessionId)) {
      followUpRefreshAttemptRef.current = 0;
      return;
    }
    const attempt = followUpRefreshAttemptRef.current;
    if (attempt >= FOLLOW_UP_DIAGNOSTIC_RETRY_DELAYS_MS.length) return;
    const timer = window.setTimeout(() => {
      followUpRefreshAttemptRef.current = attempt + 1;
      setRefreshVersion(version => version + 1);
    }, FOLLOW_UP_DIAGNOSTIC_RETRY_DELAYS_MS[attempt]);
    return () => window.clearTimeout(timer);
  }, [open, bundle, selectedSessionId]);

  // Focus a specific tool call: expand its event row (and every collapsed
  // <details> ancestor — turn, timeline) and scroll it into view. Driven by a
  // generic auto-citation chip click in the chat. Runs after the bundle renders.
  useEffect(() => {
    if (!open || !focusToolCallId) return;
    const root = bodyRef.current;
    if (!root) return;
    const timer = window.setTimeout(() => {
      const el = root.querySelector<HTMLDetailsElement>(
        `details[data-tool-call-id="${(window.CSS?.escape ?? ((s: string) => s))(focusToolCallId)}"]`,
      );
      if (!el) return;
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        if (node instanceof HTMLDetailsElement) node.open = true;
      }
      el.scrollIntoView({ block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, focusToolCallId, bundle]);

  if (!open) return null;

  const panel = (
    <>
      <div className='flex shrink-0 items-center gap-2 border-b border-xyne-border-subtle px-3 py-2'>
        <div className='flex h-7 w-7 items-center justify-center rounded-md bg-xyne-brand-ghost text-xyne-brand'>
          <Bug size={14} />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-[12px] font-semibold text-xyne-fg-primary'>Debugger</p>
          <p className='truncate text-[10px] text-xyne-fg-muted'>
            {selectedSessionId
              ? `Run ${selectedSessionId.slice(0, 8)}`
              : selectedTurnIndex !== null
                ? `Turn ${selectedTurnIndex + 1}`
                : agentSlug}{' '}
            {conversationId ? `· ${conversationId}` : ''}
          </p>
        </div>
        <button
          type='button'
          data-track-category='XyneAI'
          data-track-name='DEBUG_PANEL_REFRESH'
          onClick={() => {
            if (!conversationId) return;
            setRefreshVersion(version => version + 1);
          }}
          disabled={!conversationId || loading}
          className='inline-flex items-center gap-1 rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle px-2 py-1 text-[10px] font-medium text-xyne-fg-secondary transition hover:border-xyne-border hover:bg-xyne-surface disabled:cursor-not-allowed disabled:opacity-50'
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <button
          type='button'
          data-track-category='XyneAI'
          data-track-name='DEBUG_PANEL_CLOSE'
          onClick={onClose}
          className='flex h-7 w-7 items-center justify-center rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle text-xyne-fg-secondary transition hover:border-xyne-border hover:bg-xyne-surface hover:text-xyne-fg-primary'
          aria-label='Close debugger'
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

      <div ref={bodyRef} className='min-h-0 flex-1 overflow-y-auto p-2.5'>
        {!conversationId ? (
          running && liveEvents.length > 0 ? (
            <div className='space-y-4'>
              <DebugTimelineSection
                title='Live run · waiting for conversation id'
                data={unifiedBundle?.debugSession ?? null}
                defaultOpen
              />
              <p className='border-t border-xyne-border-subtle pt-3 text-[12px] text-xyne-fg-muted'>
                The conversation record will appear here once the backend assigns an id.
              </p>
            </div>
          ) : (
            <p className='py-6 text-[13px] text-xyne-fg-muted'>
              Open a conversation to inspect its runtime trace.
            </p>
          )
        ) : loading && !unifiedBundle ? (
          <div className='space-y-3'>
            {running && (
              <p className='text-[12px] text-xyne-fg-muted'>Waiting for debug artifacts…</p>
            )}
            <div className='h-24 animate-pulse rounded-md bg-xyne-surface-subtle' />
            <div className='h-72 animate-pulse rounded-md bg-xyne-surface-subtle' />
          </div>
        ) : error && !unifiedBundle ? (
          <p className='py-4 text-[13px] text-red-700 dark:text-red-300'>{error}</p>
        ) : (
          <div>
            <div
              className={`transition-all duration-300 ease-out ${unifiedBundle ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'}`}
            >
              {unifiedBundle ? (
                <DebugSessionBody
                  bundle={unifiedBundle}
                  selectedTurnIndex={selectedTurnIndex}
                  selectedSessionId={selectedSessionId}
                />
              ) : (
                <p className='py-6 text-[13px] text-xyne-fg-muted'>
                  No debugger artifacts found for this conversation.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );

  // The dashboard always embeds the panel inline (a fixed side column); there is
  // no modal-overlay caller, so we render the inline container unconditionally.
  return (
    <div
      className={`${isDark ? 'dark ' : ''}flex h-full min-h-0 shrink-0 flex-col border-l border-xyne-border-subtle bg-xyne-surface shadow-2xl`}
      style={{ width: fill ? '100%' : width, minWidth: fill ? 0 : (minWidth ?? width) }}
    >
      {panel}
    </div>
  );
}
