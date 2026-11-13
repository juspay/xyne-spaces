/**
 * Test: talk to the flow as the person on the other side would, through the
 * Conversation API — the same calls an app makes. The map lights the path the
 * conversation took; "What happened" says why; "API" shows every request and
 * response, and how to make them yourself.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, Loader2, Play, RotateCcw, Square } from 'lucide-react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import {
  ancestorsOf,
  childrenOf,
  type ConversationalFlow,
  readConversationalFlow,
  type TurnEvent,
} from '@xyne/workflow-sdk/conversational-flow';
import { cn } from '../../shared/cn.js';
import { useWorkflowClient } from '../../../hooks/use-workflow-client.js';
import { FlowMap } from '../map/FlowMap.js';
import { Button, KindTag } from '../ui.js';
import { ResizeHandle, usePanelWidth } from '../panel.js';
import { useConversation, type ConversationRun, type Exchange } from './useConversation.js';
import { PreviewChat, PreviewPicker, usePreview, type PreviewId } from './previews/index.js';

export interface ConversationalFlowTestProps {
  workflowId: string | undefined;
  config: WorkflowConfig | undefined;
  /** Unsaved changes in Build aren't what runs; say so. */
  unsaved?: boolean | undefined;
}

export function ConversationalFlowTest({ workflowId, config, unsaved }: ConversationalFlowTestProps) {
  const flow = useMemo(() => (config ? readConversationalFlow(config) : null), [config]);
  const run = useConversation(workflowId);
  const visitedKey = run.visited.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids, not the array
  const visited = useMemo(() => new Set(run.visited), [visitedKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids, not the array
  const folded = useMemo(() => foldsFor(flow, run.visited), [flow, visitedKey]);
  const current = run.turn?.screen?.id ?? null;
  const [focus, setFocus] = useState<{ id: string; n: number }>();
  // A flow that declared what it starts with asks for it before running.
  const [asking, setAsking] = useState(false);
  const [preview, setPreview] = usePreview();
  useEffect(() => {
    if (current) setFocus((f) => ({ id: current, n: (f?.n ?? 0) + 1 }));
  }, [current]);

  if (!flow) {
    return <div className="grid h-full place-items-center text-[13px] text-[var(--wui-fg-muted)]" data-workflow-ui="">This workflow isn’t laid out as a conversation.</div>;
  }

  const running = run.state === 'starting' || run.state === 'waiting' || run.state === 'thinking';

  return (
    <div className="flex h-full flex-col bg-[var(--wui-bg)]" data-workflow-ui="">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--wui-border)] px-4">
        <p className="text-[12.5px] text-[var(--wui-fg-muted)]">
          {unsaved
            ? 'Tests run the saved flow — save your changes in Build to test them.'
            : 'Runs the real flow through the Conversation API — the same calls your app makes.'}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <PreviewPicker value={preview} onChange={setPreview} />
          {running ? (
            <Button variant="secondary" onClick={() => void run.end()}>
              <Square className="h-3.5 w-3.5" /> End test
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => (flow.inputs.length > 0 ? setAsking(true) : void run.start())}
              disabled={!workflowId}
            >
              {run.state === 'idle' ? <Play className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {run.state === 'idle' ? 'Start a test conversation' : 'Start again'}
            </Button>
          )}
        </div>
      </div>

      {asking && (
        <StartWith
          flow={flow}
          onCancel={() => setAsking(false)}
          onStart={(context) => {
            setAsking(false);
            void run.start(context);
          }}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <Chat run={run} preview={preview} />
        <div className="min-w-0 flex-1 border-x border-[var(--wui-border)]">
          <FlowMap
            flow={flow}
            folded={folded}
            selected={current}
            visited={visited}
            canEdit={false}
            focus={focus}
            onSelect={() => {}}
            onToggleFold={() => {}}
            onFoldAll={() => {}}
            onUnfoldAll={() => {}}
            onAdd={() => undefined}
            onDuplicate={() => undefined}
            onSelectRouter={() => {}}
          />
        </div>
        <SidePanel run={run} flow={flow} workflowId={workflowId} />
      </div>
    </div>
  );
}

/** Keep the map compact, but open every branch the conversation went down. */
function foldsFor(flow: ConversationalFlow | null, visited: string[]): Set<string> {
  if (!flow) return new Set();
  const kids = childrenOf(flow);
  const open = new Set(visited.flatMap((id) => [id, ...ancestorsOf(flow, id)]));
  return new Set(flow.screens.filter((s) => s.depth >= 1 && (kids.get(s.id)?.length ?? 0) > 0 && !open.has(s.id)).map((s) => s.id));
}

// ─── Chat ───

function Chat({ run, preview }: { run: ConversationRun; preview: PreviewId }) {
  const panel = usePanelWidth('test-chat', { initial: 440, min: 360, max: 680 });
  return (
    <section
      aria-label="Test conversation"
      className="relative flex shrink-0 flex-col bg-[var(--wui-bg-subtle)]"
      style={{ width: panel.width, maxWidth: '45%' }}
    >
      <ResizeHandle panel={panel} edge="right" label="Resize the conversation" />
      <PreviewChat run={run} preview={preview} />
    </section>
  );
}

// ─── What happened / API ───

type Tab = 'trace' | 'api';

function SidePanel({ run, flow, workflowId }: { run: ConversationRun; flow: ConversationalFlow; workflowId: string | undefined }) {
  const [tab, setTab] = useState<Tab>('trace');
  const panel = usePanelWidth('test-trace', { initial: 380, min: 300, max: 720 });
  const tabs: Array<[Tab, string]> = [
    ['trace', 'What happened'],
    ['api', 'API'],
  ];
  return (
    <aside
      aria-label={tab === 'trace' ? 'What happened' : 'API'}
      className="relative flex shrink-0 flex-col bg-[var(--wui-surface,var(--wui-bg))]"
      style={{ width: panel.width, maxWidth: '40%' }}
    >
      <ResizeHandle panel={panel} edge="left" label="Resize the side panel" />
      <div role="tablist" aria-label="Test details" className="flex items-end gap-4 border-b border-[var(--wui-border)] px-4">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors',
              tab === key ? 'border-[var(--wui-primary)] text-[var(--wui-fg)]' : 'border-transparent text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
            )}
          >
            {label}
            {key === 'api' && run.exchanges.length > 0 && <span className="ml-1.5 tabular-nums text-[var(--wui-fg-muted)]">{run.exchanges.length}</span>}
          </button>
        ))}
      </div>
      {tab === 'trace' ? <Trace run={run} flow={flow} /> : <Api run={run} flow={flow} workflowId={workflowId} />}
      {run.error && <p role="alert" className="border-t border-[var(--wui-border)] px-4 py-2 text-[12.5px] text-[var(--wui-status-failed)]">{run.error}</p>}
    </aside>
  );
}

