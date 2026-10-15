/** Parse "Name <email@x.com>" / bare email from ticket.metadata.fromEmailAddress. */
export function parseTicketSender(fromEmailAddress: string | null | undefined): {
  senderName: string;
  email: string | null;
} {
  const raw = (fromEmailAddress ?? '').trim();
  if (!raw) return { senderName: '', email: null };

  const angle = raw.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (angle) {
    const name = (angle[1] ?? '').replace(/^["']|["']$/g, '').trim();
    const email = (angle[2] ?? '').trim();
    return { senderName: name || email, email: email || null };
  }

  const emailMatch = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch?.[0]) {
    return { senderName: emailMatch[0], email: emailMatch[0] };
  }

  return { senderName: raw, email: null };
}
