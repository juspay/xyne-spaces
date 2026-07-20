/**
 * Parsing for RFC 5322 `From`/recipient header values.
 *
 * A header can arrive in any of these shapes:
 *   - `user@domain`
 *   - `Name <user@domain>`
 *   - `"Last, First" <user@domain>`          comma inside a quoted display name
 *   - `"Bob \"The Builder\"" <bob@b.com>`    escaped quotes inside the name
 *   - `=?UTF-8?B?w6TDtsO8?= <user@domain>`   RFC 2047 encoded-word
 *   - `A <a@x.com>, B <b@y.com>`             address list
 *
 * This lives in one place because the desk UI parses these in several spots
 * (ticket rows, email composer, recipient pills), and the naive
 * `/^"?([^"<]+?)"?\s*<([^>]+)>$/` that each of them grew independently drops
 * everything past the first two shapes.
 */

export interface ParsedEmailAddress {
  /** Display name — unquoted, unescaped, and RFC 2047 decoded. Null when the header carries none. */
  name: string | null;
  /** Bare address without angle brackets. Null when none could be found. */
  email: string | null;
}

const EMPTY: ParsedEmailAddress = { name: null, email: null };

const decodeBase64Word = (data: string, charset: string): string | null => {
  try {
    const binary = atob(data.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return null;
  }
};

const decodeQuotedPrintableWord = (data: string, charset: string): string | null => {
  try {
    const bytes: number[] = [];
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]!;
      // In encoded-words '_' stands for a space, not an underscore.
      if (ch === '_') {
        bytes.push(0x20);
        continue;
      }
      if (ch === '=' && i + 2 < data.length) {
        const hex = data.slice(i + 1, i + 3);
        if (/^[0-9a-f]{2}$/i.test(hex)) {
          bytes.push(parseInt(hex, 16));
          i += 2;
          continue;
        }
      }
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
    return new TextDecoder(charset).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
};

/**
 * Decode RFC 2047 encoded-words. Anything we can't decode (unknown charset,
 * malformed base64) is left exactly as-is rather than mangled.
 */
const decodeEncodedWords = (text: string): string =>
  text
    // Whitespace between two adjacent encoded-words is a separator, not content.
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(
      /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
      (whole, charset: string, encoding: string, data: string) => {
        const decoded =
          encoding.toUpperCase() === 'B'
            ? decodeBase64Word(data, charset)
            : decodeQuotedPrintableWord(data, charset);
        return decoded ?? whole;
      },
    );

const normalizeDisplayName = (raw: string): string | null => {
  let name = raw.trim();
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
    // Unescape \" and \\ — but only inside the quoted-string form, where a
    // backslash is an escape character. Unquoted, it is a literal, so an
    // unconditional unescape would turn `DOMAIN\user` into `DOMAINuser`.
    name = name.slice(1, -1).replace(/\\([\s\S])/g, '$1');
  }
  name = decodeEncodedWords(name).trim();
  return name || null;
};

/**
 * Split an address list on separators that are not inside a quoted display
 * name or an angle-bracketed address, so `"Last, First" <a@b.com>, x@y.com`
 * yields two entries rather than three.
 */
export const splitEmailAddressList = (raw: string | null | undefined): string[] => {
  const value = raw ?? '';
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let depth = 0;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (inQuotes && ch === '\\' && i + 1 < value.length) {
      current += ch + value[i + 1]!;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes && ch === '<') {
      depth++;
      current += ch;
      continue;
    }
    if (!inQuotes && ch === '>') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (!inQuotes && depth === 0 && (ch === ',' || ch === ';')) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);

  return parts.map(part => part.trim()).filter(Boolean);
};

/**
 * Last-resort scan for something address-shaped anywhere in a string, for
 * values that aren't a well-formed address token at all
 * (e.g. `Wrapper text (user@domain)`).
 */
export const findEmailAddress = (raw: string | null | undefined): string | null => {
  const match = (raw ?? '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
};

/**
 * Parse a single address token. Strict: the value is expected to be one
 * address, not a list — use `parseFirstEmailAddress` for header values that
 * may carry several.
 */
export const parseSingleEmailAddress = (raw: string | null | undefined): ParsedEmailAddress => {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return EMPTY;

  const angled = trimmed.match(/^([\s\S]*)<([^<>]*)>[\s,;]*$/);
  if (angled) {
    return {
      name: normalizeDisplayName(angled[1] ?? ''),
      email: angled[2]?.trim() || null,
    };
  }

  const bare = trimmed.match(/^<?\s*([^\s<>@,;]+@[^\s<>,;]+?)\s*>?$/);
  if (bare) return { name: null, email: bare[1]! };

  // Not a well-formed address token. If something address-shaped is buried in
  // it (`Wrapper text (user@domain)`) there is no clean display name to report,
  // so report nothing rather than echoing the address back as a name.
  if (findEmailAddress(trimmed)) return EMPTY;
  return { name: normalizeDisplayName(trimmed), email: null };
};

/** Parse the first address out of a possibly-multi-address header value. */
export const parseFirstEmailAddress = (raw: string | null | undefined): ParsedEmailAddress => {
  const [first] = splitEmailAddressList(raw);
  return first ? parseSingleEmailAddress(first) : EMPTY;
};
