import { useEffect } from 'react';

/**
 * Attribute marking a region as an F6 stop. The value is the human-readable
 * name announced when focus lands there.
 */
export const LANDMARK_ATTR = 'data-landmark';

const isTextEntry = (element: Element | null): boolean => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (element.isContentEditable) {
    return true;
  }
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/**
 * F6 / Shift+F6 cycles keyboard focus between the app's major regions.
 *
 * WCAG 2.1.1 (Keyboard) is satisfied by everything being Tab-reachable, but
 * "reachable" and "usable" are not the same thing: this app puts a nav rail, a
 * channel sidebar and the route content side by side, so reaching the message
 * list from the rail is dozens of Tab presses. F6 is the long-standing
 * platform convention for "next pane" (Windows, VS Code, Firefox, Slack) and
 * turns that into one keystroke.
 *
 * A region opts in with `data-landmark="<name>"`. Focus is put on the region
 * element itself, which must therefore carry `tabIndex={-1}`. The visible
 * focus ring from global.css is the feedback that the jump happened; the
 * region's accessible name is what a screen reader announces.
 *
 * Deliberately NOT bound to a modifier combo: F6 is unclaimed by browsers and
 * by this app's own shortcut catalog, so it cannot collide with a chord a user
 * already has muscle memory for.
 */
export const useLandmarkCycle = (): void => {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'F6' || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      // A text field may legitimately want the key; nothing in this app binds
      // F6 inside an editor today, but do not fight a future one.
      if (isTextEntry(document.activeElement) && event.defaultPrevented) {
        return;
      }

      const regions = Array.from(
        document.querySelectorAll<HTMLElement>(`[${LANDMARK_ATTR}]`),
      ).filter(region => region.offsetParent !== null || region === document.body);

      if (regions.length === 0) {
        return;
      }

      event.preventDefault();

      // Where are we now? The region containing focus, so repeated presses walk
      // forward from wherever the user actually is rather than from a counter
      // that drifts out of sync when they click somewhere.
      const active = document.activeElement;
      const currentIndex = regions.findIndex(
        region => region === active || region.contains(active),
      );

      const delta = event.shiftKey ? -1 : 1;
      const nextIndex =
        currentIndex < 0 ? 0 : (currentIndex + delta + regions.length) % regions.length;

      const target = regions[nextIndex];
      if (!target) {
        return;
      }
      target.focus();
      target.scrollIntoView({ block: 'nearest' });
    };

    document.addEventListener('keydown', handler);
    return (): void => document.removeEventListener('keydown', handler);
  }, []);
};