function describe(event: TurnEvent, flow: ConversationalFlow): string {
  switch (event.type) {
    case 'tapped':
      return `Tapped “${event.label}”`;
    case 'typed':
      return `Typed “${event.text}”`;
    case 'routed': {
      // The event names the router that chose; a flow may have one per section.
      // The router is named as the map names it; `routerName` is for choosing
      // between them, not for a sentence.
      const who = event.by ?? flow.screens.find((s) => s.router)?.title ?? 'The router';
      return `${who} chose ${event.title ?? flow.screens.find((s) => s.id === event.to)?.title ?? event.to ?? 'no screen'}`;
    }
    case 'looked_up':
      return event.ok
        ? `Looked up ${event.name}${event.ms === undefined ? '' : ` in ${String(event.ms)}ms`}`
        : `${event.name} could not be reached${event.status === undefined ? '' : ` (${String(event.status)})`}`;
    case 'handed_back':
      return flow.screens.find((s) => s.id === event.to)?.kind === 'end'
        ? `The person closed it at ${event.title ?? event.to}`
        : `The person handed it back to ${event.title ?? event.to}`;
    case 'answered':
      // What they gave, as the author named it — a file by its name, never by
      // the handle, which is what the event carries.
      return `Gave ${event.fields
        .map((field) => `${field.label ?? field.name}: ${said(field.value)}`)
        .join(' · ')}`;
  }
}

/** One answer, as a line of a trace reads it. */
function said(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(said).join(', ');
  if (value !== null && typeof value === 'object') {
    const name = (value as Record<string, unknown>)['name'];
    return typeof name === 'string' ? name : JSON.stringify(value);
  }
  return String(value);
}

function Events({ events, flow }: { events: TurnEvent[]; flow: ConversationalFlow }) {
  return (
    <>
      {events.map((e, j) => (
        <div key={j} className="flex flex-col gap-1">
          <p className="text-[12.5px] text-[var(--wui-fg-muted)]">{describe(e, flow)}</p>
          {e.type === 'routed' && e.reason && (
            <blockquote
              className="rounded-r-[var(--wui-radius-sm)] border-l-2 py-1 pl-2.5 pr-2 text-[12.5px] leading-relaxed text-[var(--wui-fg)]"
              style={{ borderColor: 'var(--wui-cf-ai)', background: 'color-mix(in srgb, var(--wui-cf-ai) 7%, transparent)' }}
            >
              “{e.reason}”
            </blockquote>
          )}
        </div>
      ))}
    </>
  );
}

