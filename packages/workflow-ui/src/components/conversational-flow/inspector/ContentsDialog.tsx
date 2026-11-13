/**
 * What becomes of what is inside a screen, asked before the screen stops being
 * able to hold it.
 *
 * A Menu is the only kind with room beneath it, so turning one into anything
 * else — or removing it — has to settle its contents first. The editor used to
 * refuse and say to move them elsewhere, which was a dead end while nothing
 * could be moved. The answers are offered here instead, where the question
 * actually comes up.
 */
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type ConversationalFlow,
  type Emptying,
  moveIsValid,
  type Screen,
  subtreeOf,
} from '@xyne/workflow-sdk/conversational-flow';
import { cn } from '../../shared/cn.js';
import { Button, ScreenPicker } from '../ui.js';

type Choice = 'up' | 'into' | 'delete';

export function ContentsDialog({
  flow,
  screen,
  because,
  confirmLabel,
  onChoose,
  onCancel,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  /** Why the contents are in the way, in one line. */
  because: string;
  /** What the author is about to do, on the button that does it. */
  confirmLabel: string;
  onChoose: (where: Emptying) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const becauseId = useId();
  // Everything under it, however deep — what "delete" would really take.
  const inside = subtreeOf(flow, screen.id).slice(1);
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  const up = screen.parent ? byId.get(screen.parent) : undefined;
  const canGoUp = up !== undefined && screen.children.every((c) => moveIsValid(flow, c, up.id));
  // Somewhere with room that is not inside what is being emptied.
  const roomFor = (s: Screen) =>
    !subtreeOf(flow, screen.id).includes(s.id) && screen.children.every((c) => moveIsValid(flow, c, s.id));
  const somewhere = flow.screens.filter(roomFor);

  const [choice, setChoice] = useState<Choice>(canGoUp ? 'up' : somewhere.length > 0 ? 'into' : 'delete');
  const [into, setInto] = useState<string>('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [onCancel]);

  if (typeof document === 'undefined') return null;

  const ready = choice !== 'into' || into !== '';
  const confirm = () => {
    if (choice === 'up' && up) onChoose({ kind: 'into', screen: up.id });
    else if (choice === 'into' && into) onChoose({ kind: 'into', screen: into });
    else if (choice === 'delete') onChoose({ kind: 'delete' });
  };

  const count = `${String(inside.length)} screen${inside.length === 1 ? '' : 's'}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={becauseId}
        className="relative z-10 flex w-full max-w-[440px] flex-col gap-3 rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg)] p-4 shadow-[var(--wui-shadow-md)]"
      >
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-[14px] font-semibold text-[var(--wui-fg)]">
            “{screen.title}” holds {count}
          </h2>
          <p id={becauseId} className="text-[12.5px] leading-relaxed text-[var(--wui-fg-muted)]">
            {because} What should happen to {inside.length === 1 ? 'it' : 'them'}?
          </p>
        </div>

        <div role="radiogroup" aria-label="What happens to what is inside" className="flex flex-col gap-1.5">
          {canGoUp && up && (
            <Option
              checked={choice === 'up'}
              onPick={() => { setChoice('up'); }}
              label={`Move ${inside.length === 1 ? 'it' : 'them'} up to \u201c${up.title}\u201d`}
              description={`Where \u201c${screen.title}\u201d itself sits, so nothing moves further than it has to.`}
            />
          )}
          {somewhere.length > 0 && (
            <Option
              checked={choice === 'into'}
              onPick={() => { setChoice('into'); }}
              label="Move into another screen"
              description="Somewhere else with room for them."
            >
              <ScreenPicker
                aria-label="Move into"
                flow={flow}
                value={into}
                placeholder="Choose a screen\u2026"
                only={roomFor}
                onChange={(id) => { setInto(id); setChoice('into'); }}
                className="mt-2 w-full"
              />
            </Option>
          )}
          <Option
            color="var(--wui-status-failed)"
            checked={choice === 'delete'}
            onPick={() => { setChoice('delete'); }}
            label={`Delete ${inside.length === 1 ? 'it' : `all ${count}`}`}
            description={
              screen.children.length < inside.length
                ? `Everything beneath \u201c${screen.title}\u201d, not only what it offers directly. This can\u2019t be undone.`
                : 'This can\u2019t be undone.'
            }
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          {/* Always the primary: it carries out whatever was chosen. The weight of
              a destructive choice sits on the choice itself, which is red and says
              it can't be undone — this package's `danger` is a text button, and a
              text button as a dialog's main action reads weaker than Cancel. */}
          <Button variant="primary" disabled={!ready} onClick={confirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    // Into the workflow-ui scope, not the bare body: every rule this package
    // emits is scoped under `[data-workflow-ui]`, and the --wui-* tokens only
    // resolve inside it.
    document.querySelector('[data-workflow-ui]') ?? document.body,
  );
}

/**
 * One choice: what it does, and what that costs.
 *
 * Selected is drawn with an inline style rather than a utility class, the way
 * {@link TypeChoice} does — this package's CSS is wrapped in a cascade layer,
 * and a layered declaration loses to the host's unlayered Preflight whatever
 * its specificity, which is how an earlier version's ring came out invisible.
 * Inline beats every layer, so the selected state cannot be themed away.
 */
function Option({ color = 'var(--wui-primary)', checked, onPick, label, description, children }: {
  color?: string;
  checked: boolean;
  onPick: () => void;
  label: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--wui-radius-sm)] border px-2.5 py-2 transition-colors',
        checked ? 'border-transparent' : 'border-[var(--wui-border)] hover:bg-[var(--wui-bg-muted)]',
      )}
      style={checked ? { background: `color-mix(in srgb, ${color} 10%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${color}` } : undefined}
    >
      <button type="button" role="radio" aria-checked={checked} onClick={onPick} className="flex w-full flex-col gap-0.5 text-left">
        <span
          className={cn('text-[12.5px]', checked ? 'font-semibold' : 'font-medium')}
          style={{ color: color === 'var(--wui-primary)' ? 'var(--wui-fg)' : color }}
        >
          {label}
        </span>
        <span className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">{description}</span>
      </button>
      {children}
    </div>
  );
}
