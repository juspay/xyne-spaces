/**
 * Radar rules — what a viewer wants out of the way. A rule is a set of
 * conditions; an item they all hold for is muted, which moves it in the feed
 * and never deletes it.
 *
 * Pure by construction: every scope compares against something already on the
 * subject, so evaluating a rule needs no lookup and the whole definition is
 * testable without a database.
 */

/** What a condition tests. One condition per scope in a rule, at most — the
 *  writer enforces it and the reader drops a row that breaks it, so the doc is
 *  not the only thing holding the invariant up. */
export type RadarRuleScope = 'channel' | 'keyword' | 'mention' | 'sender';

/**
 * The bounds on a rule, in one place because three layers have to agree on
 * them: the builder says "full" before saving, the route refuses, and the
 * evaluator drops a row that breaks them on every read. A bound only the writer
 * knows is a door check rather than an invariant — rows outlive the code that
 * wrote them.
 */
export const MAX_RULES = 50;
/** Values per scope, inside one rule. A longer OR list is a filter, not a rule. */
export const MAX_RULE_VALUES = 20;
/** Per value. Ids are far shorter and the longest useful keyword is a phrase,
 *  so this only ever refuses abuse. */
export const MAX_RULE_VALUE_LENGTH = 100;

/** Values are ids — channel ids, group ids, user ids — compared as ids, so a
 *  rename never changes what a rule matches. A label several channels share is
 *  stored as every id behind it, resolved by whoever wrote the rule; only
 *  `keyword` carries free text, having nothing to point at. */
export interface RadarRuleCondition {
  scope: RadarRuleScope;
  values: string[];
}

export interface RadarRule {
  id: string;
  conditions: RadarRuleCondition[];
}

/** One feed item, reduced to what a rule can ask about. */
export interface RadarRuleSubject {
  channelId: string;
  /** Title and context summary joined. Case is this module's problem, not the
   *  caller's — it is lowered once per subject, however many rules read it. */
  text: string;
  requestedBy: string[];
  /** Groups @mentioned by the message this item came from — what the text said,
   *  not who the engine then handed it to. */
  mentionedGroupIds: string[];
}

/** A subject whose text has been lowered. A distinct type so the matcher cannot
 *  be handed raw text by a later caller — the old contract lived in a comment,
 *  and a second caller would have got case-sensitive matching in silence. */
interface LoweredSubject extends RadarRuleSubject {
  readonly lowered: true;
}

const lower = (subject: RadarRuleSubject): LoweredSubject => ({
  ...subject,
  text: subject.text.toLowerCase(),
  lowered: true,
});

/** Not a \b anchor: a keyword may start or end with punctuation ("sign-off",
 *  "P0"), where \b anchors in the wrong place. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Whole-word scan over an already-lowered haystack, so a rule's keywords do
 *  not each re-lower the same text. Scans rather than building a RegExp — the
 *  needle is reader-typed and would need escaping. */
const scanLowered = (lowered: string, needle: string): boolean => {
  if (needle.length === 0) return false;
  let from = 0;
  for (;;) {
    const at = lowered.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : lowered[at - 1]!;
    const afterIndex = at + needle.length;
    const after = afterIndex >= lowered.length ? '' : lowered[afterIndex]!;
    const boundedLeft = before === '' || !WORD_CHAR.test(before);
    const boundedRight = after === '' || !WORD_CHAR.test(after);
    if (boundedLeft && boundedRight) return true;
    from = at + 1;
  }
};

const matchesCondition = (condition: RadarRuleCondition, subject: LoweredSubject): boolean => {
  switch (condition.scope) {
    case 'channel':
      return condition.values.includes(subject.channelId);
    case 'keyword':
      // Whole words: "test" must not claim "test2" or "latest".
      return condition.values.some(value =>
        scanLowered(subject.text, value.trim().toLowerCase()),
      );
    case 'sender':
      return condition.values.some(id => subject.requestedBy.includes(id));
    case 'mention':
      // The group the message named, never its members: expanding would change
      // what the rule means as people join and leave.
      return condition.values.some(id => subject.mentionedGroupIds.includes(id));
    default:
      return false;
  }
};

const ruleMatchesLowered = (rule: RadarRule, subject: LoweredSubject): boolean =>
  rule.conditions.length > 0 &&
  rule.conditions.every(
    condition => condition.values.length > 0 && matchesCondition(condition, subject),
  );

/** ORed within a scope, ANDed across them. Empty matches nothing: `every` over
 *  an empty list is true, so a malformed row would otherwise mute everything. */
export const ruleMatches = (rule: RadarRule, subject: RadarRuleSubject): boolean =>
  ruleMatchesLowered(rule, lower(subject));

/** Muted when any rule claims the item. Rules are ORed; a rule's own conditions
 *  are ANDed, which ruleMatches decides. */
export const isMuted = (subject: RadarRuleSubject, rules: readonly RadarRule[]): boolean => {
  if (rules.length === 0) return false;
  const lowered = lower(subject);
  return rules.some(rule => ruleMatchesLowered(rule, lowered));
};

/** Why an item reads the way it does: muted or not, and by which rules. */
export interface RadarRuleExplanation {
  muted: boolean;
  /** Every rule that claimed it, in the order sortRules puts them. */
  matched: RadarRule[];
}

/** The same answer with its working shown — the feed asks once per item per
 *  read and wants only the yes. */
export const explainItem = (
  subject: RadarRuleSubject,
  rules: readonly RadarRule[],
): RadarRuleExplanation => {
  const lowered = lower(subject);
  const matched = sortRules(rules.filter(rule => ruleMatchesLowered(rule, lowered)));
  return { muted: matched.length > 0, matched };
};

/** Most conditions first. That is how many things a rule asks about rather than
 *  how narrow it is — one channel condition listing twenty ids is broader than
 *  one keyword — but it puts the rules that say the most at the top. */
export const sortRules = (rules: readonly RadarRule[]): RadarRule[] =>
  [...rules].sort((a, b) => b.conditions.length - a.conditions.length);
