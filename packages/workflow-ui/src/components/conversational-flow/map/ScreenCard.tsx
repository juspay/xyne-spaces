/**
 * One screen on the map. Its section heights come from the same `CARD` metrics
 * the layout uses, so what is drawn is exactly what was laid out.
 *
 * Read left→right, lines leave from option rows (one handle per forward
 * option); read top→bottom, they leave from the card's foot and its children
 * sit in the order the options are listed. The way back,
 * "That's all → end" and jumps across the tree are written on the card instead
 * of drawn, which is what keeps a 37-screen map readable.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { ChevronDown, ChevronRight, Copy, CopyPlus, Plus } from 'lucide-react';
import { cn } from '../../shared/cn.js';
import { optionsOf, saysOf, type Screen } from '@xyne/workflow-sdk/conversational-flow';
import { sayPlainly } from '../computation.js';
import { said } from '../conditions.js';
import { CARD, forwardRows, type CardBox, type MapDirection } from './layout.js';
import { KIND } from '../ui.js';

export interface ScreenNodeData extends Record<string, unknown> {
  screen: Screen;
  /** The router of the section this screen keeps typing inside, when it has one. */
  keepsTyping: string | undefined;
  box: CardBox;
  direction: MapDirection;
  isRoot: boolean;
  selected: boolean;
  onPath: boolean;
  /** Visited in the current Test run. */
  visited: boolean;
  folded: boolean;
  childCount: number;
  titleOf: (id: string) => string;
  endIds: ReadonlySet<string>;
  childIds: ReadonlySet<string>;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onToggleFold: (id: string) => void;
  onAddChild: (id: string) => void;
  onDuplicate: (id: string, as: 'sibling' | 'child') => void;
}

export type ScreenNode = Node<ScreenNodeData, 'screen'>;

const handleStyle = { width: 8, height: 8, border: '2px solid var(--wui-surface, #fff)' };

const SELECTED = {
  borderColor: 'var(--wui-primary)',
  boxShadow: '0 0 0 1px var(--wui-primary), 0 0 0 5px color-mix(in srgb, var(--wui-primary) 16%, transparent), 0 10px 28px -10px rgba(15,23,42,0.3)',
};
const ON_PATH = {
  borderColor: 'color-mix(in srgb, var(--wui-primary) 45%, var(--wui-border))',
  boxShadow: 'var(--wui-shadow-md)',
};

