/** What the focused card's tool row shows left of mic / Send. */
export type ToolRowLeading = 'tools' | 'formatting' | 'none';

/**
 * Aa swaps the tools for the formatting strip. While dictating, the row gives
 * its width to the dictation controls: neither the tools nor the strip fit
 * beside them in the thread card, and typing tools have nothing to act on yet.
 */
export function toolRowLeading(state: { formatting: boolean; dictating: boolean }): ToolRowLeading {
  if (state.dictating) return 'none';
  return state.formatting ? 'formatting' : 'tools';
}
