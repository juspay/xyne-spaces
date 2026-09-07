// Inline rendering of pending agent suggestions, Google-Docs style.
// These are ProseMirror DECORATIONS — paint over the document, never content:
// nothing here syncs to collaborators, exports, or the agent's next read.
// Red strikethrough = block a suggestion removes/rewrites, green = proposed
// content, dashed sky = where a moved block lands.
//
// The plugin is STATELESS and must be part of the editor's initial extension
// set. It reads rows/canEdit through the getData callback on each redraw —
// no plugin state, no dispatched transactions, no registerPlugin reconfigure.
// All three were tried and broke the collaborative undo stack (Ctrl+Z).
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export interface InlineSuggestionRow {
  id: string;
  op: string; // insert | replace | delete | move
  status: string;
  blockId?: string | null;
  proposedAnchorId?: string | null;
  currentAnchorId?: string | null;
  afterContent?: unknown;
  orderIndex: number;
  createdAt: number;
}

export interface SuggestionPaintData {
  rows: InlineSuggestionRow[];
  canEdit: boolean;
}

type PMNode = EditorState['doc'];

export const suggestionDecorationsKey = new PluginKey('canvasSuggestionDecorations');

const CLASSES = {
  removed: 'rounded-sm bg-red-50 line-through decoration-red-400 dark:bg-red-950/30',
  moveSource: 'rounded-sm bg-sky-50 dark:bg-sky-950/30',
  proposal:
    'my-1 whitespace-pre-wrap rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  deleteActions: 'my-1 w-fit',
  ghost:
    'my-1 cursor-pointer rounded-md border border-dashed border-sky-400 px-3 py-1 text-xs text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/30',
  moveChip:
    'my-0.5 w-fit cursor-pointer rounded-sm bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-900 hover:bg-sky-200 dark:bg-sky-950/40 dark:text-sky-200',
  stale:
    'my-0.5 w-fit rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground',
  actions: 'mt-1.5 flex gap-1.5',
  accept:
    'rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700',
  reject:
    'rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted',
};

const markdownOf = (row: InlineSuggestionRow): string =>
  ((row.afterContent as { markdown?: string } | null)?.markdown ?? '').trim();

const snippet = (text: string): string => {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 50 ? `${t.slice(0, 50)}…` : t;
};

/** Actions rendered on a widget: full accept/reject, dismiss-only, or none (read-only). */
type WidgetActions = 'full' | 'dismiss' | null;

const widget =
  (
    className: string,
    text: string,
    rowId: string,
    actions: WidgetActions,
    jumpTo?: string,
  ): (() => HTMLElement) =>
  () => {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    el.setAttribute('data-suggestion-widget', rowId);
    if (jumpTo) el.setAttribute('data-suggestion-jump', jumpTo);
    if (actions) {
      const bar = document.createElement('div');
      bar.className = text ? CLASSES.actions : 'flex gap-1.5';
      const pairs: [string, string, string][] =
        actions === 'full'
          ? [
              ['accept', 'Accept', CLASSES.accept],
              ['reject', 'Reject', CLASSES.reject],
            ]
          : [['reject', 'Dismiss', CLASSES.reject]];
      for (const [action, label, cls] of pairs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.className = cls;
        btn.setAttribute('data-suggestion-action', action);
        btn.setAttribute('data-suggestion-id', rowId);
        btn.setAttribute('data-track-category', 'CANVAS');
        btn.setAttribute('data-track-name', `suggestion_inline_${action}`);
        bar.appendChild(btn);
      }
      el.appendChild(bar);
    }
    return el;
  };

