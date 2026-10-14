/**
 * UI model for the Xyne Desks channel list.
 * Zero/shared rows are mapped into this - list components never speak schema.
 */
export interface DeskListItemData {
  id: string;
  name: string;
  isJoined: boolean;
  /** EMAIL / SLACK / APP - useful later for badges */
  type: string;
  /** Optional channel description for the subtitle line. */
  description: string | null;
}
