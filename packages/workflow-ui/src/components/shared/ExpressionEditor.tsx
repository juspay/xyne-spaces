/**
 * The `{% expression %}` editor: a box, its faults, and what may go in it.
 *
 * The delimiters are not shown — being in this mode *is* the `{% %}`. What is
 * offered is decided by the field's type, and the rule is one-directional:
 * everything offered must be something the validator accepts, but not
 * everything it accepts is worth offering.
 *
 * Knows nothing about where the values come from; the paths are a prop and the
 * browser a render prop, so the step builder and the screens editor share it.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  kindOfJsonType,
  type TypeKind,
} from '@xyne/workflow-sdk/builder';
import {
  EXPRESSION_FUNCTIONS,
  extractExpressionSource,
  inferExpressionType,
  inspectExpression,
  toExpressionValue,
  type ExpressionFunction,
} from '@xyne/workflow-sdk/expression';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { cn } from './cn.js';

/** One readable address, with whatever its schema declared it to be. */
export interface ExpressionPath {
  path: string;
  schemaType: string;
}

export interface ExpressionEditorProps {
  /** The stored field value — `{% … %}` when already an expression. */
  value: unknown;
  onChange: (value: unknown) => void;
  /** Everything the expression may read. Completion and typing both come from this. */
  paths: readonly ExpressionPath[];
  /** The field's JSON-schema type, which decides which functions are offered. */
  fieldType?: string | undefined;
  disabled?: boolean | undefined;
  /** A browser for those values, opened by the editor's own button. */
  renderPicker?:
    | ((api: { insert: (path: string) => void; close: () => void }) => ReactNode)
    | undefined;
}

export function functionsFor(fieldType: string | undefined): ExpressionFunction[] {
  const target = kindOfJsonType(fieldType);
  // A string or an unreadable type accepts anything; an unknowable result fits
  const universal = target === 'string' || target === 'unknown';
  // `offer`, not the signature: JSONata declares no return for `$filter`, so
  return EXPRESSION_FUNCTIONS.filter(
    // Not the arithmetic entries. They exist so a *form* can offer "multiply",
    (fn) => fn.infix === undefined && (universal || fn.offer === 'unknown' || fn.offer === target),
  );
}

/** A catalogue entry as text to insert, and where to leave the caret. */
export function functionInsertion(fn: ExpressionFunction): { text: string; caretBack: number } {
  const at = fn.template.indexOf('…');
  const text = fn.template.replaceAll('…', '');
  return { text, caretBack: at === -1 ? 0 : text.length - at };
}

function completionsFor(
  offered: ExpressionFunction[],
  refPaths: readonly ExpressionPath[],
): Completion[] {
  return [
    ...offered.map(
      (fn): Completion => ({
        label: fn.name,
        // The template, so a pick lands a complete call rather than a bare name
        apply: functionInsertion(fn).text,
        type: 'function',
        detail: fn.label,
        info: fn.help,
        boost: 5,
      }),
    ),
    ...refPaths.map(
      (ref): Completion => ({
        label: ref.path,
        type: 'variable',
        detail: ref.schemaType,
        boost: 3,
      }),
    ),
  ];
}

