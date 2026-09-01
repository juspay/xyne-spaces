/**
 * AI Agent Prompts
 * Contains system prompts and user prompt templates for various AI-powered features
 */

import { ClassifiableTicketTypes, BaseTicketType, type ClassifiableTicketType } from '@xyne/shared';

// ============================================================================
// Title Generator Prompts
// ============================================================================

function buildTicketTypeInstructions(): string {
  const typeDescriptions: Record<ClassifiableTicketType, string> = {
    [BaseTicketType.Fix]: 'Bug reports, errors, broken functionality, issues, crashes, something not working',
    [BaseTicketType.Feature]: 'New features, enhancements, additions, improvements, new functionality',
    [BaseTicketType.Story]: 'User stories (deliverable product work), typically feature-sized, can be planned in sprints',
    [BaseTicketType.Hotfix]: 'Critical/urgent production issues, outages, blockers requiring immediate attention',
    [BaseTicketType.Epic]: 'Large initiative or body of work spanning multiple features or sprints',
  };

  return ClassifiableTicketTypes.map((type: ClassifiableTicketType) => `- "${type}": ${typeDescriptions[type] || ''}`).join('\n');
}

function buildTicketTypeOptions(): string {
  return ClassifiableTicketTypes.map((t: ClassifiableTicketType) => `"${t}"`).join(' | ');
}

/**
 * Title Generator Agent System Prompt
 * Used to generate concise, descriptive titles from ticket descriptions
 */
export function getTitleGeneratorSystemPrompt(): string {
  return `
You generate concise, descriptive titles for tickets AND classify the ticket type. BE EXTREMELY CONCISE.

CRITICAL: Keep the title SHORT and DESCRIPTIVE:
- MAX 10-12 words
- MAX 100 characters
- Capture the ESSENCE of the issue/task
- Use action verbs (Fix, Add, Update, Implement, etc.)
- NO fluff or filler words

TICKET TYPE CLASSIFICATION:
${buildTicketTypeInstructions()}

Output JSON only:
{
  "title": "Brief descriptive title",
  "ticketType": ${buildTicketTypeOptions()}
}

Examples:
Description: "The login button is not working when users try to sign in with Google OAuth. It shows a 500 error."
Output: {"title": "Fix Google OAuth login 500 error", "ticketType": "Fix"}

Description: "We need to add a dark mode toggle to the settings page so users can switch between light and dark themes."
Output: {"title": "Add dark mode toggle to settings", "ticketType": "Feature"}

Description: "Production is down! Users cannot checkout and we're losing revenue every minute."
Output: {"title": "Fix production checkout outage", "ticketType": "Hotfix"}

Description: "Update the user profile page to show more information about the user including their bio, location, and social links."
Output: {"title": "Enhance user profile with bio and links", "ticketType": "Feature"}

Rules:
- Be terse, no fluff
- Action-oriented titles
- Capture the core issue/task
- Default to "Fix" if uncertain, use "Hotfix" only for critical/urgent issues
`;
}

/**
 * Build user prompt for title generation
 *
 * @param description - The ticket description to generate a title from
 * @param maxLength - Maximum length of the title (default: 100)
 * @returns Formatted user prompt
 */
export function buildTitleGeneratorUserPrompt(description: string, maxLength: number = 100): string {
  const ticketTypeOptions = ClassifiableTicketTypes.join(', ');
  return `
Generate a concise title and classify the ticket type for this ticket description.

Max length: ${maxLength} characters

---
DESCRIPTION:
---

${description}

---
END OF DESCRIPTION
---

Provide a concise, descriptive title and the appropriate ticket type (${ticketTypeOptions}).
`;
}

// ============================================================================
// Description Generator Prompts
// ============================================================================

/**
 * Description Generator Agent System Prompt
 * Produces a single-paragraph, information-rich ticket description from raw
 * context (emails, chat transcripts, user notes).
 */
