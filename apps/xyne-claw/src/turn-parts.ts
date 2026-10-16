/**
 * The run's output as ordered parts — thinking, text and tool calls in the
 * order the model produced them, across every LLM call of the run. Sent to
 * claw-auth in `done.parts` and stored per assistant message, so the chat can
 * show the turn as a timeline instead of one reasoning blob, one tool list and
 * one answer string.
 *
 * Mirrors the `AssistantPart` shape in @xyne/shared (packages/shared/src/ai/
 * assistantParts.ts). claw keeps no runtime dependency on that package, so the
 * two move together by convention — change one, change the other.
 */

export type TurnPart =
  | { type: "reasoning"; id: string; text: string; startedAt?: string; endedAt?: string }
  | { type: "text"; id: string; text: string; superseded?: true }
  | { type: "tool"; id: string };

/** Cap per part so a runaway block can't bloat the stored message. */
const MAX_PART_CHARS = 200_000;

export class TurnParts {
  private parts: TurnPart[] = [];

  /** The id a streamed block is known by everywhere downstream. */
  static partId(llmCall: number, contentIndex: number | undefined): string {
    return `${llmCall}:${contentIndex ?? 0}`;
  }

  /** Append a thinking/text delta to its block, starting the block on first sight. */
  delta(type: "reasoning" | "text", partId: string, delta: string, at = new Date().toISOString()): void {
    if (!delta) return;
    const existing = this.parts.find((part) => part.id === partId && part.type === type);
    if (existing && existing.type !== "tool") {
      if (existing.text.length < MAX_PART_CHARS) existing.text += delta;
      return;
    }
    this.closeReasoning(at);
    this.parts.push(type === "reasoning" ? { type, id: partId, text: delta, startedAt: at } : { type, id: partId, text: delta });
  }

  /** A thinking block finished (pi `thinking_end`). */
  endReasoning(partId: string, at = new Date().toISOString()): void {
    const part = this.parts.find((p) => p.id === partId && p.type === "reasoning");
    if (part?.type === "reasoning" && !part.endedAt) part.endedAt = at;
  }

  /** A tool call started. Only the run's own calls are parts; a subagent's
   *  calls nest under theirs through `parentToolCallId`. */
  tool(toolCallId: string | undefined, at = new Date().toISOString()): void {
    if (!toolCallId || this.parts.some((part) => part.type === "tool" && part.id === toolCallId)) return;
    this.closeReasoning(at);
    this.parts.push({ type: "tool", id: toolCallId });
  }

  /**
   * The agent is about to be asked to rewrite its answer (e.g. to add the
   * citations it left out). The answer it just wrote — the text after its
   * last step — becomes a superseded draft, so the timeline shows only the
   * rewrite. Earlier narration between steps stays.
   */
  supersedeTrailingText(): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const part = this.parts[i]!;
      if (part.type !== "text") break;
      part.superseded = true;
    }
  }

  /** The finished list, with any open thinking closed. */
  finish(at = new Date().toISOString()): TurnPart[] {
    this.closeReasoning(at);
    return this.parts.map((part) => ({ ...part }));
  }

  /**
   * Make the timeline end in the answer that is actually delivered. The
   * delivered text is not always the model's last streamed text: citations are
   * sanitized, a `submit-response` tool may carry the answer, an empty reply is
   * rescued from pending responses. Text parts get the same `sanitize`; when
   * the trailing text is not the end of the delivered answer, it becomes a
   * superseded draft and the delivered answer is appended as the final part.
   */
  static alignFinalAnswer(
    parts: TurnPart[],
    finalText: string,
    sanitize: (text: string) => string = (text) => text,
  ): TurnPart[] {
    const out = parts.map((part) =>
      part.type === "text" && !part.superseded ? { ...part, text: sanitize(part.text) } : { ...part },
    );
    let start = out.length;
    while (start > 0 && out[start - 1]!.type === "text") start--;
    const trailing = out.slice(start).filter((part) => part.type === "text" && !part.superseded);
    const squash = (text: string): string => text.replace(/\s+/g, "");
    const trailingText = squash(trailing.map((part) => (part as { text: string }).text).join(""));
    const delivered = squash(finalText);
    if (trailingText && delivered.endsWith(trailingText)) return out;
    for (const part of trailing) (part as { superseded?: true }).superseded = true;
    if (delivered) out.push({ type: "text", id: "final", text: finalText });
    return out;
  }

  private closeReasoning(at: string): void {
    for (const part of this.parts) {
      if (part.type === "reasoning" && !part.endedAt) part.endedAt = at;
    }
  }
}
