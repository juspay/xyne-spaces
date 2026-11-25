import { EXTRACTORS } from '../enc-contracts/extractors.js';
import type { DerivedFacts, ExtractorGroups, ExtractorName, ExtractorOutput, FieldFacts } from '../enc-contracts/extractors.js';
import { extractMentions } from './mentions.js';
import { extractLinks } from './links.js';
import { extractCommand } from './command.js';
import { extractText } from './text.js';
import { extractForwardedRefs } from './forwarded.js';
import { extractFlowJsonPresent } from './flow.js';
import { extractFileExtension, extractIsHeic } from './files.js';
import { extractAllMentions } from '../utils/mentionParser.js';
import { keptExtensionOf } from '../sdlc.js';
import { parseSlashCommandArtifactMessage } from '../utils/slashCommandArtifact.js';
import { parseForwardedMessageXml } from '../forwardedMessage.js';
import { getMessageContentLength } from '../utils/messageContent.js';
import { findSlackMentionIds } from '../slack/mentions.js';

export { extractMentions, extractSpecialMentionFlags } from './mentions.js';
export {
  extractLinks,
  extractUrls,
  extractFirstUrl,
  stripAndDecodeHtml,
  trimSurroundingPunctuation,
  URL_REGEX,
  PR_LINK_REGEX,
  GOOGLE_MEET_REGEX,
} from './links.js';
export {
  extractCommand,
  parseBotCommandText,
  isBotCommandContent,
  stripBotCommandContent,
  BOT_COMMAND_REGEX,
  BOT_PARAM_REGEX,
} from './command.js';
export type { ParsedBotCommandText } from './command.js';
export { extractText } from './text.js';
export { extractForwardedRefs } from './forwarded.js';
export type { ForwardedRefs } from './forwarded.js';
export { extractFlowJsonPresent } from './flow.js';
export { extractFileExtension, extractIsHeic } from './files.js';

/**
 * The parsers the facts come from, each run at most once per text however many of its facts
 * are asked for, plus the raw text for single-step facts.
 */
type Groups = { [G in keyof ExtractorGroups]: () => ExtractorGroups[G] } & { readonly raw: string };

function groupsFor(text: string): Groups {
  const memo: Partial<ExtractorGroups> = {};
  return {
    mentions: () => (memo.mentions ??= extractMentions(text)),
    links: () => (memo.links ??= extractLinks(text)),
    command: () => (memo.command === undefined ? (memo.command = extractCommand(text)) : memo.command),
    text: () => (memo.text ??= extractText(text)),
    forwarded: () => (memo.forwarded ??= extractForwardedRefs(text)),
    raw: text,
  };
}

/**
 * One function per fact, typed against ExtractorOutput: a name in EXTRACTORS without a
 * function here, or a function returning the wrong type, does not compile.
 */
const EXTRACTOR_FNS: { [K in ExtractorName]: (g: Groups) => ExtractorOutput[K] } = {
  userIds: g => g.mentions().userIds,
  groupIds: g => g.mentions().groupIds,
  handles: g => g.mentions().handles,
  mentionsChannel: g => g.mentions().channel,
  mentionsHere: g => g.mentions().here,
  allUrls: g => g.links().all,
  firstUrl: g => g.links().first,
  prLinks: g => g.links().pr,
  meetLinks: g => g.links().meet,
  isBotCommand: g => g.command()?.isBot ?? false,
  commandName: g => g.command()?.name ?? null,
  commandArgs: g => g.command()?.args ?? null,
  textLength: g => g.text().length,
  textIsEmpty: g => g.text().isEmpty,
  rawLength: g => g.raw.length,
  flowJsonPresent: g => extractFlowJsonPresent(g.raw),
  forwardedMessageId: g => g.forwarded().messageId,
  forwardedConversationId: g => g.forwarded().conversationId,
  forwardedChannelId: g => g.forwarded().channelId,
  forwardedSenderId: g => g.forwarded().senderId,
  fileExtension: g => extractFileExtension(g.raw),
  isHeic: g => extractIsHeic(g.raw),
  spanMentionUserIds: g => extractAllMentions(g.raw).userIds,
  fileExtensionAsIs: g => keptExtensionOf(g.raw),
  spanMentionGroupIds: g => extractAllMentions(g.raw).groupIds,
  slashArtifactCommand: g => parseSlashCommandArtifactMessage(g.raw)?.definition.command ?? null,
  forwardedOptionalTextUserIds: g => extractAllMentions(forwardedOptionalTextOf(g.raw)).userIds,
  forwardedOptionalTextGroupIds: g => extractAllMentions(forwardedOptionalTextOf(g.raw)).groupIds,
  forwardedOptionalTextLength: g => getMessageContentLength(forwardedOptionalTextOf(g.raw)),
  forwardedHasOptionalText: g => forwardedOptionalTextOf(g.raw) !== '',
  slackMentionUserIds: g => findSlackMentionIds(g.raw).users,
  slackMentionGroupIds: g => findSlackMentionIds(g.raw).groups,
  slackMentionChannels: g => findSlackMentionIds(g.raw).channels,
};

/** A forwarded message's optional text ('' when none, or when the text is not a forward). */
function forwardedOptionalTextOf(text: string): string {
  return parseForwardedMessageXml(text)?.optionalText ?? '';
}

/**
 * Computes the named facts for ONE field's plaintext. Pure (no I/O), so the encryption service
 * can run it next to the plaintext and hand the backend only the facts. Each underlying parser
 * runs once however many of its facts are asked for.
 */
export function runExtractors(text: string, names: readonly ExtractorName[]): FieldFacts {
  const groups = groupsFor(text);
  const facts: FieldFacts = {};
  for (const name of names) {
    (facts as Record<string, unknown>)[name] = EXTRACTOR_FNS[name](groups);
  }
  return facts;
}

/**
 * The facts for a request body whose source fields arrived as plaintext: per field, the facts
 * its contract entry names are computed from the field's text, and the results are keyed by
 * field. Nothing is merged across fields. A field is skipped when it is not a non-empty
 * string or is already ciphertext (`ENC:`). This is the backend's stand-in for the encryption
 * service's transform when the client did not encrypt, so a handler reads the same `derived`
 * either way. Returns undefined when no field produced facts.
 */
export function deriveFactsFromPlaintext(
  body: Record<string, unknown>,
  selection: Readonly<Record<string, readonly string[] | undefined>>,
): DerivedFacts | undefined {
  const fields: Record<string, FieldFacts> = {};
  for (const field of Object.keys(selection).sort()) {
    const names = (selection[field] ?? []).filter((n): n is ExtractorName => (EXTRACTORS as readonly string[]).includes(n));
    if (names.length === 0) continue;
    const value = body[field];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('ENC:')) continue;
    fields[field] = runExtractors(value, names);
  }
  return Object.keys(fields).length === 0 ? undefined : { version: 2, fields };
}