function Step({ n, last, title, tag, children }: { n: number; last: boolean; title: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-4">
      <div className="flex flex-col items-center">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--wui-bg-muted)] text-[11px] font-semibold tabular-nums text-[var(--wui-fg)]">{n}</span>
        {!last && <span className="mt-1 w-px flex-1 bg-[var(--wui-border)]" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold">{title}</span>
          {tag}
        </div>
        {children}
      </div>
    </li>
  );
}

function Trace({ run, flow }: { run: ConversationRun; flow: ConversationalFlow }) {
  const count = run.trace.length + (run.closing ? 1 : 0);
  return (
    <ol className="flex-1 overflow-y-auto px-4 py-3" aria-label="Screens reached">
      {count === 0 && (
        <li className="text-[12.5px] text-[var(--wui-fg-muted)]">
          Each screen the conversation reaches appears here, with what they did and why the flow went where it did.
        </li>
      )}
      {run.trace.map((step, i) => (
        <Step key={step.turnId} n={i + 1} last={i === count - 1} title={step.screen?.title ?? 'A question'} tag={step.screen && <KindTag kind={step.screen.kind} />}>
          {step.events.length === 0 && i === 0 && <p className="text-[12.5px] text-[var(--wui-fg-muted)]">Where the conversation starts</p>}
          <Events events={step.events} flow={flow} />
        </Step>
      ))}
      {run.closing && (
        <Step n={count} last title={run.state === 'failed' ? 'Failed' : 'Finished'}>
          <Events events={run.closing.events} flow={flow} />
          {run.closing.outcome && Object.keys(run.closing.outcome).length > 0 && (
            <p className="font-mono text-[11.5px] text-[var(--wui-fg)]">
              {Object.entries(run.closing.outcome).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}
            </p>
          )}
        </Step>
      )}
      {run.state === 'thinking' && (
        <li className="flex items-center gap-2 pl-9 text-[12px] text-[var(--wui-fg-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {run.live?.status ?? 'Working…'}
        </li>
      )}
    </ol>
  );
}

function Api({ run, flow, workflowId }: { run: ConversationRun; flow: ConversationalFlow; workflowId: string | undefined }) {
  const client = useWorkflowClient();
  const base = absolute(client.baseUrl).replace(/\/$/, '');
  const turn = run.turn;
  const wf = workflowId ?? '<workflowId>';
  const conversationId = turn?.conversationId ?? '<conversationId>';
  const turnId = turn?.turnId ?? '<turnId>';
  const option = turn?.reply?.options[0]?.id ?? '<option id>';
  // What the flow says it is started with, so the snippet is the call to make
  // rather than a call to adapt.
  const context = Object.fromEntries(flow.inputs.map((i) => [i.path, `<${i.path}>`]));
  const started = { workflowId: wf, ...(flow.inputs.length > 0 ? { context } : {}), stream: true };
  const answered = { conversationId, turnId, choice: option, stream: true };

  const curl = [
    '# Start a conversation. Streaming, so the reply arrives as it is written',
    `curl -N -X POST '${base}/conversations' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${JSON.stringify(started)}'`,
    '',
    '# Answer the turn you were given: tap an option, or send text',
    `curl -N -X POST '${base}/conversations' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${JSON.stringify(answered)}'`,
    '',
    '# Pick the thread back up after a reload',
    `curl -N '${base}/conversations/${conversationId}?stream=1'`,
  ].join('\n');

  const ts = [
    '// Starting and answering are the same call, and its stream is what happened.',
    `for await (const event of client.conversations.advance(${JSON.stringify(started, null, 2).replace(/\n/g, '\n')})) {`,
    "  if (event.type === 'turn')    render(event.turn);       // messages · reply.options · reply.text.allowed",
    "  if (event.type === 'working') showStatus(event.kind);   // 'router' · 'agent' · 'step'",
    "  if (event.type === 'text')    appendTyping(event.delta); // a preview; the next turn has the full message",
    "  if (event.type === 'error')   showError(event);          // after 200, a failure says so here",
    '}',
    '// The stream closed, so it is their move.',
    '',
    '// When they answer — the same call, the same loop:',
    'await client.conversations.advance({',
    '  conversationId: turn.conversationId,',
    '  turnId: turn.turnId!,',
    `  choice: turn.reply!.options[0]!.id, // or text: 'I was charged twice'`,
    '  stream: true,',
    '});',
  ].join('\n');

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
      <section className="space-y-2">
        <p className="text-[12.5px] leading-relaxed text-[var(--wui-fg-muted)]">
          Every call Test makes, as your app would make it. Here they use your signed-in session.
        </p>
        <Snippet label="curl" code={curl} />
        <Snippet label="TypeScript" code={ts} />
      </section>
      <section aria-label="Calls" className="space-y-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--wui-fg-muted)]">Calls</h3>
        {run.exchanges.length === 0 && <p className="text-[12.5px] text-[var(--wui-fg-muted)]">Start a test conversation to see its calls.</p>}
        {run.exchanges.map((x, i) => (
          <ExchangeRow key={x.id} exchange={x} open={i === run.exchanges.length - 1} />
        ))}
      </section>
    </div>
  );
}

