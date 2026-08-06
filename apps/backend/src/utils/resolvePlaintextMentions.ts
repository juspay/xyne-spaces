/**
 * Resolve bare "@Display Name" / "@email" references in plain-text (markdown)
 * message content into real Xyne mention spans.
 *
 * WHY THIS EXISTS
 * ----------------
 * A mention only notifies / renders as a pill when the stored HTML carries a
 * structured entity — `<span data-mention-type="user" data-user-id="…">` (see
 * `mentionParser.ts` / `mentionUtils.ts`). Human-composed messages get this span
 * from the TipTap editor. But messages posted programmatically as markdown/text
 * — most importantly Digital Twin approvals routed through
 * `chatController.sendMessage` — contain only literal `@Anurag Dwivedi` text,
 * which matches no entity and is therefore never turned into a tag.
 *
 * This resolver closes that gap: it rewrites `@<name>` / `@<email>` tokens into
 * the canonical mention span so notifications fire and the dashboard renders a pill.
 *
 * SAFETY
 * ------
 * Resolution is scoped to the target channel's participants only, so it cannot
 * mis-tag an arbitrary workspace user, and it can only ever notify someone who is
 * already in the conversation. Matching is:
 *   - exact (case-insensitive) on email, and exact on full display name,
 *   - longest-name-first (so "@Anurag Dwivedi" wins over a hypothetical "@Anurag"),
 *   - bounded so "@word" that is not a participant is left untouched,
 *   - bot / app participants are excluded, so a twin can never tag another
 *     bot/twin by name and start a twin-to-twin loop.
 * Unresolved tokens are returned verbatim.
 */

import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { encodeHtmlAttr } from '@/utils/contentUtils';
import { logger } from '@/utils/logger';

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtmlText(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface MentionCandidate {
  userId: string;
  userName: string;
  userEmail: string;
}

function buildMentionSpan(c: MentionCandidate): string {
  // Mirrors the canonical mention span emitted elsewhere (see slack/controller.ts)
  // so that extractUserMentions()/hasMentions() recognise it downstream.
  return (
    `<span class="chat-input-mention" data-mention="" data-mention-type="user" ` +
    `data-user-id="${encodeHtmlAttr(c.userId)}" data-username="${encodeHtmlAttr(c.userName)}">` +
    `@${escapeHtmlText(c.userName)}</span>`
  );
}

/**
 * Rewrite bare @name / @email tokens in `content` into mention spans, scoped to
 * the participants of `channelId`. Returns `content` unchanged on any failure or
 * when there is nothing to resolve.
 */
export async function resolvePlaintextMentions(
  content: string,
  channelId: string
): Promise<string> {
  if (!content || !content.includes('@') || !channelId) return content;

  try {
    const participantRepo = new ChannelParticipantRepository();
    const [participants, botUserIds] = await Promise.all([
      participantRepo.getChannelParticipantsWithUserDetails(channelId),
      participantRepo.getBotAppParticipantUserIds(channelId),
    ]);

    if (participants.length === 0) return content;

    const botIdSet = new Set(botUserIds);
    const humanParticipants = participants.filter((p) => !botIdSet.has(p.userId));
    if (humanParticipants.length === 0) return content;

    const byEmail = new Map<string, MentionCandidate>();
    const byName = new Map<string, MentionCandidate>();
    for (const p of humanParticipants) {
      const candidate: MentionCandidate = {
        userId: p.userId,
        userName: p.userName,
        userEmail: p.userEmail,
      };
      if (p.userEmail) byEmail.set(p.userEmail.toLowerCase(), candidate);
      if (p.userName) {
        const key = p.userName.toLowerCase();
        // First writer wins; ambiguous duplicate display names are left unresolved
        // rather than tagging the wrong person.
        if (byName.has(key)) byName.set(key, null as unknown as MentionCandidate);
        else byName.set(key, candidate);
      }
    }

    // Collect resolved spans behind placeholders so a span we insert can never be
    // re-matched by a later pass.
    const slots: string[] = [];
    const placeholder = (span: string): string => `\u0000${slots.push(span) - 1}\u0000`;

    let result = content;

    // Pass 1: @email (exact, unambiguous).
    const emailRe = /@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
    result = result.replace(emailRe, (full, email: string) => {
      const c = byEmail.get(email.toLowerCase());
      return c ? placeholder(buildMentionSpan(c)) : full;
    });

    // Pass 2: @Display Name — one alternation of participant names, longest first,
    // so the greediest full-name match wins and a trailing word can't be swallowed.
    const names = [...byName.keys()]
      .filter((k) => byName.get(k)) // drop ambiguous (null) entries
      .sort((a, b) => b.length - a.length);
    if (names.length > 0) {
      const alt = names
        .map((k) => byName.get(k)!.userName)
        .map(escapeRegExp)
        .join('|');
      // Require a non-name boundary after the match so "@Anu" won't match "@Anurag".
      const nameRe = new RegExp(`@(${alt})(?![\\w@.])`, 'gi');
      result = result.replace(nameRe, (full, name: string) => {
        const c = byName.get(name.toLowerCase());
        return c ? placeholder(buildMentionSpan(c)) : full;
      });
    }

    if (slots.length === 0) return content;

    return result.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => slots[Number(i)]);
  } catch (error) {
    // Never block message delivery on mention resolution.
    logger.warn(`[resolvePlaintextMentions] failed for channel ${channelId}: ${String(error)}`);
    return content;
  }
}
