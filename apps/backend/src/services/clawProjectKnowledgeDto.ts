/**
 * The browser's view of a project knowledge row.
 *
 * Kept free of imports on purpose: clawAgentService reaches the database client
 * and the Zero audit config, which a unit test cannot load. The allow-list
 * below guards a leak, so it needs to stay testable on its own.
 */
export interface ClawChatProjectKnowledge {
  id: string;
  projectId: string;
  type: 'file' | 'kb_collection' | 'channel' | 'ticket' | 'canvas';
  refId: string;
  title: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
}

/** An interface shapes nothing at runtime, and the proxy forwards claw-auth's
 *  JSON verbatim — so `storagePath` (an internal bucket path), `orgId` and
 *  `addedByUserId` were all reaching the browser. Pick, never cast. */
export function toClawChatProjectKnowledge(row: unknown): ClawChatProjectKnowledge {
  const value = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(value['id'] ?? ''),
    projectId: String(value['projectId'] ?? ''),
    type: value['type'] as ClawChatProjectKnowledge['type'],
    refId: String(value['refId'] ?? ''),
    title: String(value['title'] ?? ''),
    mimeType: typeof value['mimeType'] === 'string' ? value['mimeType'] : null,
    size: typeof value['size'] === 'number' ? value['size'] : null,
    createdAt: String(value['createdAt'] ?? ''),
  };
}
