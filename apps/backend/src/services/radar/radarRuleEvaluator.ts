import {
  explainItem,
  isMuted,
  MAX_RULE_VALUES,
  MAX_RULE_VALUE_LENGTH,
  type RadarRule,
  type RadarRuleExplanation,
  type RadarRuleSubject,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';

const prisma = DatabaseClient.getInstance();

/**
 * What one viewer's own rules make of their feed items, decided at read time.
 * An item is a single row several people can see, so the verdict belongs to
 * whoever is asking and cannot be stored on it. Nothing is destroyed: editing a
 * rule re-answers for every item already in the feed. The one exception is the
 * mention scope, which reads a column stamped at parse time and so cannot match
 * items written before it existed.
 *
 * One query, always: the rules. Every scope compares ids the item already
 * carries, so classifying costs no further lookup — and in particular no
 * channel read, which would otherwise have to be ACL-scoped for ids the reader
 * put in a rule rather than ids the feed handed us.
 */

interface ViewerAuth {
  userId: string;
  workspaceId: string;
}

interface RuleRow {
  id: string;
  conditions: unknown;
}

interface ClassifiableItem {
  id: string;
  channelId: string;
  title: string;
  contextSummary: string | null;
  requestedBy: string[];
  /** Stamped at parse time, so classifying costs no lookup of its own. */
  mentionedGroupIds: string[];
}

const SCOPES = new Set(['channel', 'keyword', 'mention', 'sender']);

/**
 * Storage is Json, so the shape is rebuilt rather than trusted — and every
 * check drops the WHOLE rule rather than the part that failed. Conditions are
 * ANDed, so keeping the survivors of `[channel, garbage]` would mute strictly
 * more than the reader wrote; dropping the rule mutes strictly less.
 *
 * The bounds here are the same ones the route enforces on the way in, repeated
 * because rows can predate the route that wrote them, and this is the code that
 * runs on every feed read.
 */
const parseRule = (row: RuleRow): RadarRule | null => {
  if (!Array.isArray(row.conditions) || row.conditions.length === 0) return null;
  if (row.conditions.length > SCOPES.size) return null;
  const conditions: RadarRule['conditions'] = [];
  const seenScopes = new Set<string>();
  for (const raw of row.conditions) {
    if (typeof raw !== 'object' || raw === null) return null;
    const c = raw as { scope?: unknown; values?: unknown };
    if (typeof c.scope !== 'string' || !SCOPES.has(c.scope)) return null;
    // One condition per scope. Two of the same scope would AND into an
    // intersection, which is not what the builder can express or the chips say.
    if (seenScopes.has(c.scope)) return null;
    seenScopes.add(c.scope);
    if (!Array.isArray(c.values)) return null;
    if (c.values.length === 0 || c.values.length > MAX_RULE_VALUES) return null;
    const values = c.values.filter(
      (v): v is string =>
        typeof v === 'string' && v.trim() !== '' && v.length <= MAX_RULE_VALUE_LENGTH
    );
    if (values.length !== c.values.length) return null;
    conditions.push({ scope: c.scope as RadarRule['conditions'][number]['scope'], values });
  }
  return conditions.length > 0 ? { id: row.id, conditions } : null;
};

/** The viewer's rules, parsed. Null when there is nothing to apply, so the
 *  caller can skip the walk entirely — which is the common case. */
async function viewerRules(auth: ViewerAuth): Promise<RadarRule[] | null> {
  let rows: RuleRow[];
  try {
    rows = await prisma.radarRule.findMany({
      where: { workspaceId: auth.workspaceId, userId: auth.userId },
      select: { id: true, conditions: true },
    });
  } catch (error) {
    // Fail open: hiding work nobody chose to hide, and could not find, is worse
    // than showing a row they had tucked away.
    logger.error('[RADAR-RULES] Rule lookup failed — nothing muted for this read', {
      userId: auth.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const rules = rows.map(parseRule).filter((r): r is RadarRule => r !== null);
  return rules.length > 0 ? rules : null;
}

const subjectOf = (item: ClassifiableItem): RadarRuleSubject => ({
  channelId: item.channelId,
  text: `${item.title} ${item.contextSummary ?? ''}`,
  requestedBy: item.requestedBy,
  mentionedGroupIds: item.mentionedGroupIds,
});

/** The ids of the viewer's items their own rules mute. Anything absent is shown
 *  normally; there is no third state for the feed to draw. */
export async function mutedItemIds(
  auth: ViewerAuth,
  items: ClassifiableItem[]
): Promise<Set<string>> {
  const muted = new Set<string>();
  if (items.length === 0) return muted;
  const rules = await viewerRules(auth);
  if (!rules) return muted;

  for (const item of items) {
    if (isMuted(subjectOf(item), rules)) muted.add(item.id);
  }
  return muted;
}

/** The same answer with its working shown, for one item, for the debug trail. */
export async function explainItemMute(
  auth: ViewerAuth,
  item: ClassifiableItem
): Promise<RadarRuleExplanation> {
  const rules = await viewerRules(auth);
  if (!rules) return { muted: false, matched: [] };
  return explainItem(subjectOf(item), rules);
}
