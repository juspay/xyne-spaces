import type { ReleaseNotesGeneratorInput } from './release-notes-agent';

export const getReleaseNotesSystemPrompt = (categoryFocus?: string): string => {
  const categoryInstruction = categoryFocus
    ? `\n\nFOCUS: This batch contains ONLY ${categoryFocus} items. Generate notes for these items only, without any category headers.`
    : '';

  return `You are a technical writer creating user-friendly release notes for a software release.

Your task is to analyze pull request, ticket data, and team discussion context, then generate well-organized release notes in Markdown format.

Structure the release notes with these sections:
- ## 🔥 Hotfixes (if hotfix PRs are present - include all PRs from hotfix sub-tickets here)
- ## ✨ New Features
- ## 🐛 Bug Fixes  
- ## ⚡ Improvements

For each item, include:
1. A clear, concise title as ### Heading
2. An AI-generated summary explaining what this feature/fix does and why it matters (2-3 sentences, user-friendly)
3. Ticket reference with link (format: Ticket: XYNE-XXX)
4. POT video link if available (format: POT: Video)

Guidelines:
- Write in a professional, user-friendly tone
- Focus on what changed and why it matters to users
- Group related changes together
- Use the categorization: Hotfixes = PRs from hotfix sub-tickets, Features = new functionality, Fixes = bug resolutions, Improvements = enhancements
- Do NOT validate if hotfix PRs are actually critical - just include them in the hotfixes section as provided
- Do NOT add messages like "please let me know" or ask questions in the output - just generate the release notes
- Do NOT include a title or main heading (like "# Release Notes") - start directly with the category sections
- Do NOT include any actual URLs in the markdown - use placeholder text like [Ticket: XYNE-123], [POT: Video]
- The application will map these placeholders to actual links
${categoryInstruction}

Example format:
## 🔥 Hotfixes

### Critical Payment Gateway Fix
*Resolved a critical issue where payment transactions were failing for international cards due to incorrect currency conversion. This fix ensures all international payments are processed correctly.*

Ticket: XYNE-10500 | POT: Video

## ✨ New Features

### Host Mute Controls for Participants
Meeting hosts can now mute individual participants or all participants at once during calls. A 'Mute All' button appears in the Participants sidebar, giving hosts better control over meeting audio and helping manage disruptive participants.

Ticket: XYNE-9675 | POT: Video

### XyneAI Link Content Fetching
Users can paste Xyne Spaces links into XyneAI and the assistant will automatically fetch and analyze the linked content, enabling more contextual AI assistance.

Ticket: XYNE-10375 | POT: Video`;
};

export function buildReleaseNotesUserPrompt(input: ReleaseNotesGeneratorInput): string {
  let prompt = `Release: ${input.releaseTitle}\n\n`;

  if (input.categoryFocus) {
    prompt += `CATEGORY FOCUS: ${input.categoryFocus}\n\n`;
    prompt += `Generate release notes ONLY for ${input.categoryFocus} items. Do not include category headers in your response - just list the items directly.\n\n`;
  }

  if (input.releaseDescription) {
    prompt += `Release Description: ${input.releaseDescription}\n\n`;
  }

  if (input.conversationMessages && input.conversationMessages.length > 0) {
    prompt += `Team Discussion Context:\n`;
    prompt += `=======================\n\n`;

    for (const msg of input.conversationMessages.slice(0, 50)) {
      const date = new Date(msg.createdAt).toLocaleDateString();
      prompt += `[${date}] ${msg.senderName}: ${msg.content}\n`;
    }

    prompt += `\n`;
  }

  prompt += `Pull Requests and Tickets:\n`;
  prompt += `========================\n\n`;

  for (const pr of input.prs) {
    prompt += `${pr.title}\n`;

    if (pr.description) {
      const cleanDescription = pr.description
        .replace(/https?:\/\/[^\s]+/g, '[URL]')
        .replace(/\[.*?\]\(.*?\)/g, '[LINK]');
      prompt += `Description: ${cleanDescription}\n`;
    }

    if (pr.hasPotVideo) {
      prompt += `POT Video: Available\n`;
    }

    if (pr.ticketXyneId) {
      prompt += `Linked Ticket: ${pr.ticketXyneId}\n`;
      if (pr.ticketTitle) {
        prompt += `Ticket Title: ${pr.ticketTitle}\n`
      }
      if (pr.ticketDescription) {
        const cleanTicketDesc = pr.ticketDescription
          .replace(/https?:\/\/[^\s]+/g, '[URL]')
          .replace(/\[.*?\]\(.*?\)/g, '[LINK]');
        prompt += `Ticket Description: ${cleanTicketDesc}\n`;
      }
    }

    prompt += `\n`;
  }

  // Add hotfix PRs section if present
  if (input.hotfixPRs && input.hotfixPRs.length > 0) {
    prompt += `\n🔥 Hotfix Pull Requests:\n`;
    prompt += `========================\n\n`;
    prompt += `The following PRs are from hotfix sub-tickets:\n\n`;

    for (const pr of input.hotfixPRs) {
      prompt += `${pr.title}\n`;

      if (pr.description) {
        const cleanDescription = pr.description
          .replace(/https?:\/\/[^\s]+/g, '[URL]')
          .replace(/\[.*?\]\(.*?\)/g, '[LINK]');
        prompt += `Description: ${cleanDescription}\n`;
      }

      if (pr.hasPotVideo) {
        prompt += `POT Video: Available\n`;
      }

      if (pr.ticketXyneId) {
        prompt += `Linked Ticket: ${pr.ticketXyneId}\n`;
        if (pr.ticketTitle) {
          prompt += `Ticket Title: ${pr.ticketTitle}\n`
        }
        if (pr.ticketDescription) {
          const cleanTicketDesc = pr.ticketDescription
            .replace(/https?:\/\/[^\s]+/g, '[URL]')
            .replace(/\[.*?\]\(.*?\)/g, '[LINK]');
          prompt += `Ticket Description: ${cleanTicketDesc}\n`;
        }
      }

      prompt += `\n`;
    }
  }

  prompt += `\nGenerate release notes in Markdown format as specified in your instructions. Use the exact format with ### headings for each item and plain text summaries.`;

  return prompt;
}
