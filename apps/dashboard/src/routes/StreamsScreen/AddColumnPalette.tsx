import { ReactElement, useCallback, useMemo, useState } from 'react';
import { SparkleAi } from '../../components/icons/SparkleAi';
import { toast } from 'sonner';
import GlobalCommandMenu from '../../components/GlobalCommandMenu/GlobalCommandMenu';
import { TabType } from '../../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import type { ContextItem } from '../../components/Chat/ThreadContextPanel/ThreadContextPanel.types';
import { useAllChannels } from '../../hooks/useChannels';
import { useIntersectionObserver } from '../../hooks/useIntersectionObserver';
import { useStreamsDev } from './StreamsDev';
import { allowsDuplicates, sourceKey } from './Streams.utils';
import { columnFromResult, contextIdForKey } from './columnFromResult';
import { cn } from '../../utils/classNames';
import type { ColumnSource } from './Streams.types';

/**
 * Which of cmd+K's categories can become a column.
 *
 * `ALL` leads and is the reason the rest work. It draws no chip of its own — it
 * is the *unfiltered* state, the one cmd+K opens in — and enabling it buys two
 * things the palette was visibly missing without it: the panel opens showing
 * channels and people instead of one filtered category, and clicking the active
 * tab clears back to it, so a filter can be taken off as well as put on.
 *
 * Leaving it out is what stranded the palette on a category with a dead search
 * backend and nothing to draw: a filtered tab, an empty body, and no way back.
 *
 * The tabs still left out cannot be columns at all — Desk mail, calls and
 * recordings have no surface in `ColumnSource`.
 */
const COLUMN_TABS: TabType[] = [
  TabType.ALL,
  TabType.CHANNELS,
  TabType.MESSAGES,
  TabType.TICKETS,
  TabType.CANVAS,
  TabType.ATTACHMENTS,
  TabType.USERS,
];

/**
 * Ask AI, pinned to the bottom.
 *
 * Every other row in this panel is something that already exists and is being
 * located. Ask AI is the one thing here that does not exist yet — you are not
 * finding a conversation, you are starting one — so it does not belong in a list
 * of search results, and putting it above the search box made the first thing
 * you saw an answer to a question nobody had asked.
 *
 * A footer is where cmd+K puts its verbs, and it is the one strip of the panel
 * that never scrolls away: the results move under it while it stays put.
 *
 * Never marked "added". Several Ask AI columns is a normal way to work — one
 * question parked while you start another — which `allowsDuplicates` is the
 * canonical statement of.
 */
const AskAiFooter = ({ onPick }: { onPick: (source: ColumnSource) => void }): ReactElement => (
  <>
    {/* Inset to 16px, so the rule starts and ends where the result rows above it
        do — everything else in this card is on that column, and a full-bleed line
        was the only thing breaking it. The conventional reading of an edge-to-edge
        rule is "a separate region below", which this footer genuinely is; it loses
        to alignment here, and if the region needs saying again it should be said
        with a background rather than a wider line. */}
    <div className='mx-4 h-px shrink-0 bg-border' />
    <div className='shrink-0 p-1.5'>
      <button
        type='button'
        onClick={() => onPick({ kind: 'agent' })}
        className='streams-press-row flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-accent hover:text-accent-foreground'
        data-track-category='Streams'
        data-track-name='AddSurfaceColumn'
      >
        <SparkleAi className='size-4 shrink-0 text-muted-foreground' aria-hidden />
        <span className='min-w-0 flex-1 truncate'>Ask AI</span>
        <span className='shrink-0 text-[11px] text-muted-foreground'>new chat</span>
      </button>
    </div>
  </>
);

export interface AddColumnPaletteProps {
  /** Fixed pixel width. Ignored when `fill` is set. */
  width?: number | undefined;
  /**
   * Fill the parent instead of sizing itself.
   *
   * Set when the palette is rendered *inside* the focus carousel's add page,
   * which already owns the width, the snap point and the position. The palette
   * being a sibling that swapped in for that page is what made opening it read
   * as a hard cut — same slot, different element, no continuity.
   */
  fill?: boolean;
  /**
   * Take the keyboard on mount.
   *
   * True everywhere the palette appears *because you asked for it*. False for the
   * copy that lives permanently at the end of the focus carousel — a field that
   * grabbed focus merely by existing off screen would swallow typing meant for
   * whichever column you were actually in.
   */
  autoFocus?: boolean;
  /** Source keys already in the stream, so the list can say so. */
  present: ReadonlySet<string>;
  onPick: (source: ColumnSource) => void;
  onDismiss: () => void;
}

/**
 * The `a` palette — how a column gets into a stream.
 *
 * Between the search box and the Ask AI footer this *is* cmd+K: the same
 * `ChannelCommandMenu`, running inline, with the tabs a column cannot be removed
 * and its selection handed to the stream instead of to the router. That is the whole design. A picker that
 * merely resembled cmd+K would have to re-earn ranking, `in:`/`type:` filters,
 * recents, mention chips and every result type — and would then drift from the
 * search box people already know, one improvement at a time.
 *
 * The menu offers a mode for exactly this. `contextSelectionMode` was built so
 * Ask AI could collect context: it suppresses navigation, hands the caller the
 * whole result, ticks what is already chosen, and stands down the global ⌘K
 * shortcut so an embedded palette cannot reopen itself. Every one of those is
 * what an add-column picker wants, so this uses the mode as-is rather than
 * adding a near-duplicate of it to a file with ten other callers.
 *
 * Deliberately pull, never push. A matching channel never inserts itself: a panel
 * appearing unbidden while you are reading is worse than a notification, because
 * it also moves everything else. Materialising is always the user's move.
 *
 * Carries `data-streams-input` so the focus guard lets its input keep focus —
 * without that opt-out the autofocused field is blurred the instant it mounts.
 */
