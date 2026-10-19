/**
 * Notes: turns a surface answered itself (Buddy acting on the Spaces screen),
 * saved as finished messages so they show in the chat history. No run reads
 * them, so they never reach the agent's session.
 */

export const NOTE_TURNS_MAX = 5;
export const NOTE_TEXT_MAX_CHARS = 4_000;

export interface NoteTurn {
  request: string;
  reply: string;
}

/** The turns of a /notes body, or null when it is not a short list of non-empty request/reply pairs. */
export function noteTurnsOf(body: unknown): NoteTurn[] | null {
  const turns = (body as { turns?: unknown } | null)?.turns;
  if (!Array.isArray(turns) || turns.length === 0 || turns.length > NOTE_TURNS_MAX) return null;
  const parsed: NoteTurn[] = [];
  for (const turn of turns) {
    const { request, reply } = (turn ?? {}) as { request?: unknown; reply?: unknown };
    if (typeof request !== "string" || typeof reply !== "string") return null;
    const [said, answered] = [request.trim(), reply.trim()];
    if (!said || !answered) return null;
    if (said.length > NOTE_TEXT_MAX_CHARS || answered.length > NOTE_TEXT_MAX_CHARS) return null;
    parsed.push({ request: said, reply: answered });
  }
  return parsed;
}

/**
 * Where notes hang in the conversation's tree: the reply the caller is looking
 * at when it is one of the conversation's assistant rows, else the latest
 * reply, the parent a normal send takes (run-stream.ts). Either way the turn
 * after the notes stays on the same path and resumes the same session. Rows
 * are oldest first.
 */
export function noteParentId(
  rows: ReadonlyArray<{ id: string; role: string }>,
  requested?: unknown,
): string | null {
  const shown = typeof requested === "string" ? rows.find((row) => row.id === requested) : undefined;
  if (shown?.role === "assistant") return shown.id;
  return [...rows].reverse().find((row) => row.role === "assistant")?.id ?? null;
}

/** A reply still streaming would get the notes as its siblings: they wait until it has finished. */
export const replyRunning = (rows: ReadonlyArray<{ role: string; status: string }>): boolean =>
  rows.some((row) => row.role === "assistant" && row.status === "running");
