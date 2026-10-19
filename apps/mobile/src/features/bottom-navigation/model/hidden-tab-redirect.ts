type HiddenTabRedirect = {
  /** Catalog id of the destination currently on screen. */
  activeId: string;
  /** Route currently on screen. */
  routeName: string;
  /** Catalog ids the bar is offering right now. */
  visible: readonly string[];
  /** What it was offering last time, or `null` on the first run. */
  previousVisible: readonly string[] | null;
  /** The tab a cold start lands on. */
  initialTab: string;
};

/**
 * Whether the bar should move the user off the destination they are on.
 *
 * Being on a hidden tab is only a problem when the user did not ask for it.
 * Hiding the tab you are standing on takes away its pill and its menu row, so
 * nothing leads back to it — worth leaving. Following a link to one is a
 * choice, and the bar still shows that tab's icon on the menu trigger, so it is
 * left alone. Redirecting on "is hidden" alone conflated the two and swallowed
 * every link to a hidden tab.
 */
export function shouldLeaveHiddenTab({
  activeId,
  routeName,
  visible,
  previousVisible,
  initialTab,
}: HiddenTabRedirect): boolean {
  if (routeName === '') return false;
  if (visible.includes(activeId)) return false;

  // A cold start lands on the initial tab whether or not it is still offered,
  // so that one arrival is not a choice either.
  if (previousVisible === null) return routeName === initialTab;

  return previousVisible.includes(activeId);
}
