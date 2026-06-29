// Match Gmail's 25MB per-message ceiling.
export const MAX_EMAIL_ATTACHMENT_FILES = 10;
export const MAX_EMAIL_ATTACHMENT_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** True for placeholder/provider ids that must not be shown as sender or preview text. */
export const looksLikeTechnicalId = (value: string): boolean => {
  const trimmed = (value || '').trim();
  if (!trimmed) return false;
  if (/^apps:[0-9a-f-]{36}$/i.test(trimmed)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
  if (/^c[a-z0-9]{20,}$/i.test(trimmed)) return true;
  if (/^[0-9a-f]{12,}$/i.test(trimmed) && !trimmed.includes('@')) return true;
  return false;
};

export const parseFromField = (raw: string): { name: string; email: string | null } => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { name: 'Unknown', email: null };
  if (looksLikeTechnicalId(trimmed)) {
    return { name: 'Unknown sender', email: null };
  }
  const match = trimmed.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (match) {
    const name = match[1]!.trim();
    const email = match[2]!.trim();
    if (looksLikeTechnicalId(name) || looksLikeTechnicalId(email)) {
      return { name: 'Unknown sender', email: null };
    }
    return { name, email };
  }
  const emailOnly = trimmed.match(/^<?([^\s<>@]+@[^\s<>]+)>?$/);
  if (emailOnly) {
    return { name: emailOnly[1]!.split('@')[0] ?? emailOnly[1]!, email: emailOnly[1]! };
  }
  return { name: trimmed, email: null };
};

export const stripHtml = (html: string): string => {
  if (!html) return '';
  if (typeof document === 'undefined') return html;
  const tmp = document.createElement('DIV');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
};
