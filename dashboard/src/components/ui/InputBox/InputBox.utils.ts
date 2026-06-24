export const TIMING_CONSTANTS = {
  SEARCH_DEBOUNCE_MS: 300,
  TYPING_DEBOUNCE_MS: 1000,
};
/**
 * Extracts the argument text from a slash-command HTML string, resolving
 * Xyne mention spans into semantic tokens:
 *   <span data-mention-type="user"  data-user-id="uid">  → <userid:uid>
 *   <span data-mention-type="group" data-group-id="gid"> → <groupid:gid>
 *
 * Strips the leading "/commandName " prefix and all remaining HTML so the
 * backend app receives clean, ID-resolved text instead of bare display names.
 */
export const resolveCommandTextFromHtml = (html: string, commandName: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const resolveNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? '';
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const mentionType = el.getAttribute('data-mention-type');
      if (mentionType === 'user') {
        const userId = el.getAttribute('data-user-id');
        if (userId) return `<userid:${userId}>`;
      }
      if (mentionType === 'group') {
        const groupId = el.getAttribute('data-group-id');
        if (groupId) return `<groupid:${groupId}>`;
      }
      // Recurse into any other element (p, br, span, etc.)
      return Array.from(node.childNodes).map(resolveNode).join('');
    }
    return '';
  };

  const resolved = resolveNode(doc.body).trim();
  // Strip the leading "/commandName" prefix (case-insensitive, optional trailing space)
  return resolved.replace(new RegExp(`^\\/${commandName}\\s*`, 'i'), '').trim();
};

export const formatTypingMessage = (typingUsers: Array<{ username: string }>): string => {
  if (typingUsers.length === 0) return '';
  if (typingUsers.length === 1 && typingUsers[0]) return `${typingUsers[0].username} is typing`;
  if (typingUsers.length === 2 && typingUsers[0] && typingUsers[1])
    return `${typingUsers[0].username} and ${typingUsers[1].username} are typing`;
  if (typingUsers[0])
    return `${typingUsers[0].username} and ${typingUsers.length - 1} others are typing`;
  return '';
};