/** A host may give the client a path (`/api/…`); a snippet to paste elsewhere needs the full address. */
function absolute(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

function ExchangeRow({ exchange: x, open }: { exchange: Exchange; open: boolean }) {
  const ok = x.status !== undefined && x.status < 300;
  return (
    <details open={open} className="rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)]">
      <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 font-mono text-[11.5px]">
        <span className="font-semibold text-[var(--wui-fg)]">{x.method}</span>
        <span className="min-w-0 flex-1 truncate text-[var(--wui-fg-muted)]">{x.path}</span>
        {x.status === undefined ? (
          <Loader2 className="h-3 w-3 animate-spin text-[var(--wui-fg-muted)]" aria-label="Waiting for the response" />
        ) : (
          <span className="tabular-nums" style={{ color: ok ? 'var(--wui-status-completed)' : 'var(--wui-status-failed)' }}>
            {x.status}
          </span>
        )}
        {x.ms !== undefined && <span className="tabular-nums text-[var(--wui-fg-muted)]">{x.ms < 1000 ? `${x.ms} ms` : `${(x.ms / 1000).toFixed(1)} s`}</span>}
      </summary>
      <div className="space-y-2 border-t border-[var(--wui-border)] p-2.5">
        {x.body !== undefined && <Json label="Request" value={x.body} />}
        {x.response !== undefined && <Json label={x.stream ? `Events (${(x.response as unknown[]).length})` : 'Response'} value={x.response} />}
      </div>
    </details>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--wui-fg-muted)]">{label}</p>
      <pre className="max-h-72 overflow-auto rounded-[var(--wui-radius-sm)] bg-[var(--wui-bg-subtle)] p-2 font-mono text-[11px] leading-relaxed text-[var(--wui-fg)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the text is still selectable.
    }
  };
  return (
    <div className="overflow-hidden rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)]">
      <div className="flex items-center justify-between border-b border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-2.5 py-1">
        <span className="text-[11px] font-medium text-[var(--wui-fg-muted)]">{label}</span>
        <button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`} className="flex items-center gap-1 text-[11px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-2.5 font-mono text-[11px] leading-relaxed text-[var(--wui-fg)]">{code}</pre>
    </div>
  );
}

/**
 * What the conversation is started with, asked for before a test.
 *
 * A flow that quotes `{{trigger.context.orderId}}` needs one to run properly, so
 * the test asks for exactly what the flow declared — no more, and nothing to
 * remember.
 */
function StartWith({
  flow,
  onStart,
  onCancel,
}: {
  flow: ConversationalFlow;
  onStart: (context: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const uid = useId();

  return (
    <div className="flex flex-col gap-2 border-b border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-4 py-3">
      <p className="text-[12px] text-[var(--wui-fg-muted)]">Start it with</p>
      <div className="flex flex-wrap gap-3">
        {flow.inputs.map((input) => (
          <label key={input.path} className="flex items-center gap-1.5 text-[12.5px]">
            <span className="font-mono text-[11.5px] text-[var(--wui-fg-muted)]">{input.path}</span>
            <input
              id={`${uid}-${input.path}`}
              value={values[input.path] ?? ''}
              onChange={(e) => setValues({ ...values, [input.path]: e.target.value })}
              className="w-40 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1 text-[12.5px] text-[var(--wui-fg)]"
            />
          </label>
        ))}
        <Button variant="primary" onClick={() => onStart(nest(values))}>Start</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** `customer.tier` typed in a flat form becomes `{ customer: { tier } }` on the way out. */
function nest(values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(values)) {
    if (value === '') continue;
    const parts = path.split('.');
    let node = out;
    parts.forEach((part, at) => {
      if (at === parts.length - 1) node[part] = value;
      else {
        node[part] = (node[part] as Record<string, unknown>) ?? {};
        node = node[part] as Record<string, unknown>;
      }
    });
  }
  return out;
}
