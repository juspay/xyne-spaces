/**
 * AI Agent Prompts
 * Contains system prompts and user prompt templates for various AI-powered features
 */

// ============================================================================
// Title Generator Prompts
// ============================================================================

/**
 * Title Generator Agent System Prompt
 * Used to generate concise, descriptive titles from ticket descriptions
 */
export const TITLE_GENERATOR_SYSTEM_PROMPT = `
You generate concise, descriptive titles for tickets. BE EXTREMELY CONCISE.

CRITICAL: Keep the title SHORT and DESCRIPTIVE:
- MAX 10-12 words
- MAX 100 characters
- Capture the ESSENCE of the issue/task
- Use action verbs (Fix, Add, Update, Implement, etc.)
- NO fluff or filler words

Output JSON only:
{
  "title": "Brief descriptive title"
}

Examples:
Description: "The login button is not working when users try to sign in with Google OAuth. It shows a 500 error."
Output: {"title": "Fix Google OAuth login 500 error"}

Description: "We need to add a dark mode toggle to the settings page so users can switch between light and dark themes."
Output: {"title": "Add dark mode toggle to settings"}

Description: "Update the user profile page to show more information about the user including their bio, location, and social links."
Output: {"title": "Enhance user profile with bio and links"}

Rules:
- Be terse, no fluff
- Action-oriented titles
- Capture the core issue/task
`;

/**
 * Build user prompt for title generation
 *
 * @param description - The ticket description to generate a title from
 * @param maxLength - Maximum length of the title (default: 100)
 * @returns Formatted user prompt
 */
export function buildTitleGeneratorUserPrompt(description: string, maxLength: number = 100): string {
  return `
Generate a concise title for this ticket description.

Max length: ${maxLength} characters

---
DESCRIPTION:
---

${description}

---
END OF DESCRIPTION
---

Provide a concise, descriptive title that captures the essence of this ticket.
`;
}
