import type { PRActivityValue } from '@xyne/shared';

type PRActivityPart =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string | undefined }
  | { type: 'strong'; value: string };

/**
 * Formats PR activity for display in TicketActivity timeline
 * Returns plain text/HTML string for rendering
 * Format: PR #xx action, old stage → new stage, author: authorName
 */
export function formatPRActivityParts(value: PRActivityValue): PRActivityPart[] {
  const action = value?.action || 'updated';
  const prId = value?.prId;
  const prUrl = value?.prUrl;

  const parts: PRActivityPart[] = [
    { type: 'text', value: 'PR ' },
    { type: 'link', value: `#${prId}`, href: prUrl },
    { type: 'text', value: ` ${action}` },
  ];

  // Handle stage change using new structure (field/oldValue/newValue)
  if (
    value.field === 'stageName' &&
    value.oldValue &&
    value.newValue &&
    value.oldValue !== value.newValue
  ) {
    parts.push(
      { type: 'text', value: ', ' },
      { type: 'strong', value: value.oldValue },
      { type: 'text', value: ' → ' },
      { type: 'strong', value: value.newValue },
    );
  }

  if (value.authorName) {
    parts.push({ type: 'text', value: ', author: ' }, { type: 'strong', value: value.authorName });
  }

  if (value.remainingOpenPRs) {
    parts.push({ type: 'text', value: `, ${value.remainingOpenPRs} PRs remaining` });
  }

  return parts;
}
