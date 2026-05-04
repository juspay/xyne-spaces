// Match Gmail's 25MB per-message ceiling.
export const MAX_EMAIL_ATTACHMENT_FILES = 10;
export const MAX_EMAIL_ATTACHMENT_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export const parseFromField = (raw: string): { name: string; email: string | null } => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { name: 'Unknown', email: null };
  const match = trimmed.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1]!.trim(), email: match[2]!.trim() };
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
