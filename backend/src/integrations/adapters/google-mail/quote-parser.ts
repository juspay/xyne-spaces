import { URL } from 'url';

const SIGNATURE_REGEX = /(--\s*$|^__\s*$|^-\w|^Sent from my (\w+\s*){1,3}$)/i;
const QUOTE_HDR_REGEX = /^On.*wrote:$/i;
const QUOTED_REGEX = /^(>+)/;
const HEADER_REGEX = /^(From|Sent|To|Subject): .+/i;
const MULTI_QUOTE_HDR_REGEX = /(?!On.*On\s.+?wrote:)(On\s(.+?)wrote:)/s;
const URL_REGEX = /\bhttps?:\/\/[^\s/$.?#].[^\s]*\b/gi;

class Fragment {
  public lines: string[] = [];
  public isQuoted = false;
  public isSignature = false;
  public isHeader = false;
  public isHidden = false;
  public content = '';

  finish(): void {
    this.lines.reverse();
    this.content = this.lines.join('\n').trim();
  }
}

export const parseEmailBody = (text: string): string => {
  const fragments: Fragment[] = [];
  let fragment: Fragment | null = null;
  let foundVisible = false;

  const finishFragment = (current: Fragment | null): void => {
    if (!current) {
      return;
    }

    current.finish();

    if (current.isHeader) {
      foundVisible = false;
      fragments.forEach(existing => {
        existing.isHidden = true;
      });
    }

    if (!foundVisible) {
      if (
        current.isQuoted ||
        current.isHeader ||
        current.isSignature ||
        current.content === ''
      ) {
        current.isHidden = true;
      } else {
        foundVisible = true;
      }
    } else {
      current.isHidden = true;
    }

    fragments.push(current);
  };

  let normalizedText = text.replace(/\r\n/g, '\n');
  const multiQuoteHeaderMatch = normalizedText.match(MULTI_QUOTE_HDR_REGEX);

  if (multiQuoteHeaderMatch) {
    normalizedText = normalizedText.replace(
      MULTI_QUOTE_HDR_REGEX,
      multiQuoteHeaderMatch[1].replace(/\n/g, '')
    );
  }

  normalizedText = normalizedText.replace(/([^\n])(?=\n ?[_-]{7,})/gm, '$1\n');

  const lines = normalizedText.split('\n').reverse();

  for (const line of lines) {
    const currentLine = line.trimEnd();
    const isHeader =
      QUOTE_HDR_REGEX.test(currentLine) || HEADER_REGEX.test(currentLine);
    const isQuoted = QUOTED_REGEX.test(currentLine);
    const sanitizedLine = replaceLinks(currentLine);

    if (
      fragment &&
      sanitizedLine.trim() === '' &&
      fragment.lines.length > 0 &&
      SIGNATURE_REGEX.test(fragment.lines[fragment.lines.length - 1].trim())
    ) {
      fragment.isSignature = true;
      finishFragment(fragment);
      fragment = null;
    }

    if (
      fragment &&
      ((fragment.isHeader === isHeader && fragment.isQuoted === isQuoted) ||
        (fragment.isQuoted &&
          (QUOTE_HDR_REGEX.test(sanitizedLine) || sanitizedLine.trim() === '')))
    ) {
      fragment.lines.push(sanitizedLine);
    } else {
      finishFragment(fragment);
      fragment = new Fragment();
      fragment.isQuoted = isQuoted;
      fragment.isHeader = isHeader;
      fragment.lines.push(sanitizedLine);
    }
  }

  finishFragment(fragment);
  fragments.reverse();

  return fragments
    .filter(current => !current.isHidden)
    .map(current => current.content)
    .join('\n')
    .trim();
};

const replaceLinks = (text: string): string => {
  return text.replace(URL_REGEX, (match: string): string => {
    try {
      const parsedUrl = new URL(match);
      return parsedUrl.hostname;
    } catch (_error) {
      return match;
    }
  });
};
