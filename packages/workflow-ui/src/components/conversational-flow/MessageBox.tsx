/**
 * What a screen says, with a worked-out value drawn as a pill rather than
 * spelled out — two hundred characters of JSONata mid-sentence is unreadable.
 *
 * The source stays in the text and the engine resolves it there; only the
 * drawing changes. CodeMirror rather than a textarea because the pill has to be
 * atomic: the caret steps over it and a keystroke cannot land inside and leave
 * a broken expression.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, StateField } from '@codemirror/state';
import {
  tokenizeExpressions,
} from '@xyne/workflow-sdk/expression';
import { cn } from '../shared/cn.js';

/** One worked-out value, drawn. */
class ExpressionChip extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly source: string,
  ) {
    super();
  }

  override eq(other: ExpressionChip): boolean {
    return other.label === this.label && other.source === this.source;
  }

  override toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.dataset['expression'] = this.source;
    chip.title = this.source;
    chip.setAttribute('role', 'button');
    chip.setAttribute('aria-label', `Worked out: ${this.label}`);
    chip.className =
      'mx-px inline-flex cursor-pointer items-center gap-1 rounded bg-indigo-50 px-1.5 py-px align-baseline text-[11.5px] text-indigo-700 hover:bg-indigo-100';
    chip.textContent = `ƒ ${this.label}`;
    return chip;
  }

  /** Clicks must reach the handler below; without this CodeMirror swallows them. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Undo CodeMirror's own chrome.
 *
 * Its base theme gives the content padding, each line padding, a monospace
 * family and a dotted outline when focused — all correct for a code editor in a
 * panel, all wrong for a box drawn as the chat bubble it becomes. Everything
 * here inherits from the wrapper instead, so the bubble is styled in one place.
 *
 * The white card is *not* fixed here: that comes from `@uiw/react-codemirror`'s
 * default `theme: 'light'`, which is literally `{'&': {backgroundColor: '#fff'}}`,
 * and is dropped with `theme="none"` below. Overriding it from here would be
 * one theme fighting another, with no guaranteed winner.
 */
const bubble = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'inherit', fontSize: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-content': { padding: '0', fontFamily: 'inherit', caretColor: 'var(--wui-fg)' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--wui-fg-muted)' },
});

function chipsIn(doc: string, describe: (raw: string) => string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let at = 0;
  for (const token of tokenizeExpressions(doc)) {
    const length = token.kind === 'expression' ? token.raw.length : token.text.length;
    if (token.kind === 'expression') {
      builder.add(
        at,
        at + length,
        Decoration.replace({ widget: new ExpressionChip(describe(token.raw), token.raw) }),
      );
    }
    at += length;
  }
  return builder.finish();
}

export function MessageBox({
  value,
  onCommit,
  label,
  placeholder,
  rows = 2,
  disabled,
  className,
  describe,
  onBraces,
  onEditExpression,
  footer,
}: {
  value: string;
  onCommit: (next: string) => void;
  /** Announced rather than drawn, as the bubble says what it is by looking like it. */
  label: string;
  placeholder?: string | undefined;
  rows?: number;
  disabled?: boolean | undefined;
  className?: string | undefined;
  /** What one expression is called, in a few words. */
  describe: (raw: string) => string;
  /** Called when someone types `{{`, the unambiguous "I want a value here". */
  onBraces?: ((insert: (text: string) => void) => void) | undefined;
  /** Called when someone clicks a pill — the whole stored `{% … %}`. */
  onEditExpression?: ((raw: string) => void) | undefined;
  footer?: ((insert: (text: string) => void) => ReactNode) | undefined;
}) {
  const [draft, setDraft] = useState(value);
  const view = useRef<EditorView | null>(null);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const insert = useCallback(
    (text: string) => {
      const editor = view.current;
      if (!editor) return;
      const { from, to } = editor.state.selection.main;
      editor.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      // Picking a value is the whole intent; there is nothing to wait for, and
      onCommit(editor.state.doc.toString());
      editor.focus();
    },
    [onCommit],
  );

  const extensions = useMemo(() => {
    const field = StateField.define<DecorationSet>({
      create: (state) => chipsIn(state.doc.toString(), describe),
      update: (chips, tr) =>
        tr.docChanged ? chipsIn(tr.state.doc.toString(), describe) : chips.map(tr.changes),
      provide: (self) => EditorView.decorations.from(self),
    });
    return [
      bubble,
      EditorView.lineWrapping,
      field,
      // What makes the pill one thing: the caret steps over it rather than into
      EditorView.atomicRanges.of((editor) => editor.state.field(field)),
      EditorView.contentAttributes.of({ 'aria-label': label }),
      EditorView.domEventHandlers({
        mousedown: (event) => {
          const chip = (event.target as HTMLElement | null)?.closest<HTMLElement>(
            '[data-expression]',
          );
          const raw = chip?.dataset['expression'];
          if (raw === undefined || onEditExpression === undefined) return false;
          event.preventDefault();
          onEditExpression(raw);
          return true;
        },
        blur: (_event, editor) => {
          onCommit(editor.state.doc.toString());
          return false;
        },
      }),
    ];
  }, [describe, label, onCommit, onEditExpression]);

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          'overflow-hidden text-[13.5px] leading-[1.45]',
          disabled && 'opacity-60',
          className,
        )}
      >
        <CodeMirror
          value={draft}
          editable={!disabled}
          // Not 'light', which is this wrapper's own `{'&': {background: #fff}}`
          theme="none"
          // Tab moves to the next control. Capturing it to indent would trap
          indentWithTab={false}
          extensions={extensions}
          placeholder={placeholder ?? ''}
          minHeight={`${String(rows * 1.45)}rem`}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            bracketMatching: false,
            closeBrackets: false,
            autocompletion: false,
            searchKeymap: false,
          }}
          onCreateEditor={(editor) => {
            view.current = editor;
          }}
          onChange={(next: string, update: ViewUpdate) => {
            setDraft(next);
            if (!onBraces) return;
            const at = update.state.selection.main.head;
            if (next.slice(Math.max(0, at - 2), at) === '{{') onBraces(insert);
          }}
        />
      </div>
      {footer?.(insert)}
    </div>
  );
}
