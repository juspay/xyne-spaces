export type RowFacts = {
  hasConversation: boolean;
  rowKind: 'CURRENT_USER' | 'OTHER_USER' | 'BOT' | 'TICKET' | 'SYSTEM';
  isTicketActivity: boolean;
  hasTicketPreview: boolean;
  hasRecordingPreview: boolean;
  isFlowJson: boolean;
};

/**
 * Rows the flat layout does not restyle. They keep the classic row because
 * their whole look is the card or chrome they draw (call and system lines,
 * ticket cards and activity, recordings, flow cards), and because a row with
 * no hydrated conversation has nothing for the flat body to render yet.
 */
export function usesClassicRow(facts: RowFacts): boolean {
  return (
    !facts.hasConversation ||
    facts.rowKind === 'SYSTEM' ||
    facts.rowKind === 'TICKET' ||
    facts.isTicketActivity ||
    facts.hasTicketPreview ||
    facts.hasRecordingPreview ||
    facts.isFlowJson
  );
}
