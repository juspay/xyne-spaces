/**
 * The ack reaction says "heard you" before any text comes back. One emoji for
 * every message says only that; one that matches what was asked says it while
 * showing the request landed as the sender meant it.
 *
 * Deliberately a keyword table and not a model call: the ack's whole value is
 * that it arrives instantly, and a round trip to pick an emoji would cost more
 * than the emoji is worth. An admin who set their own reaction gets that one
 * unchanged — they picked it on purpose.
 */
import { DEFAULT_ACK_REACTION } from "./const.js";

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // Ordered: a problem or a named work object beats the generic verb around
  // it, so "hi, the login is broken" acks as a bug and not as a greeting.
  [/\b(urgent|asap|blocker|blocked|immediately|right now)\b/i, "\u{26A1}"], // ⚡
  [/\b(bug|error|broken|crash(ed|ing)?|fail(s|ed|ing|ure)?|not working|down|outage)\b/i, "\u{1F41B}"], // 🐛
  [/\b(security|vulnerab|access|permission|credential|token|secret|auth)\w*/i, "\u{1F510}"], // 🔐
  [/\b(deploy|ship|rollout|roll out|rollback|publish)\w*|\brelease\b(?! notes)/i, "\u{1F680}"], // 🚀
  [/\b(test|tests|testing|testcase|unit test|e2e|regression)\b/i, "\u{1F9EA}"], // 🧪
  [/\b(review|pr|pull request|merge|diff|approve this)\b/i, "\u{1F9D0}"], // 🧐
  [/\b(ticket|jira|issue|backlog|sprint|epic|assign)\w*/i, "\u{1F3AB}"], // 🎫
  [/\b(meeting|schedule|calendar|remind|deadline|tomorrow|standup)\w*/i, "\u{1F4C5}"], // 📅
  [/\b(call|zoom|huddle|dial|conference)\b/i, "\u{1F4DE}"], // 📞
  [/\b(email|mail|notify|inbox|reply to)\b/i, "\u{1F4E7}"], // 📧
  [/\b(invoice|budget|cost|pricing|revenue|payment|spend)\w*/i, "\u{1F4B0}"], // 💰
  [/\b(metric|report|analytic|chart|graph|dashboard|numbers|stats)\w*/i, "\u{1F4CA}"], // 📊
  [/\b(database|db|sql|query|migration|schema|table)\b/i, "\u{1F5C4}\u{FE0F}"], // 🗄️
  [/\b(design|ui|ux|figma|mockup|wireframe|layout)\b/i, "\u{1F3A8}"], // 🎨
  [/\b(write|draft|summar|rephrase|rewrite|compose)\w*/i, "\u{270D}\u{FE0F}"], // ✍️
  [/\b(doc|docs|document|pdf|spec|readme|notes|policy)\w*/i, "\u{1F4C4}"], // 📄
  [/\b(debug|fix|patch|repair|troubleshoot|investigate)\w*/i, "\u{1F527}"], // 🔧
  [/\b(refactor|implement|code|function|script|api|endpoint)\w*/i, "\u{1F4BB}"], // 💻
  [/\b(delete|remove|clean ?up|archive|purge)\w*/i, "\u{1F5D1}\u{FE0F}"], // 🗑️
  [/\b(translate|translation)\b/i, "\u{1F310}"], // 🌐
  [/\b(create|build|make|generate|set ?up|add a|new)\b/i, "\u{2728}"], // ✨
  [/\b(find|search|look ?up|where is|list|show me|fetch)\b/i, "\u{1F50D}"], // 🔍
  [/\b(approve|approval|sign ?off|confirm)\w*/i, "\u{2705}"], // ✅
  [/^\s*(hi|hey|hello|good (morning|afternoon|evening))\b/i, "\u{1F44B}"], // 👋
  [/\b(thanks|thank you|thx|cheers)\b/i, "\u{1F64F}"], // 🙏
  [/^\s*(what|why|how|when|who|can you|could you|should i)\b|\?\s*$/i, "\u{1F914}"], // 🤔
];

/** The emoji to acknowledge this message with. `configured` wins whenever the
 *  admin has chosen something other than the default. */
export function pickAckReaction(text: string, configured: string): string {
  if (configured !== DEFAULT_ACK_REACTION) return configured;
  const body = text.trim();
  if (!body) return configured;
  for (const [pattern, emoji] of RULES) {
    if (pattern.test(body)) return emoji;
  }
  return configured;
}
