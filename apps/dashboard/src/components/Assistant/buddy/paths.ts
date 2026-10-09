import { LIMITS } from './constants';

/** What Buddy saw of one control, as plain data. */
export interface MenuItem {
  track: string;
  text: string;
  label: string;
  href?: string;
  use: 'click' | 'point';
}

/** A menu Buddy opened on screen during this request, and what was in it. */
export interface Peeked<V extends MenuItem> {
  opener: V;
  items: readonly MenuItem[];
}

/** An item inside a closed menu, reached by clicking its opener first. */
export interface HiddenTarget<V extends MenuItem> extends MenuItem {
  id: string;
  opener: V;
}

const keyOf = ({ track, text }: MenuItem): string => `${track}|${text}`;

/**
 * The items of the peeked menus as options: each label once, never one already on screen, and
 * no more than leaves the visible controls within LIMITS.options.
 */
export function hiddenTargets<V extends MenuItem>(
  visible: readonly V[],
  menus: readonly Peeked<V>[],
): HiddenTarget<V>[] {
  const onScreen = new Set(visible.map(keyOf));
  const labels = new Set<string>();
  const isNew = (item: MenuItem): boolean => {
    if (onScreen.has(keyOf(item)) || labels.has(item.label)) return false;
    labels.add(item.label);
    return true;
  };
  return menus
    .flatMap(({ opener, items }) =>
      items.filter(isNew).map(item => ({
        ...item,
        label: `${item.label} (via "${opener.text}")`,
        opener,
      })),
    )
    .slice(0, Math.max(0, LIMITS.options - visible.length))
    .map((target, i) => ({ ...target, id: `h${i}` }));
}
