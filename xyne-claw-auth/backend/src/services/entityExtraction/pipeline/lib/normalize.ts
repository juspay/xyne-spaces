/**
 * Deterministic, versioned text normalization.
 *
 * This must never be delegated to a model: index-time and query-time
 * resolution have to produce byte-identical output, and a model will not.
 * Bump NORMALIZER_VERSION on any behavioural change — stored mentions record
 * which version linked them, so a change implies a targeted re-link.
 */


const CORPORATE_SUFFIXES = [
  'ltd',
  'limited',
  'pvt',
  'private',
  'inc',
  'incorporated',
  'llc',
  'llp',
  'corp',
  'corporation',
  'co',
  'gmbh',
  'plc',
]

/** Canonical key used for exact-match lookup and as the clustering unit. */
export function normalize(input: string): string {
  let s = input.toLowerCase().trim()
  s = s.replace(/[_\-./\\]+/g, ' ')
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ')
  s = s.replace(/\s+/g, ' ').trim()

  const parts = s.split(' ').filter(Boolean)
  while (parts.length > 1 && CORPORATE_SUFFIXES.includes(parts[parts.length - 1]!)) {
    parts.pop()
  }
  return parts.join(' ')
}



// ---------------------------------------------------------------------------
// Fetch-time cleaning
// ---------------------------------------------------------------------------

const NOISE_PATTERNS: Array<[RegExp, string]> = [
  [/```[\s\S]*?```/g, ' '], // fenced code
  [/`[^`\n]{1,200}`/g, ' '], // inline code
  [/<https?:\/\/[^\s>]+>/g, ' '], // angle-wrapped links
  [/https?:\/\/\S+/g, ' '], // bare urls
  [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, ' '], // emails
  [/<@[UW][A-Z0-9]+>/g, ' '], // user refs
  [/<#[CG][A-Z0-9]+\|?[^>]*>/g, ' '], // channel refs
  [/:[a-z0-9_+-]+:/g, ' '], // emoji shortcodes
  [/^\s*(at|caused by)\s+[\w$.]+\([^)]*\)\s*$/gim, ' '], // stack frames
]

export interface CleanResult {
  text: string
  /** Reason the document should be dropped entirely, if any. */
  drop?: string
}

export function cleanMessageText(raw: string, minLength: number): CleanResult {
  if (!raw || !raw.trim()) return { text: '', drop: 'empty' }

  let text = raw
  for (const [pattern, replacement] of NOISE_PATTERNS) {
    text = text.replace(pattern, replacement)
  }
  text = text.replace(/\s+/g, ' ').trim()

  if (text.length < minLength) return { text, drop: 'too_short' }

  const letters = text.replace(/[^\p{L}]/gu, '').length
  if (letters / text.length < 0.4) return { text, drop: 'low_letter_ratio' }

  return { text }
}

/**
 * Channel names carry entity signal but arrive as slugs. `hdfc-integration`
 * becomes `hdfc integration`, which the extractor can read.
 */
export function humanizeChannelName(name: string): string {
  return name
    .replace(/^#/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