function buildDecorations(
  doc: PMNode,
  rows: InlineSuggestionRow[],
  canEdit: boolean,
): DecorationSet {
  const blocks = new Map<string, { pos: number; end: number; text: string }>();
  let firstBlockPos = 0;
  doc.descendants((node, pos) => {
    const id = (node.attrs as { id?: string }).id;
    if (node.type.name === 'blockContainer' && id && !blocks.has(id)) {
      if (!blocks.size) firstBlockPos = pos;
      blocks.set(id, { pos, end: pos + node.nodeSize, text: node.textContent });
    }
    return true;
  });
  if (!blocks.size) return DecorationSet.empty;

  // Same resolution as the apply engine, current-first: currentAnchorId is the
  // live pointer (forwarded by deletions and sibling accepts); the frozen
  // proposedAnchorId is the fallback. null is a valid "top of document" pointer.
  // Returns the resolved anchor's id (null = top) and the widget position.
  const resolveAnchor = (row: InlineSuggestionRow): { id: string | null; end: number } | null => {
    const current = row.currentAnchorId ?? null;
    if (current === null) return { id: null, end: firstBlockPos };
    if (blocks.has(current)) return { id: current, end: blocks.get(current)!.end };
    const proposed = row.proposedAnchorId ?? null;
    if (proposed === null) return { id: null, end: firstBlockPos };
    if (blocks.has(proposed)) return { id: proposed, end: blocks.get(proposed)!.end };
    return null;
  };

  const decos: Decoration[] = [];
  const pending = rows.filter(r => r.status === 'PENDING');
  const act: WidgetActions = canEdit ? 'full' : null;
  const dismiss: WidgetActions = canEdit ? 'dismiss' : null;

  // Stale rows: the block a suggestion targeted changed underneath it.
  for (const row of rows.filter(r => r.status === 'STALE')) {
    const target = row.blockId ? blocks.get(row.blockId) : undefined;
    if (!target) continue;
    decos.push(
      Decoration.widget(
        target.end,
        widget(CLASSES.stale, 'Suggestion no longer applies', row.id, dismiss),
        { key: row.id },
      ),
    );
  }

  for (const row of pending.filter(r => r.op === 'replace' || r.op === 'delete')) {
    const target = row.blockId ? blocks.get(row.blockId) : undefined;
    if (!target) continue;
    decos.push(Decoration.node(target.pos, target.end, { class: CLASSES.removed }));
    const md = row.op === 'replace' ? markdownOf(row) : '';
    if (md) {
      decos.push(
        Decoration.widget(target.end, widget(CLASSES.proposal, md, row.id, act), { key: row.id }),
      );
    } else if (act) {
      // Delete: the strikethrough already says it — just the actions, no banner.
      decos.push(
        Decoration.widget(target.end, widget(CLASSES.deleteActions, '', row.id, act), {
          key: row.id,
        }),
      );
    }
  }

  // Inserts + moves in proposal order, so stacked widgets at one anchor keep it.
  const placement = pending
    .filter(r => r.op === 'insert' || r.op === 'move')
    .sort((a, b) => a.createdAt - b.createdAt || a.orderIndex - b.orderIndex);
  placement.forEach((row, i) => {
    if (row.op === 'move') {
      const source = row.blockId ? blocks.get(row.blockId) : undefined;
      if (!source) return;
      const anchor = resolveAnchor(row);
      if (anchor === null) return;
      decos.push(Decoration.node(source.pos, source.end, { class: CLASSES.moveSource }));
      // Each end quotes the other, and clicking either scrolls to its partner.
      const anchorText = anchor.id ? snippet(blocks.get(anchor.id)?.text ?? '') : '';
      const chipText = anchorText
        ? `⤵ moves below “${anchorText}”`
        : '⤵ moves to the top of the document';
      decos.push(
        Decoration.widget(
          source.pos,
          widget(CLASSES.moveChip, chipText, row.id, null, anchor.id ?? undefined),
          { side: -1, key: `${row.id}-src` },
        ),
      );
      const sourceText = snippet(source.text);
      decos.push(
        Decoration.widget(
          anchor.end,
          widget(
            CLASSES.ghost,
            sourceText ? `⤵ moves here: “${sourceText}”` : '⤵ a block moves here',
            row.id,
            act,
            row.blockId ?? undefined,
          ),
          { side: i + 1, key: row.id },
        ),
      );
    } else {
      const md = markdownOf(row);
      const anchor = resolveAnchor(row);
      if (!md || anchor === null) return;
      decos.push(
        Decoration.widget(anchor.end, widget(CLASSES.proposal, md, row.id, act), {
          side: i + 1,
          key: row.id,
        }),
      );
    }
  });

  return DecorationSet.create(doc, decos);
}

/**
 * Stateless decorations plugin. `getData` is read on every redraw; results are
 * memoized on (doc, rows, canEdit) identity so selection-only updates are free.
 * To repaint after a rows change with no doc change, nudge the view with
 * `view.updateState(view.state)` — never dispatch a transaction for it.
 */
export function createSuggestionDecorationsPlugin(getData: () => SuggestionPaintData): Plugin {
  let last: {
    doc: PMNode;
    rows: InlineSuggestionRow[];
    canEdit: boolean;
    decos: DecorationSet;
  } | null = null;
  return new Plugin({
    key: suggestionDecorationsKey,
    props: {
      decorations(state): DecorationSet {
        const { rows, canEdit } = getData();
        if (last && last.doc === state.doc && last.rows === rows && last.canEdit === canEdit) {
          return last.decos;
        }
        const decos = rows.length
          ? buildDecorations(state.doc, rows, canEdit)
          : DecorationSet.empty;
        last = { doc: state.doc, rows, canEdit, decos };
        return decos;
      },
    },
  });
}
