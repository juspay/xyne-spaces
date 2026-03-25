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
    [BaseTicketType.Hotfix]: 'Critical/urgent production issues, outages, blockers requiring immediate attention',
    [BaseTicketType.Support]: 'General support requests, questions, non-urgent issues, user assistance',
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
