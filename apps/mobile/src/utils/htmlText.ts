/**
 * Shared helpers for turning message HTML into plain text or Markdown.
 *
 * Single-pass regex cleanups can leave fragments behind (`<scr<b>ipt>` becomes
 * `<script>`) and chained entity decoding can decode twice (`&amp;lt;` becomes
 * `<`). These helpers avoid both, so call sites should use them instead of
 * writing their own tag-stripping or entity-decoding regexes.
 */

/** Applies `pattern` repeatedly until the string stops changing. */
export function replaceUntilStable(input: string, pattern: RegExp, replacement = ''): string {
  let previous: string;
  let output = input;
  do {
    previous = output;
    output = output.replace(pattern, replacement);
  } while (output !== previous);
  return output;
}

/** Matches an HTML tag. */
export const HTML_TAG = /<[^>]+>/g;

/** Like `HTML_TAG`, but also matches an empty `<>`. */
export const HTML_TAG_OR_EMPTY = /<[^>]*>/g;

/** Removes every HTML tag, including tags reassembled by a previous removal. */
export function stripHtmlTags(html: string, tagPattern: RegExp = HTML_TAG): string {
  return replaceUntilStable(html, tagPattern);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Decodes named (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;`) and
 * numeric (`&#39;`, `&#x27;`) entities in one pass, so decoded text is never
 * decoded again. Unknown or out-of-range entities are left as they are.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const value = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Single-pass decode of exactly the entities in `entities` (keyed by the text between
 * `&` and `;`). Names match case-sensitively unless listed in `ignoreCase`. Anything
 * else is left as it is, and decoded text is never decoded again.
 */
export function decodeEntitySet(
  text: string,
  entities: Readonly<Record<string, string>>,
  ignoreCase: readonly string[] = [],
): string {
  return text.replace(/&([#a-z0-9]+);/gi, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(entities, name)) return entities[name] as string;
    const lower = name.toLowerCase();
    return ignoreCase.includes(lower) && Object.prototype.hasOwnProperty.call(entities, lower)
      ? (entities[lower] as string)
      : match;
  });
}

const BASIC_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"' };

/** `&nbsp;` (any case), `&amp;`, `&lt;`, `&gt;`, `&quot;`. */
export const decodeBasicEntities = (text: string): string =>
  decodeEntitySet(text, BASIC_ENTITIES, ['nbsp']);

/** Same as `decodeBasicEntities`, plus `&#39;`. */
export const decodeBasicEntitiesWithApos = (text: string): string =>
  decodeEntitySet(text, { ...BASIC_ENTITIES, '#39': "'" }, ['nbsp']);

/** Same set as `decodeBasicEntitiesWithApos`, but every name is case-sensitive. */
export const decodeBasicEntitiesExact = (text: string): string =>
  decodeEntitySet(text, { ...BASIC_ENTITIES, '#39': "'" });