const AddColumnPalette = ({
  width,
  fill = false,
  autoFocus = true,
  present,
  onPick,
  onDismiss,
}: AddColumnPaletteProps): ReactElement => {
  const channels = useAllChannels();
  const dev = useStreamsDev();

  /**
   * Mount the command menu on arrival, not on existence.
   *
   * One copy of this palette lives permanently at the end of the focus
   * carousel, off screen, for as long as focus mode is on. The menu is a large
   * component with a search session behind it, and running one there — for a
   * page nobody has scrolled to — is exactly the kind of always-on cost this
   * stream spends its time removing. Intersection is the honest signal: the add
   * page is a snap point in a horizontal scroller, so "visible" is a fact the
   * browser already knows.
   *
   * Latching (`triggerOnce`) rather than tracking: once you have arrived, the
   * menu stays. Unmounting it on the way past would throw away the query you
   * typed, and re-mounting is the expensive direction anyway.
   *
   * The palette you opened deliberately skips the wait — `autoFocus` is only
   * true when it appeared because you asked for it, which means it is already
   * on screen.
   */
  const [arrived, setArrived] = useState(false);
  const shellRef = useIntersectionObserver<HTMLDivElement>(() => setArrived(true), {
    threshold: 0.1,
  });
  const menuMounted = autoFocus || arrived;

  /**
   * The stream, spoken in the menu's own dialect, so it ticks what is already open.
   *
   * Only `id` is compared, but the shape is a `ContextItem`, so the rest is
   * filled in honestly rather than cast away.
   */
  const streamItems = useMemo<ContextItem[]>(() => {
    const items: ContextItem[] = [];
    for (const key of present) {
      const match = contextIdForKey(key);
      if (!match) continue;
      items.push({
        id: match.id,
        title: '',
        type: match.type,
        url: '#',
        searchResult: {
          id: match.id,
          type: match.type,
          title: '',
          subtitle: '',
          relevanceScore: 0,
          metadata: {},
        },
      });
    }
    return items;
  }, [present]);

  const handleResultPick = useCallback(
    (item: ContextItem): void => {
      const source = columnFromResult(item.searchResult, channels);
      // The one result that cannot become a column: a person with no DM yet.
      // Opening one is a write, and a picker does not write — so say why rather
      // than swallowing the click.
      if (!source) {
        toast.info('Nothing to open as a column yet', {
          description: 'Start a conversation with them first.',
        });
        return;
      }
      if (!allowsDuplicates(source) && present.has(sourceKey(source))) {
        toast.info('Already in this stream');
        return;
      }
      onPick(source);
    },
    [channels, present, onPick],
  );

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) onDismiss();
    },
    [onDismiss],
  );

  const shell = cn(
    // The dashed edge is the add slot's signature in the wide stream, so the
    // focus carousel's copy carries it too — same affordance, same outline,
    // whichever mode you are in. Grey rather than the brand colour: this is
    // an empty slot inviting something, not a selected or active thing, and
    // an accent border here competed with the focus ring for the same
    // "this one matters" reading.
    //
    // No `rounded-*`: the radius is the dial every column reads, applied below
    // as a style. A utility class would win over it and quietly leave this one
    // card a different shape from the eight beside it.
    'flex h-full flex-col overflow-hidden border border-dashed border-border bg-card',
    fill ? 'w-full' : 'shrink-0',
  );
  const shellStyle = {
    borderRadius: dev.columnRadius,
    ...(fill ? {} : { width: `${width ?? 0}px` }),
  };

  return (
    <div ref={shellRef} className={shell} style={shellStyle} data-streams-input>
      {/* min-h-0 so the menu's own flex column can scroll inside the card rather
          than growing it — the card's height is the column's, and nothing in
          here is allowed to change that. */}
      <div className='min-h-0 flex-1'>
        {menuMounted && (
          <GlobalCommandMenu
            inline
            open
            onOpenChange={handleOpenChange}
            contextSelectionMode
            contextItems={streamItems}
            // The tick here says "this stream already has one", about a row you
            // cannot click. A solid brand tick is the multi-select control from
            // Ask AI's picker, and a column of them down an inert list reads as
            // buttons wanting attention.
            selectionVariant='outline'
            onContextItemToggle={handleResultPick}
            enabledTabs={COLUMN_TABS}
            // Seven tabs with labels need ~633px; a column gives the strip 378.
            // Collapsed to icons they fit with room to spare.
            compactTabs
            disableAutoFocus={!autoFocus}
          />
        )}
      </div>

      <AskAiFooter onPick={onPick} />
    </div>
  );
};

AddColumnPalette.displayName = 'AddColumnPalette';

export { sourceKey };
export default AddColumnPalette;
