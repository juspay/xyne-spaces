import { batch, observable } from '@legendapp/state';

/** The surfaces an action can open, as opposed to navigate to. */
export type QuickActionSheet = 'create-dm' | 'instant-call';

type QuickActionSheetState = {
  /** The sheet on screen, or `null`. */
  current: QuickActionSheet | null;
  /**
   * Every sheet that has been opened at least once this session.
   *
   * Separate from `current` because the two answer different questions, and
   * a sheet needs both: `current` is whether it should be open, this is
   * whether it should exist. They are not the same moment — a sheet plays
   * its own close animation after `isOpen` goes false (`CreateDmDrawer`
   * holds itself rendered until its dismiss fires), so rendering on
   * `current` alone would tear it out as the close began and the animation
   * would never be seen.
   *
   * Appended when a sheet opens rather than derived, so nothing has to watch
   * `current` to keep it right.
   */
  mounted: QuickActionSheet[];
};

/**
 * Which shared sheet is open, and which have ever been.
 *
 * One observable rather than a piece of state per screen, because the sheets
 * are mounted once for the whole shell. Mounting them per screen would mean
 * as many copies as there are tabs — each with its own Zero queries and its
 * own bottom-sheet machinery — and a sheet that closed itself when you
 * switched tabs underneath it.
 *
 * Legend State and not React context: the shell renders the sheets and the
 * screens open them, so a context would have to sit above both and would
 * re-render the whole tab tree every time one opened.
 */
export const quickActionSheets$ = observable<QuickActionSheetState>({
  current: null,
  mounted: [],
});

export function openQuickActionSheet(sheet: QuickActionSheet): void {
  batch(() => {
    if (!quickActionSheets$.mounted.peek().includes(sheet)) {
      quickActionSheets$.mounted.push(sheet);
    }
    quickActionSheets$.current.set(sheet);
  });
}

/** Whether a sheet is in the tree, as a boolean a component can subscribe to. */
export function isQuickActionSheetMounted(sheet: QuickActionSheet): boolean {
  return quickActionSheets$.mounted.get().includes(sheet);
}

export function closeQuickActionSheet(): void {
  quickActionSheets$.current.set(null);
}
