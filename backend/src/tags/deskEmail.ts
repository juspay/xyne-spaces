import { EmailRepository } from '@/database/repositories/emailRepository';
import type { TagGenerationPipeline } from './pipeline';

export const DESK_EMAIL_SOURCE_TYPE = 'desk-email';

export function deskEmailConfigKey(channelId: string): string {
  return `desk-channel:${channelId}`;
}

const emailRepository = new EmailRepository();

function stripHtml(html: string): string {
  // Remove Gmail attribution lines ("On Tue, Jun 23... wrote:") before blockquotes
  let text = html.replace(/<div[^>]*class="[^"]*gmail_attr[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  // Remove blockquote blocks (quoted previous emails in replies)
  text = text.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '');
  // Convert block-level closing tags to newlines before stripping
  text = text.replace(/<\/?(br|p|div|tr)[^>]*>/gi, '\n');
  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // Fallback: remove "On <date> <person> wrote:" lines from non-Gmail clients (Outlook, Apple Mail, etc.)
  text = text.replace(/On .+ wrote:\s*$/gm, '');
  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
  // Remove corporate email disclaimers (legal footers from various email clients/companies)
  const disclaimerPatterns = [
    /The information contained in this electronic mail[\s\S]*?$/i,
    /This e-?mail (and any attachments?)?[\s\S]*?confidential[\s\S]*?$/i,
    /This message (and any attachments?)?[\s\S]*?intended for[\s\S]*?$/i,
    /DISCLAIMER:[\s\S]*?$/i,
    /CONFIDENTIALITY NOTICE:[\s\S]*?$/i,
    /WARNING:[\s\S]*?virus[\s\S]*?$/i,
  ];
  for (const pattern of disclaimerPatterns) {
    text = text.replace(pattern, '');
  }
  // Collapse excessive blank lines
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Context builder for sourceType `desk-email`.
 *
 * `sourceId` is an `Email.id`. The returned context is the ticket's thread
 * up to and including that email in chronological order (oldest first).
 * HTML is stripped and quoted blockquote content removed so each email
 * only contributes its own new text — no duplicate thread content.
 */
export async function buildDeskEmailContext(sourceId: string): Promise<string> {
  const email = await emailRepository.findById(sourceId);
  if (!email) {
    throw new Error(`[TAG-FRAMEWORK] desk-email context builder: email "${sourceId}" not found`);
  }

  const emails = await emailRepository.findByConversationIdOrdered(email.conversationId);
  const emailIndex = emails.findIndex((e) => e.id === sourceId);
  const thread = emailIndex === -1 ? emails : emails.slice(0, emailIndex + 1);

  const sections = thread.map((e, i) => {
    const label = i === thread.length - 1 ? '[Latest email]' : '[Previous conversation]';
    return `${label}\nFrom: ${e.from}\nDate: ${e.createdAt.toISOString()}\n\n${stripHtml(e.body)}`;
  });

  return `Subject: ${email.subject}\n\n${sections.join('\n\n---\n\n')}`;
}

export function registerDeskEmailTags(framework: TagGenerationPipeline): void {
  framework.registerContextBuilder(DESK_EMAIL_SOURCE_TYPE, (sourceId) => buildDeskEmailContext(sourceId));
}
