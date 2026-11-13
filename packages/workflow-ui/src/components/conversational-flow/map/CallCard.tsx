/**
 * Something the conversation fetches, drawn in front of what it feeds.
 *
 * Nobody is asked anything here — it is a pass-through — so the card is small
 * and says only what matters: what it is called, and where it goes. It is a node
 * and not a note on a screen because the author needs to see that the call
 * happens, and to configure it where they see it.
 */
import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Database, TriangleAlert } from 'lucide-react';
import { cn } from '../../shared/cn.js';
import type { Call, CallScope } from '@xyne/workflow-sdk/conversational-flow';
import type { CardBox, MapDirection } from './layout.js';

export interface CallNodeData extends Record<string, unknown> {
  call: Call;
  /** The screen it runs in front of. */
  owner: string;
  box: CardBox;
  direction: MapDirection;
  selected: boolean;
  onPath: boolean;
  /** Ran in the current Test run. */
  visited: boolean;
  onSelect: (id: string) => void;
}

export type CallNode = Node<CallNodeData, 'call'>;

const handleStyle = { width: 8, height: 8, border: '2px solid var(--wui-surface, #fff)' };

/** How long the answer lasts, said the way an author thinks about it. */
const SCOPE: Record<CallScope, string> = {
  conversation: 'once per conversation',
  section: 'on the way into this section',
  screen: 'every time this screen opens',
};

function CallCardImpl({ data }: NodeProps<CallNode>) {
  const { call, box, direction, selected, onPath, visited } = data;
  const down = direction === 'down';
  const accent = 'var(--wui-cf-data, var(--wui-primary))';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Lookup: ${call.title}`}
      title={`${call.method} ${call.url} — ${SCOPE[call.scope]}`}
      onClick={() => data.onSelect(call.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          data.onSelect(call.id);
        }
      }}
      style={{
        width: box.w,
        height: box.h,
        borderColor: selected ? accent : 'color-mix(in srgb, ' + accent + ' 40%, var(--wui-border))',
        boxShadow: selected
          ? `0 0 0 1px ${accent}, 0 0 0 5px color-mix(in srgb, ${accent} 16%, transparent)`
          : onPath
            ? 'var(--wui-shadow-md)'
            : 'var(--wui-shadow)',
        background: visited
          ? `color-mix(in srgb, ${accent} 7%, var(--wui-surface, var(--wui-bg)))`
          : 'var(--wui-surface, var(--wui-bg))',
      }}
      className={cn(
        'flex cursor-pointer flex-col justify-center gap-0.5 rounded-[12px] border border-dashed px-3 text-left transition-shadow',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wui-primary)]',
      )}
    >
      {/* Anchors for the lines in and out, styled like a screen's: the dot the
          line arrives at, and invisible ones it leaves from. */}
      {down ? (
        <Handle type="target" position={Position.Top} style={{ ...handleStyle, top: -4, background: 'var(--wui-border-strong)' }} isConnectable={false} />
      ) : (
        <Handle type="target" position={Position.Left} style={{ ...handleStyle, left: -4, background: 'var(--wui-border-strong)' }} isConnectable={false} />
      )}
      <span className="flex items-center gap-1.5">
        <Database className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} aria-hidden />
        <span className="truncate text-[13px] font-semibold text-[var(--wui-fg)]">{call.title}</span>
        {call.onFail === undefined && (
          <TriangleAlert
            className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--wui-status-failed)]"
            aria-label="Nothing is said if this cannot be reached"
          />
        )}
      </span>
      <span className="truncate font-mono text-[11px] text-[var(--wui-fg-muted)]">
        {call.method} {call.url}
      </span>
      {down ? (
        <Handle
          id="bottom"
          type="source"
          position={Position.Bottom}
          style={{ ...handleStyle, bottom: -4, background: 'var(--wui-primary)' }}
          isConnectable={false}
        />
      ) : (
        <Handle id="card" type="source" position={Position.Right} style={{ ...handleStyle, right: -4, opacity: 0 }} isConnectable={false} />
      )}
    </div>
  );
}

export const CallCard = memo(CallCardImpl);