function completionSource(options: Completion[]) {
  return (context: CompletionContext) => {
    const word = context.matchBefore(/[\w.$]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    return { from: word.from, options, validFor: /^[\w.$]*$/ };
  };
}
export function ExpressionEditor({
  value,
  onChange,
  paths,
  fieldType,
  disabled,
  renderPicker,
}: ExpressionEditorProps) {
  // The stored value may be an expression, or whatever the field held before
  const source = typeof value === 'string' ? (extractExpressionSource(value) ?? '') : '';

  const handleChange = useCallback(
    (next: string) => {
      // An emptied editor clears the field rather than storing `{%  %}`, so
      onChange(next.trim() === '' ? undefined : toExpressionValue(next));
    },
    [onChange],
  );

  const [picking, setPicking] = useState(false);
  const viewRef = useRef<EditorView | null>(null);

  /** Put text where the caret is, and leave the caret somewhere useful. */
  const insertAtCaret = useCallback(
    (text: string, caretBack = 0) => {
      const view = viewRef.current;
      if (!view) {
        handleChange(`${source}${text}`);
        return;
      }
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length - caretBack },
      });
      view.focus();
    },
    [handleChange, source],
  );

  /** A catalogue entry, with the caret left where its value goes. */
  const insertFunction = useCallback(
    (fn: ExpressionFunction) => {
      const { text, caretBack } = functionInsertion(fn);
      insertAtCaret(text, caretBack);
    },
    [insertAtCaret],
  );

  const offered = useMemo(() => functionsFor(fieldType), [fieldType]);

  const extensions = useMemo(
    () => [
      javascript(), // No published JSONata mode; the token shapes are close enough.
      EditorView.lineWrapping,
      autocompletion({
        override: [completionSource(completionsFor(offered, paths))],
        activateOnTyping: true,
      }),
    ],
    [paths, offered],
  );

  /** What the expression is reading, as far as the offered paths say. */
  const lookup = useMemo(() => {
    const types = new Map(paths.map((ref) => [ref.path, kindOfJsonType(ref.schemaType)] as const));
    return (path: string): TypeKind | undefined => types.get(path);
  }, [paths]);

  const fault = source.trim() === '' ? null : inspectExpression(source);
  /**
   * Type faults, shown only once the expression reads at all — a broken expression has no meaningful types, and two complaints about one mistake is one too many.
   */
  const typeFaults = useMemo(
    () => (fault || source.trim() === '' ? [] : inferExpressionType(source, lookup).faults),
    [fault, source, lookup],
  );

  return (
    <div className="space-y-1">
      <div
        className={cn(
          'rounded-lg border bg-white font-mono',
          fault || typeFaults.length > 0
            ? 'border-red-300 focus-within:border-red-400 focus-within:ring-2 focus-within:ring-red-100'
            : 'border-[var(--wui-border)] focus-within:border-[var(--wui-primary)] focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)]',
          disabled && 'opacity-60',
        )}
        style={{ overflow: 'clip' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <CodeMirror
          value={source}
          onChange={handleChange}
          extensions={extensions}
          readOnly={disabled ?? false}
          onCreateEditor={(view) => {
            viewRef.current = view;
          }}
          placeholder="$sum(steps.…)"
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false, // ours, above
          }}
          minHeight="2.25rem"
          maxHeight="12rem"
          style={{ fontSize: '12.5px' }}
        />
      </div>

      {fault && (
        <p className="flex items-start gap-1 font-mono text-[11px] text-red-500">
          <span className="shrink-0 opacity-70">
            {fault.position === undefined ? '⚠' : `⚠ ${String(fault.position)}`}
          </span>
          <span className="font-sans">{fault.message}</span>
        </p>
      )}

      {typeFaults.map((typeFault, index) => (
        <p key={index} className="flex items-start gap-1 font-mono text-[11px] text-amber-600">
          <span className="shrink-0 opacity-70">
            {typeFault.position === undefined ? '⚠' : `⚠ ${String(typeFault.position)}`}
          </span>
          <span className="font-sans">{typeFault.message}</span>
        </p>
      ))}

      {/* What this field can be worked out from. The value picker stays even
          while the expression is broken — a missing reference is a common
          reason it is broken. The function chips are type-scoped, so a number
          field never suggests a list operation. */}
      {!disabled && (
        <div className="relative flex flex-wrap items-center gap-1">
          {renderPicker !== undefined && (
            <button
              type="button"
              onClick={() => setPicking((open) => !open)}
              title="Insert a value this field can be worked out from"
              className={cn(
                'rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                picking
                  ? 'border-indigo-300 bg-indigo-100 text-indigo-700'
                  : 'border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
              )}
            >
              + value
            </button>
          )}

          {!fault && typeFaults.length === 0 &&
            offered.slice(0, 6).map((fn) => (
              <button
                key={fn.name}
                type="button"
                title={fn.help}
                onClick={() => insertFunction(fn)}
                className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] text-indigo-600 transition-colors hover:bg-indigo-100"
              >
                {fn.name}
              </button>
            ))}
          {!fault && typeFaults.length === 0 && offered.length > 6 && (
            <span className="text-[10px] text-[var(--wui-fg-muted)]">
              +{offered.length - 6} more — start typing
            </span>
          )}

          {picking &&
            renderPicker?.({
              insert: (path) => insertAtCaret(path),
              close: () => setPicking(false),
            })}
        </div>
      )}
    </div>
  );
}
