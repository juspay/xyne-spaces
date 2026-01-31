export function parseEmailAddresses(emailString: string | undefined): string[] {
  if (!emailString || typeof emailString !== 'string') return [];
  
  const emails: string[] = [];
  const angleBracketRegex = /<([^>]+@[^>]+)>/g;
  let match;
  
  while ((match = angleBracketRegex.exec(emailString)) !== null) {
    const email = match[1].trim();
    if (email && email.includes('@') && email.includes('.')) {
      emails.push(email);
    }
  }
  return Array.from(new Set(emails));
}