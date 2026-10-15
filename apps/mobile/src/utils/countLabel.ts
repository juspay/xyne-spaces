/**
 * Numeric badge label, capped so a pill keeps a predictable width.
 *
 * This rule was written out seven times across the app; keep new badges pointed
 * here so they cap the same way.
 */
export const formatCountLabel = (count: number): string => (count > 99 ? '99+' : String(count));
