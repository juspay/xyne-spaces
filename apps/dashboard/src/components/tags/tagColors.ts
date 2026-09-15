// Fallback palette used when a tag has no stored color. Deterministic per name so the
// same tag always renders the same color everywhere it appears (Gmail-style chips).
// Extracted from xyne-desk/ConversationLabels so message tags and desk labels stay
// visually consistent.
const TAG_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

export const colorForTagName = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length] ?? '#6b7280';
};
