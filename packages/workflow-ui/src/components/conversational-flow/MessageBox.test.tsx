/**
 * The pill, and the four things that make it work: it draws instead of the
 * source, the caret cannot get inside it, clicking it says which one, and the
 * box still looks like a bubble rather than a code editor.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { MessageBox } from './MessageBox.js';

const BREAKDOWN =
  '{% $join($map(steps.ride.output.body.fareBreakup, function($i){ $string($i.description) }), "\\n") %}';

const box = () => screen.getByLabelText('What the assistant says');

function editor() {
  const found = EditorView.findFromDOM(box().parentElement as HTMLElement);
  if (!found) throw new Error('no editor');
  return found;
}

const show = (value: string, props: Partial<Parameters<typeof MessageBox>[0]> = {}) =>
  render(
    <MessageBox
      label="What the assistant says"
      value={value}
      onCommit={() => {}}
      describe={() => 'each fareBreakup'}
      {...props}
    />,
  );

describe('a worked-out value in a message', () => {
  it('draws as a pill instead of its source', () => {
    show(`Here it is:\n${BREAKDOWN}`);
    // The source is still the value — it is simply not what is shown, and it is
    // still what the engine resolves where it sits.
    expect(editor().state.doc.toString()).toContain('$join($map(');
    expect(screen.getByLabelText('Worked out: each fareBreakup')).toBeTruthy();
    expect(box().textContent).not.toContain('$join');
    expect(box().textContent).toContain('Here it is:');
  });

  it('is stepped over rather than into, so a keystroke cannot land inside', () => {
    show(`a ${BREAKDOWN} b`);
    const view = editor();
    const start = 2;
    const end = start + BREAKDOWN.length;
    // What pressing → at its left edge does: the whole pill, in one move.
    expect(view.moveByChar(EditorSelection.cursor(start), true).head).toBe(end);
    expect(view.moveByChar(EditorSelection.cursor(end), false).head).toBe(start);
  });

  it('says which one was clicked, and hands back exactly what is stored', () => {
    const onEditExpression = vi.fn();
    show(`one ${BREAKDOWN} two`, { onEditExpression });
    fireEvent.mouseDown(screen.getByLabelText('Worked out: each fareBreakup'));
    expect(onEditExpression).toHaveBeenCalledWith(BREAKDOWN);
  });

  it('brings none of the code editor’s own chrome with it', () => {
    show('plain');
    // The white card came from @uiw's default `theme: 'light'`. Dropped at the
    // source, so the bubble behind it shows through.
    const editorEl = box().closest('.cm-editor') as HTMLElement;
    expect(editorEl.style.backgroundColor).toBe('');
    expect(editorEl.className).not.toContain('cm-theme-light');
  });

  it('leaves ordinary text and short references alone', () => {
    show('Hello {{trigger.context.name}}');
    expect(box().textContent).toContain('{{trigger.context.name}}');
    expect(screen.queryByLabelText(/^Worked out:/)).toBeNull();
  });

  it('commits what was typed when the box is left', () => {
    const onCommit = vi.fn();
    show('before', { onCommit });
    const view = editor();
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'after' } });
    });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(box());
    expect(onCommit).toHaveBeenCalledWith('after');
  });

  it('commits a picked value straight away, since nothing is waited for', () => {
    const onCommit = vi.fn();
    let put: ((text: string) => void) | null = null;
    show('say ', {
      onCommit,
      footer: (insert) => {
        put = insert;
        return null;
      },
    });
    act(() => {
      editor().dispatch({ selection: { anchor: 4 } });
      put?.('{{trigger.context.name}}');
    });
    expect(onCommit).toHaveBeenCalledWith('say {{trigger.context.name}}');
  });

  it('opens the value list when someone types the braces', () => {
    const onBraces = vi.fn();
    show('', { onBraces });
    act(() => {
      // Typed, so the caret follows the braces — a bare change would leave it
      // at 0 and say nothing was typed there.
      editor().dispatch({ changes: { from: 0, insert: '{{' }, selection: { anchor: 2 } });
    });
    expect(onBraces).toHaveBeenCalled();
  });
});