function ScreenCardImpl({ data }: NodeProps<ScreenNode>) {
  const { screen, box, direction, isRoot, selected, onPath, visited, folded, childCount, titleOf, endIds, childIds, keepsTyping } = data;
  const meta = KIND[screen.kind];
  // Every way a hand off says things offers the same places, so each is listed once.
  const back = optionsOf(screen).filter((o, at, all) => o.back && all.findIndex((x) => x.back && x.value === o.value) === at);
  const rows = forwardRows(screen);
  // A Message answers and sends people back; only a Menu has room beneath it.
  const canHaveChildren = screen.kind === 'menu';
  const message =
    screen.kind === 'ask-ai'
      ? screen.askAi?.intro
      : screen.kind === 'handoff'
        ? undefined
        : screen.kind === 'end'
          ? screen.endMessage
          : // The card shows one line of preview; a screen that says several
            // things is previewed by what it opens with.
            saysOf(screen)[0];
  /**
   * The preview, with any worked-out value named rather than spelled out — the
   * card has less room for JSONata than the box did.
   *
   * `isList` answers "no" because a card has no value list to consult. It only
   * changes what a *call* is called — "sum of amount" rather than "sum of
   * fareBreakup" — and nothing about the list shape, which is the long one.
   */
  const preview = message === undefined ? undefined : sayPlainly(message, () => false);
  const down = direction === 'down';

  // One "Duplicate" control that opens a small menu: as a sibling (beside the
  // screen) or as a child (beneath it, only where a screen can hold children).
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e: MouseEvent): void => {
      // composedPath avoids the DOM `Node` type, which @xyflow/react's `Node` shadows here.
      if (menuRef.current && !e.composedPath().includes(menuRef.current)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);
  const canSibling = data.canEdit && !isRoot && screen.kind !== 'router';
  const canChild = data.canEdit && canHaveChildren && screen.kind !== 'router';

  return (
    <div
      className={cn(
        'group relative box-border flex flex-col overflow-visible rounded-[12px] border bg-[var(--wui-surface,var(--wui-bg))] text-[var(--wui-fg)] transition-shadow',
        screen.kind === 'end' || screen.kind === 'handoff' || screen.kind === 'custom' ? 'border-dashed' : '',
        !selected && !onPath && 'border-[var(--wui-border)] shadow-[var(--wui-shadow)] hover:shadow-[var(--wui-shadow-md)]',
      )}
      // Selection is set inline: a host whose unlayered Tailwind base re-declares
      // the --tw-* variables flattens the shadow utilities, and the ring with them.
      style={{ width: box.w, height: box.h, ...(selected ? SELECTED : onPath ? ON_PATH : {}) }}
    >
      {down ? (
        <Handle type="target" position={Position.Top} style={{ ...handleStyle, top: -4, background: 'var(--wui-border-strong)' }} isConnectable={false} />
      ) : (
        <Handle type="target" position={Position.Left} style={{ ...handleStyle, left: -4, top: CARD.header / 2, background: 'var(--wui-border-strong)' }} isConnectable={false} />
      )}

      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--wui-border)] px-3" style={{ height: CARD.header }}>
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}>
          <meta.Icon className="h-3 w-3" strokeWidth={2.4} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{screen.title}</span>
        {isRoot && <span className="shrink-0 rounded-full bg-[var(--wui-fg)] px-1.5 py-px text-[10px] font-semibold text-[var(--wui-bg)]">Start</span>}
        {screen.versions.length > 1 && (
          <span
            title="This screen asks differently depending on the data"
            className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium"
            style={{ background: 'color-mix(in srgb, var(--wui-cf-data, var(--wui-primary)) 14%, transparent)', color: 'var(--wui-cf-data, var(--wui-primary))' }}
          >
            {screen.versions.length} versions
          </span>
        )}
        {keepsTyping && (
          <button
            type="button"
            title="Typed messages here only open screens in this section — open its router"
            onClick={(e) => {
              e.stopPropagation();
              data.onSelect(keepsTyping);
            }}
            className="nodrag shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium"
            style={{ background: 'color-mix(in srgb, var(--wui-cf-ai) 14%, transparent)', color: 'var(--wui-cf-ai)' }}
          >
            Typing stays here
          </button>
        )}
        {visited && !isRoot && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--wui-status-completed)]" title="Visited in the test run" />}
        {childCount > 0 && !folded && (
          <button
            type="button"
            aria-label={`Fold ${screen.title}`}
            title="Fold what’s beneath"
            onClick={(e) => {
              e.stopPropagation();
              data.onToggleFold(screen.id);
            }}
            className="nodrag grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--wui-fg-muted)] opacity-0 transition-opacity hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)] group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
        {(canSibling || canChild) && (
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              aria-label={`Duplicate ${screen.title}`}
              title="Duplicate this screen"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
              className={cn(
                'nodrag grid h-5 w-5 place-items-center rounded text-[var(--wui-fg-muted)] transition-opacity hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)] focus-visible:opacity-100',
                menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
            >
              <Copy className="h-3 w-3" strokeWidth={2.4} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="nodrag absolute right-0 top-full z-50 mt-1 min-w-[168px] overflow-hidden rounded-lg border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] py-1 text-[var(--wui-fg)] shadow-[var(--wui-shadow-md)]"
                onClick={(e) => e.stopPropagation()}
              >
                {canSibling && (
                  <button
                    role="menuitem"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      data.onDuplicate(screen.id, 'sibling');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--wui-bg-muted)]"
                  >
                    <Copy className="h-3.5 w-3.5 shrink-0 text-[var(--wui-fg-muted)]" strokeWidth={2.2} />
                    Duplicate as sibling
                  </button>
                )}
                {canChild && (
                  <button
                    role="menuitem"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      data.onDuplicate(screen.id, 'child');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--wui-bg-muted)]"
                  >
                    <CopyPlus className="h-3.5 w-3.5 shrink-0 text-[var(--wui-fg-muted)]" strokeWidth={2.2} />
                    Duplicate as child
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {data.canEdit && (
          <button
            type="button"
            aria-label={`Add to ${screen.title}`}
            title={canHaveChildren ? 'Add a screen, or something to look up' : 'Add something to look up before this screen'}
            onClick={(e) => {
              e.stopPropagation();
              data.onAddChild(screen.id);
            }}
            className={cn(
              'nodrag grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--wui-fg-muted)] transition-opacity',
              'hover:bg-[var(--wui-primary)] hover:text-[var(--wui-primary-fg)] group-hover:opacity-100 focus-visible:opacity-100',
              selected ? 'opacity-100' : 'opacity-0',
            )}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
          </button>
        )}
      </div>

      {/* What the assistant says */}
      {message !== undefined && (
        <div className="shrink-0 px-3 py-2 text-[12px] leading-[1.45] text-[var(--wui-fg-muted)]" style={{ height: CARD.message }}>
          <p className="line-clamp-2">{preview || <span className="italic opacity-70">No message yet</span>}</p>
        </div>
      )}

      {/* Options that lead somewhere */}
      {rows.map((row) => {
        const opt = screen.prompts[0]?.options.find((_, idx) => `${screen.prompts[0]!.id}:${idx}` === row.handle);
        let hint: string | undefined;
        if (row.to && endIds.has(row.to)) hint = 'Finishes';
        else if (row.to && !childIds.has(row.to)) hint = `→ ${titleOf(row.to)}`;
        return (
          <div key={row.handle} className="relative flex shrink-0 items-center gap-2 border-t border-[var(--wui-border)] px-3 text-[12.5px]" style={{ height: CARD.row }}>
            {/* Offered only sometimes — the map would be lying if it drew this
                line the same as one everybody sees. */}
            {opt?.when !== undefined && (
              <span
                title={`Only when ${said(opt.when)}`}
                aria-label={`Only when ${said(opt.when)}`}
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: 'var(--wui-cf-data)' }}
              />
            )}
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            {hint && <span className="max-w-[45%] shrink-0 truncate text-[11px] text-[var(--wui-fg-muted)]">{hint}</span>}
            {!down && (
              <Handle
                type="source"
                id={row.handle}
                position={Position.Right}
                isConnectable={false}
                style={{ ...handleStyle, right: -4, top: CARD.row / 2, background: row.to && childIds.has(row.to) ? 'var(--wui-primary)' : 'var(--wui-border-strong)' }}
              />
            )}
          </div>
        );
      })}

      {screen.kind === 'ask-ai' && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-[var(--wui-border)] px-3 text-[12px]" style={{ height: CARD.row }}>
          <span className="text-[var(--wui-fg-muted)]">Agent</span>
          <span className="truncate font-mono text-[11.5px]">{screen.askAi?.agent || 'not set'}</span>
        </div>
      )}
      {screen.kind === 'end' && (
        <div className="flex shrink-0 items-center border-t border-[var(--wui-border)] px-3 font-mono text-[11.5px] text-[var(--wui-fg-muted)]" style={{ height: CARD.row }}>
          <span className="truncate">
            {Object.entries(screen.endValue ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || 'no result'}
          </span>
        </div>
      )}
      {screen.kind === 'handoff' && (
        <div className="flex shrink-0 items-center border-t border-[var(--wui-border)] px-3 text-[12px] text-[var(--wui-fg-muted)]" style={{ height: CARD.row }}>
          A person has it, then closes or sends it back
        </div>
      )}
      {(screen.kind === 'custom' || screen.kind === 'router') && (
        <div className="flex shrink-0 items-center border-t border-[var(--wui-border)] px-3 text-[12px] text-[var(--wui-fg-muted)]" style={{ height: CARD.row }}>
          Edited as steps
        </div>
      )}

      {/* The way back, written rather than drawn */}
      {back.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-hidden border-t border-[var(--wui-border)] px-3" style={{ height: CARD.chips }}>
          {back.slice(0, 3).map((o) => (
            <span key={o.value} className="shrink-0 truncate rounded-full bg-[var(--wui-bg-muted)] px-2 py-0.5 text-[10.5px] text-[var(--wui-fg-muted)]" style={{ maxWidth: 110 }}>
              {o.label}
            </span>
          ))}
          {back.length > 3 && <span className="shrink-0 text-[10.5px] text-[var(--wui-fg-muted)]">+{back.length - 3}</span>}
        </div>
      )}


      {folded && childCount > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleFold(screen.id);
          }}
          className="nodrag flex shrink-0 items-center justify-between border-t border-[var(--wui-border)] px-3 text-[11.5px] text-[var(--wui-primary)] hover:bg-[color-mix(in_srgb,var(--wui-primary)_6%,transparent)]"
          style={{ height: CARD.footer }}
        >
          <span>{box.hiddenBelow} {box.hiddenBelow === 1 ? 'screen' : 'screens'} beneath</span>
          <span className="flex items-center gap-0.5 font-medium">Show {down ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</span>
        </button>
      )}

      {down ? (
        <Handle
          type="source"
          id="bottom"
          position={Position.Bottom}
          isConnectable={false}
          style={{ ...handleStyle, bottom: -4, background: childCount > 0 && !folded ? 'var(--wui-primary)' : 'var(--wui-border-strong)', opacity: rows.length || screen.prompts.length > 1 ? 1 : 0 }}
        />
      ) : (
        // Lines from follow-up questions leave from the card as a whole.
        <Handle type="source" id="card" position={Position.Right} isConnectable={false} style={{ ...handleStyle, right: -4, top: CARD.header / 2, opacity: 0 }} />
      )}
    </div>
  );
}

export const ScreenCard = memo(ScreenCardImpl);
