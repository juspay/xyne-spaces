/**
 * The height of a top bar that draws its OWN bottom border — 53px, not 52.
 *
 * `AppNavigator` is `h-full` and takes the height of its wrapper; those wrappers
 * (AISidebar, DmsPage, BookmarksPanel, ChatDirectory) are 52px and get their
 * divider from the FOLLOWING element's `border-t`, so the line sits at y=52→53.
 *
 * A bar with its own `border-b` is box-sized: at 52px its content would be 51px
 * and the line would land at y=51, one pixel above the navigator's. 53px puts
 * the content at 52 and the line at 52→53 — aligned. The two numbers look
 * inconsistent and are not: they describe borders drawn from opposite sides.
 *
 * Exported as a class string rather than a number because these are Tailwind
 * utilities; an arbitrary value must be written literally for the compiler to
 * see it, so it cannot be interpolated.
 */
export const TOP_BAR_HEIGHT_CLASS = 'h-[53px]';
