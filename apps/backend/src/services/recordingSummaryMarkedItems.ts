const MARKED_ITEM_ANNOTATIONS = {
  action: '[xyne-action]',
  decision: '[xyne-decision]',
} as const;

const MARKED_ITEM_LINE_RE = /^\s*[-*+]\s+\[xyne-(action|decision)\]\s+(.+?)\s*$/;
const SUMMARY_HEADING_RE = /^\s*#{1,6}\s+(.+?)\s*$/;
const SUMMARY_BULLET_RE = /^\s*[-*+]\s+(.+?)\s*$/;
const CITATION_TOKEN_RE = /\[clf-(\d+)\]/g;
const COMPLETE_ANNOTATION_RE = /\[xyne-(?:action|decision)\]\s*/g;
const MAX_MARKED_ITEMS = 15;

export interface RecordingSummaryMarkedItem {
  type: 'decision' | 'action';
  text: string;
  timestampSeconds: number;
}

interface TimestampedSegment {
  timestamp: string;
}

function isUserMarkedMoment(item: unknown): item is Record<string, unknown> {
  return (
    !!item &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    (item as Record<string, unknown>).type === 'moment'
  );
}

function markedItemTimestamp(item: unknown): number {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 0;
  const timestamp = (item as Record<string, unknown>).timestampSeconds;
  return typeof timestamp === 'number' ? timestamp : 0;
}

function timestampToSeconds(timestamp: string): number | null {
  const match = timestamp.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3], 10);
  if (minutes > 59 || seconds > 59) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

function removeCitationTokens(value: string): string {
  return value
    .replace(CITATION_TOKEN_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function markedItemTypeFromHeading(heading: string): RecordingSummaryMarkedItem['type'] | null {
  const hasActionItems = /\baction\s+items?\b/i.test(heading);
  const hasDecisions = /\bdecisions?\b/i.test(heading);
  if (hasActionItems === hasDecisions) return null;
  return hasActionItems ? 'action' : 'decision';
}

/**
 * Remove the private LLM annotations before summary Markdown reaches the
 * canvas. The partial-marker branch also handles an in-flight streaming delta
 * that ends halfway through an annotation.
 */
export function stripRecordingSummaryMarkedItemAnnotations(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      const withoutCompleteAnnotations = line.replace(COMPLETE_ANNOTATION_RE, '');
      const bulletMatch = withoutCompleteAnnotations.match(/^(\s*[-*+]\s+)(.*)$/);
      if (!bulletMatch) return withoutCompleteAnnotations;

      const [, bulletPrefix, content] = bulletMatch;
      const candidate = content.trimStart();
      const isPartialAnnotation = Object.values(MARKED_ITEM_ANNOTATIONS).some(
        annotation => candidate.length > 0 && annotation.startsWith(candidate),
      );
      return isPartialAnnotation ? bulletPrefix : withoutCompleteAnnotations;
    })
    .join('\n');
}

/**
 * Build timeline items from the exact action/decision bullets produced by the
 * detailed-summary call. The first valid citation on a bullet is resolved via
 * the deterministic transcript segment map, so timestamps are never guessed.
 */
export function extractMarkedItemsFromRecordingSummary(
  markdown: string,
  segments: ReadonlyMap<number, TimestampedSegment>,
): RecordingSummaryMarkedItem[] {
  const items: RecordingSummaryMarkedItem[] = [];
  let sectionType: RecordingSummaryMarkedItem['type'] | null = null;

  for (const line of markdown.split('\n')) {
    if (items.length >= MAX_MARKED_ITEMS) break;

    const heading = line.match(SUMMARY_HEADING_RE);
    if (heading) {
      sectionType = markedItemTypeFromHeading(heading[1]);
      continue;
    }

    const markedLine = line.match(MARKED_ITEM_LINE_RE);
    const ordinaryBullet = sectionType ? line.match(SUMMARY_BULLET_RE) : null;
    if (!markedLine && !ordinaryBullet) continue;

    const type = markedLine?.[1] ?? sectionType;
    const annotatedText = markedLine?.[2] ?? ordinaryBullet?.[1];
    if (!type || !annotatedText) continue;
    const citationMatches = annotatedText.matchAll(CITATION_TOKEN_RE);
    let timestampSeconds: number | null = null;
    for (const citationMatch of citationMatches) {
      const segmentNumber = Number.parseInt(citationMatch[1], 10);
      const segment = segments.get(segmentNumber);
      if (!segment) continue;

      timestampSeconds = timestampToSeconds(segment.timestamp);
      if (timestampSeconds !== null) break;
    }

    const text = removeCitationTokens(annotatedText);
    if (!text || timestampSeconds === null) continue;

    items.push({
      type: type === 'action' ? 'action' : 'decision',
      text,
      timestampSeconds,
    });
  }

  return items;
}

/** Replace generated items while retaining moments explicitly marked by the user. */
export function mergeRecordingSummaryMarkedItems(
  existingMarkedItems: unknown,
  generatedMarkedItems: RecordingSummaryMarkedItem[],
): unknown[] {
  const existingMoments = Array.isArray(existingMarkedItems)
    ? existingMarkedItems.filter(isUserMarkedMoment)
    : [];
  const merged: unknown[] = [...existingMoments, ...generatedMarkedItems];
  merged.sort((left, right) => markedItemTimestamp(left) - markedItemTimestamp(right));
  return merged;
}

/**
 * Rebase `markedAtEpochSeconds` — wall-clock, because a live call has no
 * client-side transcript to measure against — onto the transcript's clock, which
 * starts at its first spoken line.
 *
 * Idempotent: only entries still carrying the field are touched, and it is
 * dropped once applied.
 */
export function rebaseMarkedMoments(
  markedItems: unknown,
  firstEntryEpochSeconds: number
): { items: unknown[]; rebasedCount: number } {
  if (!Array.isArray(markedItems)) return { items: [], rebasedCount: 0 };

  let rebasedCount = 0;
  const items = markedItems.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;

    const candidate = item as Record<string, unknown>;
    const markedAt = candidate.markedAtEpochSeconds;
    if (candidate.type !== 'moment' || typeof markedAt !== 'number') return item;

    const { markedAtEpochSeconds: _applied, ...rest } = candidate;
    rebasedCount += 1;
    return {
      ...rest,
      // A moment flagged before anyone spoke belongs to the transcript's start.
      timestampSeconds: Math.max(0, Math.round(markedAt - firstEntryEpochSeconds)),
    };
  });

  return { items, rebasedCount };
}
