export interface OpenItemSummary {
  title: string;
  kind: string;
  url?: string;
  /** True for the one the reader is actually looking at. */
  active?: boolean;
}

export interface OpenWorkspaceState {
  /** What holds these items: a hub folder, a conversation's workspace. */
  container?: string;
  /**
   * Where new work belongs. A tool that creates something (a canvas, a note)
   * files it here rather than leaving it unplaced, so it lands where the reader
   * is actually working.
   */
  placement?: {
    channelId: string;
    folderId: string;
    folderName?: string;
  };
  items: OpenItemSummary[];
}

let state: OpenWorkspaceState | null = null;

/**
 * What the reader currently has open, published by whichever surface is on
 * screen and read when a turn is sent, so the agent answers about the thing in
 * front of them rather than the route they are on.
 */
export function publishOpenItems(next: OpenWorkspaceState | null): void {
  state = next && (next.items.length > 0 || next.placement) ? next : null;
}

export function readOpenItems(): OpenWorkspaceState | null {
  return state;
}
