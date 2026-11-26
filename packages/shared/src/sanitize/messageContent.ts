import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitizes message content for storage, preventing XSS when rendering markdown with rehype-raw
 * on the client. Moved from the backend's contentUtils (which re-exports it) so the encryption
 * extractor can run it on decrypted content (compose template markdownContent).
 */
export function sanitizeMessageContent(content: string): string {
  if (!content) return content;

  return DOMPurify.sanitize(content, {
    USE_PROFILES: { html: true },

    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'style', 'link', 'meta', 'base'],

    // DOMPurify already strips ALL event-handler attributes by default; we only
    // need to additionally block (iframe payload carrier).
    FORBID_ATTR: ['srcdoc'],

    ADD_ATTR: ['target', 'rel'],

    // Allow only https/mailto schemes + relative URLs; rejects javascript:/data:/vbscript:.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}
