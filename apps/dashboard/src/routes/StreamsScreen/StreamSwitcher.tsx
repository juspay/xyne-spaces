import { ReactElement, useRef, useState } from 'react';
import { Tooltip } from '../../components/ui/Tooltip/Tooltip';
// The app's own set, at the app's own `size={14}` — the same call every other
// menu in the product makes. This shipped on lucide at `size-3.5`, which is
// a different stroke weight and a different corner treatment at a nominally
// equal size, and is most of why the menu read as belonging to another app.
import {
  CheckTickSingle,
  ChevronSortVertical,
  DeleteDustbin01,
  FolderArrowDown,
  PencilEdit,
  PlusDefault,
  RotateLeft,
} from '@xyne/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { ActivityDot } from './ActivityDot';
import { archivedStreams, liveStreams } from './streamsLayout';
import { IDLE, type ColumnActivity } from './useColumnActivity';
import { cn } from '../../utils/classNames';
import type { StreamActivity } from './useStreamActivity';
import type { Stream, StreamsLayout } from './Streams.types';

export interface StreamSwitcherProps {
  layout: StreamsLayout;
  /**
   * Activity for every column in every *live* stream, keyed by column id.
   *
   * The whole map rather than a per-stream summary, because the summary is one
   * loop over it and passing the map keeps the screen from having to know how a
   * stream's activity is defined.
   */
  activity: StreamActivity;
  onSwitch: (streamId: string) => void;
  onCreate: () => void;
  onRestore: (streamId: string) => void;
  onRename: (streamId: string, name: string) => void;
  onArchive: (streamId: string) => void;
  onDelete: (streamId: string) => void;
}

/**
 * One stream's activity: everything happening in its columns, as a single signal.
 *
 * Summed rather than maxed for `count` so a stream with three mentions across
 * three channels reads as busier than one with a single mention — though what
 * the badge actually renders is a dot either way, see `ActivityDot`.
 */
const rollUp = (stream: Stream, activity: StreamActivity): ColumnActivity => {
  let count = 0;
  let hasNew = false;
  for (const column of stream.columns) {
    const one = activity[column.id];
    if (!one) continue;
    count += one.count;
    hasNew = hasNew || one.hasNew;
  }
  return count === 0 && !hasNew ? IDLE : { count, hasNew };
};

/** "4 columns", "1 column", "Empty" — never "0 columns". */
const describe = (stream: Stream): string => {
  if (stream.columns.length === 0) return 'Empty';
  return stream.columns.length === 1 ? '1 column' : `${stream.columns.length} columns`;
};

/**
 * How long Delete has to be held, in ms.
 *
 * Long enough that it cannot happen by accident, which is the entire job: this
 * is the one stream verb with nothing behind it. Archive sits directly above and
 * is one click precisely because it is reversible, so the gap in effort between
 * the two rows is the thing that stops the wrong one being taken.
 *
 * Down from the reference implementation's 2000. Two seconds is right for a
 * standalone destructive button you have navigated to on purpose; inside a menu
 * that is already open it is long enough to start reading as unresponsive — you
 * have committed, and the control is still deliberating. This is past the point
 * where a slip or a stuck mouse button could reach it and no further.
 */
const HOLD_MS = 1500;

/**
 * How long the fill takes to retreat when you let go.
 *
 * Asymmetric on purpose. The press is deliberately slow, but abandoning it
 * should feel instant — a release that unwound over two seconds would read as
 * the control still thinking about it.
 */
const RELEASE_MS = 200;

/** The meta column on the right of a row. `text-xs`, like the rest of the app. */
const Meta = ({ children }: { children: string }): ReactElement => (
  <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>{children}</span>
);

Meta.displayName = 'Meta';

/**
 * Which stream you are in, the way to any other, and what you can do to this one.
 *
 * In the header's title group rather than beside the stream's verbs, because it
 * is not a verb: the group on the right changes the stream, this says *which*
 * stream. It is the one piece of the header that answers "where am I".
 *
 * Rename and delete both resolve inside the menu rather than opening something.
 * A dialog launched from a Radix menu item has to be sequenced around the
 * menu's own close-and-restore-focus, and for a single text field and a single
 * confirmation that is more machinery than either is worth. Rename swaps its
 * row for an input; delete asks once, in place.
 */
