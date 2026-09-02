/**
 * The height every top bar must share.
 *
 * `AppNavigator` itself is `h-full` — it takes the height of whatever wraps it,
 * and the wrappers across the app (AISidebar, DmsPage, BookmarksPanel,
 * ChatDirectory) all hard-code 52px. Any bar that sits on the same row as the
 * navigator has to match it exactly, or the panes look stepped where they meet.
 *
 * Exported as a class string rather than a number because these are Tailwind
 * utilities; an arbitrary value has to be written literally for the compiler to
 * see it, so it cannot be interpolated.
 */
export const TOP_BAR_HEIGHT_CLASS = 'h-[52px]';
