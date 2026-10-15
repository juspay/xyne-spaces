import type { LinkPreview } from './chatRow.types';
import { stripMarkdownForPreview } from './text/markdownPreview';

export type LinkPreviewSeed = Omit<LinkPreview, 'host' | 'reservedHeightPx'>;

type LinkPreviewValues = {
  url?: unknown;
  title?: unknown;
  description?: unknown;
  siteName?: unknown;
  image?: unknown;
  favicon?: unknown;
};

type LegacyLinkPreview = {
  url: string | null;
  title: string | null;
  description: string | null;
  siteName?: string | null | undefined;
  image?: string | null | undefined;
  favicon?: string | null | undefined;
  needsMetadataFetch?: boolean | undefined;
};

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/i;
const BARE_URL_PATTERN = /https?:\/\/[^\s<>()]+/i;
const URL_TRAILING_PUNCTUATION = /[.,!?;:]+$/;
const ARCHIVE_URL_WITH_SUFFIX_PATTERN =
  /^(https?:\/\/[^/\s<>()]+\/archives\/[A-Z0-9]+\/p\d{16})([A-Z][^\s<>()]*)$/;

const stringValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const normalizeUrl = (value: string | null): string | null => {
  const candidate = value?.trim();
  if (!candidate || !/^https?:\/\//i.test(candidate)) {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    return parsed.hostname ? candidate : null;
  } catch {
    return null;
  }
};

const hostFor = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
};

const unescapePreviewValue = (value: string): string =>
  value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');

/**
 * Reads the external-preview block without importing the shared barrel. The
 * barrel also exports Zero's schema, which would make this pure row model
 * pull the native ESM runtime into Jest and other model-only consumers.
 */
const parseStoredLinkPreviewBlock = (raw: string): LinkPreviewValues | null => {
  const lines = raw.split('\n');
  let inBlock = false;
  const values: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === ':::link_preview') {
      inBlock = true;
      continue;
    }
    if (inBlock && trimmed === ':::') {
      inBlock = false;
      continue;
    }
    if (!inBlock || !trimmed.includes(':')) {
      continue;
    }
    const colonIndex = trimmed.indexOf(':');
    values[trimmed.slice(0, colonIndex).trim()] = unescapePreviewValue(
      trimmed.slice(colonIndex + 1).trim(),
    );
  }

  return values['url'] ? values : null;
};

const splitBareUrlCandidate = (raw: string): { url: string; suffix: string; trailing: string } => {
  const trailing = URL_TRAILING_PUNCTUATION.exec(raw)?.[0] ?? '';
  const withoutTrailing = trailing ? raw.slice(0, -trailing.length) : raw;
  const archiveMatch = ARCHIVE_URL_WITH_SUFFIX_PATTERN.exec(withoutTrailing);
  if (archiveMatch) {
    return {
      url: archiveMatch[1] ?? withoutTrailing,
      suffix: archiveMatch[2] ?? '',
      trailing,
    };
  }
  return { url: withoutTrailing, suffix: '', trailing };
};

const seedFromValues = (
  values: LinkPreviewValues | null,
  source: LinkPreviewSeed['source'],
  needsMetadataFetch: boolean,
): LinkPreviewSeed | null => {
  if (!values) {
    return null;
  }
  const url = normalizeUrl(stringValue(values.url));
  if (!url) {
    return null;
  }
  const host = hostFor(url);
  return {
    url,
    title: stringValue(values.title) ?? host,
    // V2 always keeps the URL as the fallback description, including stored
    // previews that contain only a URL.
    description: stringValue(values.description) ?? url,
    siteName: stringValue(values.siteName),
    image: stringValue(values.image),
    favicon: stringValue(values.favicon),
    needsMetadataFetch,
    source,
    status: needsMetadataFetch ? 'needsMetadata' : 'ready',
  };
};

const parseStoredValues = (raw: string | null | undefined): LinkPreviewValues | null => {
  if (!raw) {
    return null;
  }
  const parsedBlock = parseStoredLinkPreviewBlock(raw);
  if (parsedBlock) {
    return parsedBlock;
  }
  const directUrl = normalizeUrl(splitBareUrlCandidate(raw.trim()).url);
  if (directUrl) {
    return { url: directUrl };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as LinkPreviewValues;
  } catch {
    return null;
  }
};

const extractedValuesFromMarkdown = (markdown: string): LinkPreviewValues | null => {
  const linked = MARKDOWN_LINK_PATTERN.exec(markdown);
  if (linked) {
    const url = normalizeUrl(splitBareUrlCandidate(linked[2] ?? '').url);
    if (url) {
      const label = stripMarkdownForPreview(linked[1] ?? '').trim();
      return { url, title: label && label !== url ? label : undefined };
    }
  }

  const bare = BARE_URL_PATTERN.exec(markdown);
  if (!bare) {
    return null;
  }
  const candidate = splitBareUrlCandidate(bare[0]);
  return { url: normalizeUrl(candidate.url) };
};

export const linkPreviewSeedFrom = ({
  storedMarkdown,
  markdown,
  legacy,
}: {
  storedMarkdown?: string | null;
  markdown?: string;
  legacy?: LegacyLinkPreview;
}): LinkPreviewSeed | null => {
  const stored = seedFromValues(parseStoredValues(storedMarkdown), 'stored', false);
  if (stored) {
    return stored;
  }

  if (legacy?.url) {
    return seedFromValues(
      legacy,
      legacy.needsMetadataFetch ? 'extracted' : 'stored',
      legacy.needsMetadataFetch === true,
    );
  }

  const extracted = extractedValuesFromMarkdown(markdown ?? '');
  return extracted ? seedFromValues(extracted, 'extracted', true) : null;
};
