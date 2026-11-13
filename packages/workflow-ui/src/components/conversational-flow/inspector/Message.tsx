/**
 * What someone reads on a screen, in the shape it arrives in.
 *
 * A message and a question are the same thing to whoever receives them, so they
 * are written in the same box. Typing `{{` offers what this screen knows — the
 * same list the conditions pick from, because "what can I say here" and "what do
 * I know here" are one question.
 *
 * A screen may say several things, sent one after another rather than as one
 * paragraph. Each is its own box, drawn as the bubble it becomes, so the editor
 * is already the preview.
 *
 * A worked-out value stays here as the expression it is — the engine resolves
 * it in place — and is *drawn* as a pill. See {@link MessageBox}. Clicking one
 * re-opens the form that built it, which is the way back into it now that its
 * source is not spelled out on the screen.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { X } from 'lucide-react';
import type { ConversationalFlow, Screen } from '@xyne/workflow-sdk/conversational-flow';
import { cn } from '../../shared/cn.js';
import { MarkdownEditor } from '../../shared/MarkdownEditor.js';
import { isHtml } from '../../shared/MessageText.js';
import { MessageBox } from '../MessageBox.js';
import { describeComputation } from '../computation.js';
import { InsertValue, valuesFor } from './DataSections.js';

/** Plain lines become paragraphs, so switching to rich text keeps the line breaks. */
const toHtml = (text: string) =>
  text.split('\n').map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('');

/** The same box as a formatted-text editor; what is stored is its HTML. Commits on blur. */
function RichMessage({ value, disabled, onCommit, onBraces, footer }: {
  value: string;
  disabled: boolean;
  onCommit: (html: string) => void;
  onBraces: () => void;
  footer: (insert: (text: string) => void) => ReactNode;
}) {
  const editor = useRef<Editor | null>(null);
  const draft = useRef(value);
  useEffect(() => {
    draft.current = value;
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5">
      <MarkdownEditor
        html
        bare
        value={value}
        disabled={disabled}
        editorRef={editor}
        onChange={(html) => { draft.current = html; }}
        onBlur={() => draft.current !== value && onCommit(draft.current)}
        onBraces={onBraces}
        className="overflow-hidden rounded-[16px] rounded-bl-[4px] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] text-[13.5px] [&_.ProseMirror]:min-h-[4.5rem] [&_.ProseMirror]:px-3.5 [&_.ProseMirror]:py-2.5"
      />
      {footer((text) => {
        const e = editor.current;
        if (!e) return;
        // A value picked after typing `{{` replaces those braces instead of doubling them.
        const at = e.state.selection.from;
        const chain = e.chain().focus();
        if (e.state.doc.textBetween(Math.max(0, at - 2), at) === '{{') chain.deleteRange({ from: at - 2, to: at });
        chain.insertContent(text).run();
        onCommit(draft.current);
      })}
    </div>
  );
}

export function Message({
  flow,
  screen,
  says: said,
  onSays,
  readOnly,
  label = 'What the assistant says',
  placeholder = 'What they read on this screen',
}: {
  flow: ConversationalFlow;
  screen: Screen;
  /** What is said now, in order. Whose messages they are is the caller's business. */
  says: string[];
  onSays: (next: string[]) => unknown;
  readOnly: boolean;
  /** Announced, not drawn: the box says what it is by looking like it. */
  label?: string;
  placeholder?: string;
}) {
  const [picking, setPicking] = useState<number | null>(null);
  // Rich text is opt-in per box: it keeps only what it can draw, so a stored message is never rewritten until asked.
  const [rich, setRich] = useState<Record<number, boolean>>({});
  /** The pill someone clicked: which message, and what it holds. */
  const [editing, setEditing] = useState<{ at: number; raw: string } | null>(null);

  /** Which offered values are lists — what tells `items.amount` from `a.b`. */
  const listPaths = new Set(
    valuesFor(flow, screen)
      .flatMap((group) => group.items)
      .filter((item) => item.type === 'array')
      .map((item) => item.path),
  );
  const describe = (raw: string) => describeComputation(raw, (path) => listPaths.has(path));

  const picker = (at: number) => (insert: (text: string) => void) => (
    <InsertValue
      flow={flow}
      screen={screen}
      insert={insert}
      open={picking === at}
      onOpenChange={(open) => { setPicking(open ? at : null); }}
      {...(editing?.at === at ? { editing: editing.raw } : {})}
      onEdited={(next) => {
        // Swapped where it sits rather than inserted at the caret: the author
        // clicked a pill, so that pill is what changes.
        write(says.map((line, i) => (i === at ? line.replace(editing?.raw ?? '', next) : line)));
        setEditing(null);
      }}
      onEditingDone={() => { setEditing(null); }}
    />
  );

  // There is always a box to write in, even before anything is written. What is
  // committed is the list itself — an empty one says nothing and sends nothing.
  const says = said.length > 0 ? said : [''];
  const write = (next: string[]): unknown => onSays(next);

  return (
    <div className="flex flex-col gap-1.5">
      {says.map((text, at) => (
        <div key={at} className="group/msg relative">
          {rich[at] ? (
            <RichMessage
              value={text}
              disabled={readOnly}
              onCommit={(next) => { write(says.map((line, i) => (i === at ? next : line))); }}
              onBraces={() => { setPicking(at); }}
              footer={picker(at)}
            />
          ) : (
          <MessageBox
            label={says.length > 1 ? `${label} — message ${String(at + 1)} of ${String(says.length)}` : label}
            value={text}
            disabled={readOnly}
            rows={Math.min(7, Math.max(2, Math.ceil(text.length / 44)))}
            placeholder={at === 0 ? placeholder : 'And then…'}
            onCommit={(next) => { write(says.map((line, i) => (i === at ? next : line))); }}
            className="rounded-[16px] rounded-bl-[4px] bg-[var(--wui-bg-subtle)] px-3.5 py-2.5"
            describe={describe}
            onBraces={() => { setPicking(at); }}
            {...(readOnly ? {} : { onEditExpression: (raw: string) => { setEditing({ at, raw }); } })}
            footer={picker(at)}
          />
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                setRich((m) => ({ ...m, [at]: !m[at] }));
                if (!rich[at] && text && !isHtml(text)) write(says.map((line, i) => (i === at ? toHtml(text) : line)));
              }}
              className="mt-1 text-[11.5px] text-[var(--wui-fg-muted)] underline-offset-2 hover:text-[var(--wui-fg)] hover:underline"
            >
              {rich[at] ? 'Edit HTML source' : 'Rich text editor'}
            </button>
          )}
          {!readOnly && says.length > 1 && (
            <button
              type="button"
              aria-label={`Remove message ${String(at + 1)}`}
              onClick={() => {
                setRich({}); // indices shift
                write(says.filter((_, i) => i !== at));
              }}
              className={cn(
                'absolute right-1.5 top-1.5 rounded-full p-1 text-[var(--wui-fg-muted)] opacity-0 transition-opacity',
                'hover:text-[var(--wui-fg)] group-hover/msg:opacity-100 focus-visible:opacity-100',
              )}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          onClick={() => { write([...says, '']); }}
          className="self-start text-[12px] font-medium text-[var(--wui-fg-muted)] transition-colors hover:text-[var(--wui-fg)]"
        >
          + Message
        </button>
      )}
    </div>
  );
}