const StreamSwitcher = ({
  layout,
  activity,
  onSwitch,
  onCreate,
  onRestore,
  onRename,
  onArchive,
  onDelete,
}: StreamSwitcherProps): ReactElement => {
  const live = liveStreams(layout);
  const archived = archivedStreams(layout);
  const current = layout.streams.find(stream => stream.id === layout.activeStreamId);

  // Controlled, only so the transient states below can be cleared on close. A
  // menu that reopens mid-hold on the delete row is remembering something the
  // user already walked away from.
  const [open, setOpen] = useState(false);
  /**
   * Whether the delete row is being held down right now.
   *
   * The hold is the confirmation — there is no armed state and no second click.
   * See the row itself for why.
   */
  const [holding, setHolding] = useState(false);

  /**
   * The name being edited, or null when not renaming.
   *
   * Held here rather than inside the menu because the field it drives *is* the
   * heading — picking Rename closes the menu and turns the title into an input
   * in place. A row that becomes a text field while the menu stays open is the
   * shape this started as, and it reads as the menu glitching: menus are lists
   * of things you pick, and one of the rows quietly stopping being pickable is
   * not a state anyone expects. Renaming a thing by typing over its own title
   * is what every other app does, and there is no reason to be the exception.
   */
  const [renaming, setRenaming] = useState<string | null>(null);
  /**
   * Read in `onCloseAutoFocus`, which fires before the re-render that swaps the
   * trigger out. Radix returns focus to the trigger on close; the trigger is
   * about to stop existing, and its focus call lands after the input's own
   * `autoFocus` — so without this the field opens already blurred.
   */
  const enteringRename = useRef(false);

  const close = (): void => {
    setOpen(false);
    setHolding(false);
  };

  const beginRename = (): void => {
    enteringRename.current = true;
    setRenaming(current?.name ?? '');
    close();
  };

  const commitRename = (): void => {
    if (current && renaming !== null) onRename(current.id, renaming);
    setRenaming(null);
  };

  // The last live stream cannot leave: archiving or deleting it would put the
  // screen in a state with no stream to show and no control that makes one,
  // since this menu is the only way to a new stream.
  const soleStream = live.length <= 1;

  // A dot on the trigger means "something is happening in a stream you are not
  // looking at". Without it the menu is the only place that signal exists, and
  // nobody opens a menu to find out whether they should have opened it — the
  // stream you archived your attention away from would go quiet for good.
  const elsewhere = live
    .filter(stream => stream.id !== layout.activeStreamId)
    .reduce<ColumnActivity>(
      (total, stream) => {
        const one = rollUp(stream, activity);
        return { count: total.count + one.count, hasNew: total.hasNew || one.hasNew };
      },
      { count: 0, hasNew: false },
    );

  /**
   * Renaming: the title, as an editable field, in the title's own place.
   *
   * Typography, padding and the `-ml-1.5` all match the trigger exactly, so the
   * glyphs do not move when the heading becomes a field — the only change is
   * that it is now filled and ringed, which is what says it is editable.
   *
   * `size` rather than a fixed width, so the field hugs a short name instead of
   * reserving sixteen rems for "Q3". Clamped at both ends: too narrow to type
   * into is as bad as too wide to belong in a header.
   */
  if (renaming !== null) {
    return (
      <input
        autoFocus
        value={renaming}
        onChange={event => setRenaming(event.target.value)}
        onFocus={event => event.currentTarget.select()}
        onBlur={commitRename}
        onKeyDown={event => {
          // The screen binds single keys over the stream. Without this, naming a
          // stream "Overview" would trip half of them on the way through.
          event.stopPropagation();
          if (event.key === 'Enter') commitRename();
          // Escape abandons the edit. It cannot fall through to the screen's
          // own Escape, which would unwind the palette or leave focus mode.
          if (event.key === 'Escape') {
            event.preventDefault();
            setRenaming(null);
          }
        }}
        size={Math.min(26, Math.max(10, renaming.length + 1))}
        placeholder='Stream name'
        aria-label='Stream name'
        className={cn(
          '-ml-1.5 w-auto max-w-[16rem] shrink-0 rounded-lg px-1.5 py-0.5',
          // Matches the trigger below — see the note there for why this dropped
          // out of the app's title size.
          'text-[13px] font-semibold text-foreground',
          'bg-foreground/[0.06] outline-none ring-1 ring-inset ring-border',
          'placeholder:font-normal placeholder:text-muted-foreground',
        )}
        data-streams-input
        data-track-category='Streams'
        data-track-name='RenameStreamInput'
      />
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={next => (next ? setOpen(true) : close())}>
      {/* Tooltip outside, trigger inside. Reversed, `DropdownMenuTrigger
          asChild` hands its props and ref to `Tooltip` — a plain component that
          forwards neither — so the button never became a trigger and the menu
          stopped opening. This order chains two Radix slots, which is what they
          are built to do. */}
      <Tooltip content='Switch stream'>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            // `min-w-0` and a cap, so a stream called something long truncates
            // rather than pushing the stream nav and the verbs off the right edge.
            //
            // `-ml-1.5` cancels the button's own left padding. The padding is
            // there to give the hover fill something to be — a title with a fill
            // clamped to its glyphs reads as a highlighter, not a button — but it
            // would also start the text six pixels right of where the old
            // `Streams` label sat, and that position is not arbitrary:
            // `HEADER_INSET` is derived so the header's first glyph lands on the
            // same vertical as the first column's icon. The negative margin keeps
            // the text on that line and lets the fill bleed left of it.
            className={cn(
              '-ml-1.5 flex min-w-0 max-w-[16rem] shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5',
              // Smaller than the app's title size, and deliberately below the
              // per-column titles now: the stream name sits once, at the top, and
              // reads it in that context; a column title has to hold its own
              // fifteen columns deep in the strip with nothing beside it to say
              // "you are still in the stream called X" — so it is the one that
              // needs the weight. `13px` matches what a column title used to be,
              // which is the size swap this pair went through.
              'text-[13px] font-semibold text-foreground',
              'outline-none transition-colors',
              // The alpha hover the header's icon buttons use, for the reason
              // given at `STREAM_ACTION_IDLE`: this bar can sit on a wallpaper, and
              // a solid grey swatch over a gradient reads as a patch stuck to the
              // screen rather than as the control lighting up. Fill only — the
              // text is already at full strength, so there is no colour to gain.
              'hover:bg-foreground/[0.06]',
              'data-[state=open]:bg-foreground/[0.06]',
              'focus-visible:ring-2 focus-visible:ring-ring',
            )}
            aria-label={`Stream: ${current?.name ?? 'none'}. Switch stream`}
            data-track-category='Streams'
            data-track-name='OpenStreamSwitcher'
          >
            <span className='truncate'>{current?.name ?? 'Stream'}</span>
            <ActivityDot activity={elsewhere} />
            {/* The two-way chevron, not a plain down one. A single caret says
                "this opens downward", which every menu in the app already says;
                this control *swaps* what the screen is showing between a set of
                peers, and the up-and-down pair is the mark that means exactly
                that. It is what a combobox wears for the same reason.

                Never shrinks: a chevron that collapses to nothing under a long
                name takes the affordance with it. Sized to the title text beside
                it, which is smaller now that the per-column titles carry the
                stream's old heading size instead. */}
            <ChevronSortVertical size={14} className='shrink-0 opacity-60' aria-hidden />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>

      <DropdownMenuContent
        align='start'
        className='w-56 origin-[var(--radix-dropdown-menu-content-transform-origin)]'
        // Only when Rename was the reason we closed. Every other close should
        // hand focus back to the trigger as usual; this one must not, because
        // the trigger is being replaced by the field that wants it.
        onCloseAutoFocus={event => {
          if (!enteringRename.current) return;
          enteringRename.current = false;
          event.preventDefault();
        }}
      >
        {live.map(stream => {
          const own = rollUp(stream, activity);
          const active = stream.id === layout.activeStreamId;
          return (
            <DropdownMenuItem
              key={stream.id}
              onSelect={() => onSwitch(stream.id)}
              className='gap-2'
              data-track-category='Streams'
              data-track-name='SwitchStream'
            >
              {/* A fixed slot whether or not the check is in it, so every name
                  in the list starts on the same vertical. */}
              <span className='flex size-3.5 shrink-0 items-center justify-center'>
                {active && <CheckTickSingle size={14} aria-hidden />}
              </span>
              <span className='min-w-0 flex-1 truncate'>{stream.name}</span>
              <ActivityDot activity={own} />
              <Meta>{describe(stream)}</Meta>
            </DropdownMenuItem>
          );
        })}

        {/* Archived streams sit with the stream list, not with the verbs: this is
            still "which stream", just the ones you cannot currently see. Only
            when there is something in it — an "Archived (0)" row is a promise
            of a feature rather than a way into one. */}
        {archived.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className='gap-2'>
              <RotateLeft size={14} className='shrink-0' aria-hidden />
              <span className='flex-1'>Archived</span>
              <Meta>{String(archived.length)}</Meta>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className='w-56'>
              {archived.map(stream => (
                <DropdownMenuItem
                  key={stream.id}
                  onSelect={() => onRestore(stream.id)}
                  className='gap-2'
                  title={`Restore "${stream.name}"`}
                  data-track-category='Streams'
                  data-track-name='RestoreStream'
                >
                  <RotateLeft size={14} className='shrink-0' aria-hidden />
                  <span className='min-w-0 flex-1 truncate'>{stream.name}</span>
                  <Meta>{describe(stream)}</Meta>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSeparator />

        {/* The verbs, in the order you reach for them: make one, name it, put
            it away, throw it out. New stream leads because it is the only row
            that is not about the stream you are already in — and the only way to
            a second stream at all. */}
        <DropdownMenuItem
          onSelect={onCreate}
          className='gap-2'
          data-track-category='Streams'
          data-track-name='CreateStream'
        >
          <PlusDefault size={14} className='shrink-0' aria-hidden />
          <span className='flex-1'>New stream</span>
        </DropdownMenuItem>

        {/* Hands the edit to the heading and closes. The row stays a row. */}
        <DropdownMenuItem
          disabled={!current}
          onSelect={event => {
            event.preventDefault();
            beginRename();
          }}
          className='gap-2'
          data-track-category='Streams'
          data-track-name='RenameStream'
        >
          <PencilEdit size={14} className='shrink-0' aria-hidden />
          <span className='flex-1'>Rename</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={!current || soleStream}
          onSelect={() => current && onArchive(current.id)}
          className='gap-2'
          title={soleStream ? 'The last stream cannot be archived' : undefined}
          data-track-category='Streams'
          data-track-name='ArchiveStream'
        >
          <FolderArrowDown size={14} className='shrink-0' aria-hidden />
          <span className='flex-1'>Archive</span>
        </DropdownMenuItem>

        {/* Hold to delete.

            Archive is directly above and is one click, because it is reversible
            and the way back is a few rows up. This is not reversible, and what
            it destroys is not a document but an arrangement — the columns, the
            order, the widths, the thing you actually built. A click is the
            wrong amount of effort for that, and a confirm dialog is the wrong
            *kind*: it interrupts, and people learn to dismiss it without
            reading. Holding is effort that stays inside the gesture, is
            impossible to perform by accident, and can be abandoned at any point
            by simply letting go — the safety and the undo are the same motion.

            Technique from Emil Kowalski's hold-to-delete: a `clip-path` inset
            sweeping the fill open across `HOLD_MS`, and the transition's own
            completion — not a timer — is what fires the delete. One source of
            truth, so what you saw finish is exactly what ran. */}
        <DropdownMenuItem
          disabled={!current || soleStream}
          // Never selects. Click, Enter and Space all reach a menu item through
          // `onSelect`, and every one of them is the accident this row exists to
          // prevent, so the hold below is the only path to the verb.
          onSelect={event => event.preventDefault()}
          onPointerDown={event => {
            if (!current || soleStream) return;
            // Capture, so a hand that drifts a few pixels mid-hold keeps the
            // press alive. Without it `pointerleave` cancels on the smallest
            // wobble, and a two-second hold gives it plenty of chances.
            event.currentTarget.setPointerCapture(event.pointerId);
            setHolding(true);
          }}
          onPointerUp={() => setHolding(false)}
          onPointerCancel={() => setHolding(false)}
          // The keyboard path, and the same gesture: hold the key. `repeat`
          // guards against the browser's own key-repeat restarting the hold
          // every few tens of ms, which would leave the fill stuck at zero.
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            if (event.repeat || !current || soleStream) return;
            setHolding(true);
          }}
          onKeyUp={event => {
            if (event.key === 'Enter' || event.key === ' ') setHolding(false);
          }}
          onBlur={() => setHolding(false)}
          className='relative gap-2 overflow-hidden text-destructive focus:text-destructive'
          title={soleStream ? 'The last stream cannot be deleted' : undefined}
          data-track-category='Streams'
          data-track-name='DeleteStream'
        >
          {/* The fill. Decorative to a screen reader — the row's own label is
              what carries the meaning — but it is the only thing telling a
              sighted user how much longer to hold, which is why it is not
              disabled under reduced motion: it is not decoration moving on its
              own, it is a progress readout for a gesture the user is actively
              performing. Removing it would leave a button that does nothing for
              two seconds and then deletes something. */}
          <span
            aria-hidden
            className='pointer-events-none absolute inset-0 bg-destructive/20'
            style={{
              clipPath: holding ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
              transition: `clip-path ${holding ? HOLD_MS : RELEASE_MS}ms ${holding ? 'linear' : 'ease-out'}`,
            }}
            onTransitionEnd={event => {
              // Only the sweep *open* commits. Letting go runs the same property
              // back the other way and would otherwise fire on release — the
              // exact opposite of what the user just decided.
              if (event.propertyName !== 'clip-path' || !holding) return;
              setHolding(false);
              if (current) onDelete(current.id);
              close();
            }}
          />
          {/* Above the fill, so the label stays legible as it sweeps past.

              The label states the gesture and then stays put. It briefly swapped
              to "Keep holding…" mid-press, which is the fill's job — the sweep
              already says how much longer, and a label rewriting itself under a
              finger that is deliberately not moving reads as the row changing
              its mind. */}
          <DeleteDustbin01 size={14} className='relative shrink-0' aria-hidden />
          <span className='relative flex-1'>Hold to delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

StreamSwitcher.displayName = 'StreamSwitcher';

export default StreamSwitcher;
