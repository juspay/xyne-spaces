/**
 * What can go on a screen: another screen inside it, or something to look up
 * before it.
 *
 * One grid, not two groups. Six tiles make a screen — somewhere a person goes,
 * with an option that opens it. The seventh makes a lookup, which is not
 * somewhere: it runs in front of this screen and hands it something to say. That
 * one difference is the dashed tile, and it is the same dashed border the map
 * draws around what a lookup feeds.
 *
 * A lookup is a thing you can *add*, never a thing a screen can *become* or an
 * option can open — so it appears here and in no other chooser.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Database, MessageSquare, ListTree, PenLine, Sparkles, Flag, Star, UserRound } from 'lucide-react';
import type { NewScreenType } from '@xyne/workflow-sdk/conversational-flow';
import { cn } from '../../shared/cn.js';

/** What the author asked for: a screen of some kind, or a lookup. */
export type AddChoice =
  | { kind: 'screen'; type: NewScreenType }
  | { kind: 'call'; title: string; url: string }
  /** A screen whose purpose is to ask for something before the screen inside it. */
  | { kind: 'input' }
  /** The same screen, asking how it went — a rating, and a Finish inside it. */
  | { kind: 'feedback' }
  /** A screen put into the path above this one, rather than inside it. */
  | { kind: 'above' };

interface Item {
  label: string;
  hint: string;
  icon: typeof Database;
  choice: AddChoice;
}

const KINDS: Item[] = [
  { label: 'Message', hint: 'says something, then moves on', icon: MessageSquare, choice: { kind: 'screen', type: 'message' } },
  { label: 'Menu', hint: 'a question with options beneath it', icon: ListTree, choice: { kind: 'screen', type: 'menu' } },
  { label: 'Ask for details', hint: 'asks for something, then opens the screen inside it', icon: PenLine, choice: { kind: 'input' } },
  { label: 'Ask how it went', hint: 'a rating, then whatever closes the conversation', icon: Star, choice: { kind: 'feedback' } },
  { label: 'Ask AI', hint: 'an agent answers until they leave', icon: Sparkles, choice: { kind: 'screen', type: 'ask-ai' } },
  { label: 'Hand off', hint: 'a person takes it from here', icon: UserRound, choice: { kind: 'screen', type: 'handoff' } },
  { label: 'Finish', hint: 'ends the conversation', icon: Flag, choice: { kind: 'screen', type: 'end' } },
];

/**
 * A lookup's reach is where it sits, so the menu says where that is: in front of
 * the first screen it runs once, before anything, and every screen can read it.
 */
/**
 * The one thing here that goes *above* rather than inside: whatever opens this
 * screen opens the new one, and the new one opens this. A kind isn't offered
 * because it always ends up holding this screen, which makes it a menu.
 */
const ABOVE: Item = {
  label: 'Insert a screen above',
  hint: 'goes between this screen and whatever opens it',
  icon: ArrowUp,
  choice: { kind: 'above' },
};

const lookupFor = (everywhere: boolean): Item => ({
  label: 'Look something up',
  hint: everywhere
    ? 'fetched once before the conversation starts; readable anywhere'
    : 'fetched before this screen; readable below it',
  icon: Database,
  choice: { kind: 'call', title: '', url: '' },
});

export function AddMenu({
  parentTitle,
  canHoldScreens,
  isFirstScreen = false,
  at,
  onPick,
  onClose,
}: {
  parentTitle: string;
  /** Whether screens can go inside this one. A lookup always can go in front of it. */
  canHoldScreens: boolean;
  /** In front of the first screen, a lookup runs for the whole conversation. */
  isFirstScreen?: boolean;
  /** Where to put it, in the map's own pixels. */
  at: { x: number; y: number };
  onPick: (choice: AddChoice) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // A lookup needs somewhere to look before it can exist, so it is asked for
  // here rather than made up and corrected later.
  const [asking, setAsking] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as globalThis.Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    box.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      role="menu"
      aria-label={`Add to ${parentTitle}`}
      style={{ left: at.x, top: at.y }}
      className="absolute z-20 w-[340px] overflow-hidden rounded-[12px] border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] shadow-[var(--wui-shadow-md)]"
    >
      <p className="border-b border-[var(--wui-border)] px-3 py-2 text-[12px] text-[var(--wui-fg-muted)]">
        Add to <span className="font-semibold text-[var(--wui-fg)]">{parentTitle}</span>
      </p>
      {asking ? (
        <form
          className="flex flex-col gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) onPick({ kind: 'call', title: title.trim() || 'Lookup', url: url.trim() });
          }}
        >
          <label className="text-[12px] text-[var(--wui-fg-muted)]">
            Address
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/orders/{{trigger.context.orderId}}"
              className="mt-1 w-full rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1.5 font-mono text-[12px] text-[var(--wui-fg)]"
            />
          </label>
          <label className="text-[12px] text-[var(--wui-fg-muted)]">
            Name
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lookup"
              className="mt-1 w-full rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1.5 text-[12.5px] text-[var(--wui-fg)]"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-2 py-1 text-[12.5px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!url.trim()}
              className="rounded-[var(--wui-radius-sm)] bg-[var(--wui-primary)] px-2.5 py-1 text-[12.5px] font-semibold text-[var(--wui-primary-fg,#fff)] disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 p-2">
          {canHoldScreens && KINDS.map((item) => <Tile key={item.label} item={item} onPick={() => onPick(item.choice)} />)}
          {/* The first screen is where every run begins, so nothing precedes it. */}
          {!isFirstScreen && <Tile item={ABOVE} onPick={() => onPick(ABOVE.choice)} className="col-span-2" />}
          <Tile item={lookupFor(isFirstScreen)} dashed onPick={() => setAsking(true)} className={canHoldScreens ? 'col-span-2' : ''} />
        </div>
      )}
    </div>
  );
}

function Tile({
  item,
  dashed,
  className,
  onPick,
}: {
  item: Item;
  dashed?: boolean;
  className?: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      title={item.hint}
      className={cn(
        'flex items-start gap-2 rounded-[var(--wui-radius-sm)] border p-2 text-left transition-colors',
        'hover:border-[var(--wui-primary)] hover:bg-[var(--wui-bg-muted)] focus-visible:outline-none focus-visible:border-[var(--wui-primary)]',
        dashed ? 'border-dashed' : 'border-[var(--wui-border)]',
        className,
      )}
      style={dashed ? { borderColor: 'color-mix(in srgb, var(--wui-cf-data, var(--wui-primary)) 45%, var(--wui-border))' } : undefined}
    >
      <item.icon
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ color: dashed ? 'var(--wui-cf-data, var(--wui-primary))' : 'var(--wui-fg-muted)' }}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-[var(--wui-fg)]">{item.label}</span>
        <span className="block text-[11px] leading-snug text-[var(--wui-fg-muted)]">{item.hint}</span>
      </span>
    </button>
  );
}
