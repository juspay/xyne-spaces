/**
 * A theme token's colour from `useCSSVariable`, narrowed to what icons take:
 * the SVG's own `currentColor` until the theme has resolved it.
 */
export const colorOf = (value: string | number | undefined): string =>
  typeof value === 'string' ? value : 'currentColor';
