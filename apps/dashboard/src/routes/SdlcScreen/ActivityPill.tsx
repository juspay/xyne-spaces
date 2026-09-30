import type { ReactElement } from 'react';
import { PhoneDefault } from '@xyne/icons';
import { InvitationResponse } from '@xyne/shared';
import { cn } from '../../utils/classNames';

/**
 * The calls in progress around one place: `own` were started on it, `inside` on
 * something under it — a file in one of its folders, however deep. The `Mine` counts
 * are the ones among them you are part of.
 */
export interface SdlcLiveCalls {
  own: number;
  inside: number;
  ownMine: number;
  insideMine: number;
}

/**
 * Whether you are part of a call going on, from your own participant row: asked and
 * not yet answered, or in it. Declining, leaving, missing it or a request to join
 * still waiting doesn't count.
 */
export function isPartOfCall(mine: { response?: string | null } | undefined): boolean {
  if (!mine) return false;
  return mine.response === null || mine.response === undefined || PART_OF_CALL.has(mine.response);
}
const PART_OF_CALL: ReadonlySet<string> = new Set<string>([
  InvitationResponse.INVITED,
  InvitationResponse.ACCEPTED,
]);

/**
 * Whether you were asked to a call, whatever you did then — a call list's Invited
 * mark and filter. A request to join doesn't count: nobody asked.
 */
export function wasInvitedToCall(mine: { response?: string | null } | undefined): boolean {
  return mine !== undefined && mine.response !== InvitationResponse.REQUESTED;
}

/**
 * What is going on in a place right now. The place a call was started on gets the pill
 * with its count; every folder above it, and its track, get a green dot, so a call deep
 * in the tree can be followed down from the root. The pill is solid when you are part
 * of any of its calls, reading "1/3" when you are in some but not all; light when
 * none are yours. The sidebar, where a track is the only
 * place shown, gives the track the pill for every call in it instead. Only calls for now;
 * chats join the pill as a second count.
 *
 * The pill is a button where it can open the place's discussions, a plain mark where it
 * sits inside another control (a sidebar row, a breadcrumb, an explorer row).
 */
export function ActivityPill(props: {
  live: SdlcLiveCalls | undefined;
  /** Counts the calls under the place in its pill too, and never shows the dot. */
  rollUp?: boolean;
  /** Where the calls are, for the label: "2 calls in progress in Compliance". */
  place: string;
  size?: 'sm' | 'md';
  /** Opens the place's discussions, where the calls are. */
  onClick?: () => void;
  trackName?: string;
  className?: string;
}): ReactElement | null {
  const pillCalls = (props.live?.own ?? 0) + (props.rollUp ? (props.live?.inside ?? 0) : 0);
  const pillMine = (props.live?.ownMine ?? 0) + (props.rollUp ? (props.live?.insideMine ?? 0) : 0);
  const dotCalls = props.rollUp ? 0 : (props.live?.inside ?? 0);
  if (pillCalls <= 0) {
    if (dotCalls <= 0) return null;
    const label = `${dotCalls} ${dotCalls === 1 ? 'call' : 'calls'} in progress inside ${props.place}`;
    return (
      <span
        role='img'
        className={cn('relative flex size-1.5 shrink-0', props.className)}
        title={label}
        aria-label={label}
      >
        <span className='absolute inline-flex size-full rounded-full bg-status-success opacity-60 animate-live-ping motion-reduce:hidden' />
        <span className='relative inline-flex size-full rounded-full bg-status-success' />
      </span>
    );
  }
  const small = props.size === 'sm';
  const yours = pillMine > 0;
  const label = `${pillCalls} ${pillCalls === 1 ? 'call' : 'calls'} in progress in ${props.place}${
    !yours
      ? ''
      : pillMine === pillCalls
        ? ` · you're in ${pillCalls === 1 ? 'it' : 'all of them'}`
        : ` · you're in ${pillMine}`
  }`;
  const className = cn(
    'inline-flex shrink-0 items-center gap-1 rounded-full font-semibold tabular-nums',
    // Solid when any are yours, so it reads as a chip on any row, a selected sidebar row
    // included; its text takes the page colour, as dark mode's success green is light.
    // Light when none are: something is going on there, but not for you.
    yours ? 'bg-status-success text-background' : 'bg-status-success/15 text-status-success',
    small ? 'h-4 px-1.5 text-[10.5px]' : 'h-5 px-2 text-[11px]',
    props.onClick &&
      cn(
        'relative z-10',
        yours
          ? 'transition-opacity hover:opacity-90'
          : 'transition-colors hover:bg-status-success/25',
      ),
    props.className,
  );
  const content = (
    <>
      {yours && pillMine < pillCalls ? (
        <span>
          {pillMine}
          <span className='opacity-70'>/{pillCalls}</span>
        </span>
      ) : (
        pillCalls
      )}
      <PhoneDefault size={small ? 10 : 12} aria-hidden='true' />
    </>
  );
  if (!props.onClick) {
    return (
      <span className={className} title={label} aria-label={label}>
        {content}
      </span>
    );
  }
  const open = props.onClick;
  return (
    <button
      type='button'
      onClick={event => {
        event.stopPropagation();
        open();
      }}
      title={`${label}. Open its discussions`}
      aria-label={`${label}. Open its discussions`}
      className={className}
      data-track-category='SdlcHub'
      data-track-name={props.trackName ?? 'ActivityPillOpened'}
      data-track-metadata={JSON.stringify({ calls: pillCalls, yours: pillMine })}
    >
      {content}
    </button>
  );
}