export function getDescriptionGeneratorSystemPrompt(): string {
  return `
You generate ONE-PARAGRAPH ticket descriptions that summarize the source content with MAXIMUM useful information.

OBJECTIVE:
- Produce ONE paragraph of flowing prose that captures EVERY actionable fact from the input.
- Include: what happened, who/what is affected, where (service/surface/environment), when (timestamps), why (root cause if stated), errors & codes quoted verbatim, reproduction steps inline, URLs/IDs/ticket numbers, expected vs. actual behavior, workarounds tried.
- Strip ONLY noise: greetings, sign-offs, signatures, legal disclaimers, "thanks in advance", quoted reply history, forwarded headers (From:/Sent:/To:/Subject: chains).
- Neutral, factual tone — rewrite first-person narration into third-person ("I tried…" → "User tried…").

RULES:
- ONE paragraph only. No section labels (NO "Summary:", "Context:", "Steps:"). No headings, no bullets, no numbered lists, no markdown.
- Write as coherent prose with normal punctuation; sequence details logically (problem → context → evidence → attempted fixes).
- Preserve literal strings (error messages, codes, URLs, stack fragments) in single quotes.
- Scale to input: a one-line input yields one sentence; a long email yields a dense multi-sentence paragraph. Do not pad sparse inputs; do not drop details from rich inputs.
- Max ~1500 characters. Prefer including a detail over truncating it.
- NEVER invent, infer, or speculate beyond what the input states.
- If the input is empty or unusable, return: "No description available."

Output JSON only:
{
  "description": "Plain-text single-paragraph description"
}

Examples:
Input: "Snabox is down"
Output: {"description": "Snabox service is down."}

Input: "hey team, login is broken!! i click the google button and get a 500, tried twice, happens in chrome on my mac. also tried incognito, same result. started around 10:30 IST. thanks -- Alice, Senior PM, Acme Inc."
Output: {"description": "User reports Google OAuth login returning a 500 error, starting around 10:30 IST. The issue is reproduced on Chrome on macOS, including in incognito mode, by clicking the 'Sign in with Google' button on the login page. Reproduced twice, both times yielding the same 500 response."}

Input: "Production checkout is DOWN. Users cannot pay. Getting 'PaymentGatewayTimeout' in logs since 14:02 UTC. Retry from client doesn't help. Payment provider confirmed their side is up. Affects all merchants."
Output: {"description": "Production checkout is down across all merchants and users cannot complete payment. Logs have shown 'PaymentGatewayTimeout' errors since 14:02 UTC. Client-side retries do not resolve the failure. The external payment provider has confirmed their systems are up, indicating the issue is on our side."}

Input: "Bug: dashboard charts showing stale data. Reported by finance team. Opened ticket last week (XYNE-1234). Filter 'last 7 days' returns data from a week before that. Browser cache cleared. Happens for multiple users."
Output: {"description": "Dashboard charts are returning stale data according to the finance team — the 'last 7 days' filter returns data from a week prior to the selected range. Reproduced for multiple users, and clearing the browser cache does not help. A prior ticket 'XYNE-1234' was opened for this last week."}

Input: ""
Output: {"description": "No description available."}
`;
}

/**
 * Build user prompt for description generation
 *
 * @param rawContext - Raw source text (email body, chat, note)
 * @param title - Optional title to bias the description
 * @param maxLength - Max length of the description (default: 1500)
 */
export function buildDescriptionGeneratorUserPrompt(
  rawContext: string,
  title?: string,
  maxLength: number = 1500,
): string {
  return `
Generate a single-paragraph ticket description from the context below.
Capture every actionable fact — problem, environment, errors, steps, IDs, timestamps.

Max length: ${maxLength} characters
${title ? `Working title: ${title}` : ''}

---
CONTEXT:
---

${rawContext}

---
END OF CONTEXT
---

Return JSON with a single "description" field — ONE paragraph of plain prose. No section labels. No bullets. Preserve every concrete detail from the input.
`;
}
