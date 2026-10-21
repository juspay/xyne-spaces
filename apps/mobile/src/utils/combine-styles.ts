/**
 * Type helper that preserves the exact type of combined style objects
 * This ensures that VariantProps inference works correctly for each style
 */
type CombinedStyles<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K];
};

/**
 * Helper function to combine style objects with proper type inference
 * This preserves the exact types of each style object, including VariantProps
 * @example
 * const styles = combineStyles({
 *   root,
 *   item,
 *   content
 * });
 */
export function combineStyles<T extends Record<string, unknown>>(styles: T): CombinedStyles<T> {
  return styles as CombinedStyles<T>;
}
