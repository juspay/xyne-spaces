import type { RawPoint, RecapTopic, TopicPoint } from './RecapPanel.types';

/**
 * Clusters a channel's recap points into per-thread topics (pure, unit-testable).
 *
 * Grouped by citation.conversationId. A topic appears only when its newest point falls
 * inside the selected window (the anchor rule) — older points ride along as prior
 * context, clipped at contextFloor so already-read days never resurface. Points citing
 * no thread render as plain bullets after the topics.
 */
export interface ClusterWindow {
  // Inclusive, midnight-UTC ms
  windowStart: number;
  windowEnd: number;
  // lastSeenRecapDate — context never reaches back past it. In-window points are
  // unaffected, so an explicit range still shows everything it covers.
  contextFloor?: number | null;
}

const normalizeText = (text: string): string => text.trim().replace(/\s+/g, ' ');

export function clusterPointsIntoTopics(
  points: RawPoint[],
  threadTitles: Record<string, string>,
  window: ClusterWindow,
): { topics: RecapTopic[]; ungroupedPoints: TopicPoint[] } {
  const { windowStart, windowEnd } = window;
  const contextFloor = window.contextFloor ?? Number.NEGATIVE_INFINITY;

  // Nothing newer than the window can influence anchoring or display
  const candidates = points.filter(p => p.recapDate <= windowEnd);

  // Exact-string dedup, newest wins — keyed per thread, since two threads sharing a line
  // ("Deployed to prod") are two real updates, not a duplicate.
  const seen = new Set<string>();
  const deduped: RawPoint[] = [];
  const newestFirst = [...candidates].sort(
    (a, b) => b.recapDate - a.recapDate || a.order - b.order,
  );
  for (const point of newestFirst) {
    const text = normalizeText(point.text);
    if (!text) continue;
    const key = `${point.conversationId ?? ''}\u0000${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(point);
  }

  const clusters = new Map<string, RawPoint[]>();
  const ungroupedRaw: RawPoint[] = [];
  for (const point of deduped) {
    if (!point.conversationId) {
      ungroupedRaw.push(point);
      continue;
    }
    const arr = clusters.get(point.conversationId) ?? [];
    arr.push(point);
    clusters.set(point.conversationId, arr);
  }

  const topics: RecapTopic[] = [];
  for (const [conversationId, clusterPoints] of clusters) {
    const anchorDate = clusterPoints.reduce((max, p) => Math.max(max, p.recapDate), 0);

    // Anchor rule: the topic's newest point must land inside the window
    if (anchorDate < windowStart) continue;

    // Drop already-read context; in-window points always stay
    const visible = clusterPoints.filter(
      p => p.recapDate >= windowStart || p.recapDate > contextFloor,
    );
    if (visible.length === 0) continue;

    const title = threadTitles[conversationId]?.trim() || null;

    // Chronological: context first, newest last
    const ordered = [...visible].sort((a, b) => a.recapDate - b.recapDate || a.order - b.order);

    topics.push({
      key: conversationId,
      conversationId,
      title,
      lastActivityAt: anchorDate,
      anchorDate,
      points: ordered.map<TopicPoint>(p => ({
        text: p.text,
        recapDate: p.recapDate,
        isContext: p.recapDate < windowStart,
        citationNumber: 0, // assigned in render order below
        ...(p.conversationId && { conversationId: p.conversationId }),
        ...(p.messageId && { messageId: p.messageId }),
      })),
    });
  }

  // Freshest-first by the day the topic last moved IN THE RECAP. Not lastActivityAt:
  // live thread activity can sit far outside the card's range, which reads as arbitrary.
  topics.sort(
    (a, b) => b.anchorDate - a.anchorDate || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
  );

  // Threadless points have nothing to anchor to, so they show only if in-window
  const ungroupedPoints = ungroupedRaw
    .filter(p => p.recapDate >= windowStart)
    .sort((a, b) => a.recapDate - b.recapDate || a.order - b.order)
    .map<TopicPoint>(p => ({
      text: p.text,
      recapDate: p.recapDate,
      isContext: false,
      citationNumber: 0,
      ...(p.messageId && { messageId: p.messageId }),
    }));

  // Number citations in render order so they read 1..N down the card
  let n = 0;
  for (const topic of topics) {
    for (const point of topic.points) {
      n += 1;
      point.citationNumber = n;
    }
  }
  for (const point of ungroupedPoints) {
    n += 1;
    point.citationNumber = n;
  }

  return { topics, ungroupedPoints };
}
