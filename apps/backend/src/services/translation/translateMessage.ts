import { parse, NodeType, type HTMLElement } from 'node-html-parser';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { messageMetadataService } from '@/services/messageMetadataService';
import { detectSourceLanguage } from './detectLanguage';
import { SUPPORTED_LANGUAGES } from './languageCodes';
import { isConfigured as isLibreConfigured, translateTextLibre } from './libreTranslator';

const DETECTION_CANDIDATES = SUPPORTED_LANGUAGES.map(l => l.iso6391);

/**
 * `conversation.initial_message_md` is a denormalized snapshot of only the
 * conversation's initial message (see docs on channelConversationsPaginatedV3) — a
 * thread reply already syncs live via its own relation, so re-syncing the snapshot
 * for a reply would be wasted work against the wrong message.
 */
async function resyncIfInitialMessage(messageId: string, conversationId: string): Promise<void> {
  const conversation = await db.conversation.findUnique({
    where: { conversationId },
    select: { initialMessageId: true },
  });
  if (conversation?.initialMessageId === messageId) {
    await messageMetadataService.syncInitialMessageMd(conversationId);
  }
}

/**
 * `Message.content` is rich-text HTML (e.g. `<p class="m-0 leading-6">Hello</p>`), not
 * plain text — franc chokes on markup mixed into the text (garbage detection), so this
 * must run before it sees it.
 */
const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Inline-level tags: an element made up only of these (plus text) carries no block
 * structure of its own — it's a formatting run *within* a paragraph/bullet, not a
 * paragraph/bullet itself. Everything else (p, li, ul, h1-h6, blockquote, div, ...) is
 * a block boundary worth preserving as its own translation unit.
 */
const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'span', 'code', 'mark', 'sub', 'sup', 'a', 'br']);

/** True if every element child is inline — i.e. `el` is itself one translatable unit
 * (a paragraph or bullet), not a container of further block-level children. */
const isLeafBlock = (el: HTMLElement): boolean =>
  el.childNodes.every(
    child =>
      child.nodeType !== NodeType.ELEMENT_NODE || INLINE_TAGS.has((child as HTMLElement).rawTagName?.toLowerCase()),
  );

/**
 * Elements that carry state beyond their visible text — a mention's user/channel id, a
 * link's href — must never be handed to the translator as text, and must never be
 * dropped by collapsing the block down to one translated text node.
 *
 * Handing "@admin" to LibreTranslate as ordinary text produced `@narendramodi` back —
 * the MT model doesn't know it's a protected identifier and is free to substitute a
 * more "plausible" name for an unfamiliar token. A placeholder-token approach (swap the
 * mention for a marker, translate, swap back) was tried and rejected: LibreTranslate
 * does not reliably preserve an arbitrary token verbatim either (`[[[0]]]` came back as
 * `[[0]]]]` in Hindi, `[[0]]` in Spanish) — so nothing that passes through translation
 * can be trusted to survive unchanged. These elements are therefore never sent to the
 * translator at all; see `collectSegments` below.
 */
const isProtectedElement = (el: HTMLElement): boolean => {
  const tag = el.rawTagName?.toLowerCase();
  if (tag === 'a') return true;
  if (tag === 'span' && (el.hasAttribute('data-mention') || el.hasAttribute('data-channel-mention'))) return true;
  return false;
};

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Segment = { kind: 'text'; value: string } | { kind: 'protected'; html: string };

/**
 * Flattens a leaf block into an ordered list of segments: runs of plain text (formatting
 * tags like `<strong>` are flattened into the surrounding text, same trade-off as
 * before) interleaved with protected elements kept as their original, untouched HTML.
 */
function collectSegments(el: HTMLElement, segments: Segment[]): void {
  for (const child of el.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      const text = (child as unknown as { rawText: string }).rawText;
      const last = segments[segments.length - 1];
      if (last?.kind === 'text') last.value += text;
      else segments.push({ kind: 'text', value: text });
    } else if (child.nodeType === NodeType.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      if (isProtectedElement(childEl)) {
        segments.push({ kind: 'protected', html: childEl.toString() });
      } else {
        collectSegments(childEl, segments);
      }
    }
  }
}

/**
 * Translates one leaf block (paragraph/bullet/heading), preserving any protected
 * elements (mentions, links) untouched. A block with no protected elements costs one
 * LibreTranslate call, same as before; a block with N of them costs up to N+1 calls
 * (one per plain-text run between/around them) — mentions are common in chat, whole
 * messages rarely are, so this only adds calls to the blocks that actually need it.
 */
async function translateLeafBlock(el: HTMLElement, sourceIso6391: string, targetIso6391: string): Promise<void> {
  const segments: Segment[] = [];
  collectSegments(el, segments);

  if (segments.every(s => s.kind === 'text')) {
    const text = segments.map(s => (s as { value: string }).value).join('');
    if (text.trim()) el.textContent = await translateTextLibre(text, sourceIso6391, targetIso6391);
    return;
  }

  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.kind === 'protected') {
      parts.push(segment.html);
      continue;
    }
    // LibreTranslate trims leading/trailing whitespace from its output — harmless
    // inside a paragraph, but it silently collapses the space that keeps this segment
    // visually separated from an adjacent mention/link, so it's preserved explicitly
    // rather than trusted to survive the round trip.
    const [, leading = '', core = '', trailing = ''] = segment.value.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? [];
    const translatedCore = core.trim() ? await translateTextLibre(core, sourceIso6391, targetIso6391) : core;
    parts.push(escapeHtml(leading) + escapeHtml(translatedCore) + escapeHtml(trailing));
  }
  el.set_content(parts.join(''));
}

/**
 * Translates `html` while preserving its block structure — `<p>` breaks, `<ul>`/`<li>`
 * bullets, headings, etc. Feeding the whole HTML blob to the translator in one shot
 * meant stripping every tag first, so a bulleted message came back as one flat
 * paragraph with the structure gone for good, not just visually but in the stored
 * `translatedText` itself.
 *
 * Translates per *block* (one LibreTranslate call per paragraph/bullet/heading), not
 * per individual inline run: calling per text node is correct but a message with
 * several bold phrases in one paragraph fans out into a dozen-plus sequential calls.
 * Grouping by block keeps every paragraph break and bullet point, at the cost of
 * inline emphasis (bold/italic) inside a block collapsing to plain text in translation.
 *
 * Calls stay sequential, in document order — never batched into one request: batching
 * independent runs of different lengths into a single call risks them bleeding into
 * each other depending on how the backend pads/handles the batch, so one call per
 * block/segment is the safe shape.
 */
async function translateHtml(html: string, sourceIso6391: string, targetIso6391: string): Promise<string> {
  const root = parse(html);

  const translateBlocks = async (el: HTMLElement): Promise<void> => {
    if (isLeafBlock(el)) {
      await translateLeafBlock(el, sourceIso6391, targetIso6391);
      return;
    }
    for (const child of el.childNodes) {
      if (child.nodeType === NodeType.ELEMENT_NODE) await translateBlocks(child as HTMLElement);
    }
  };
  await translateBlocks(root);

  return root.toString();
}

/**
 * Write-time, cheap-only step (Slack model): detect what language a message is
 * written in, restricted to our supported-language list rather than the whole room —
 * whether to show the "Translate" toggle to a given viewer is decided client-side by
 * comparing this against *that viewer's* default translation language, not by anything
 * about who else is in the room. franc only — no translation call here — so this is
 * safe to run on every message.
 *
 * Called off the send path by translationQueue — see
 * apps/backend/src/queues/translationQueue.ts.
 */
export async function detectMessageLanguage(messageId: string): Promise<{ detected: string | null }> {
  const message = await db.message.findUnique({
    where: { messageId },
    select: { messageId: true, content: true, conversationId: true, sourceLang: true },
  });
  if (!message) {
    // Distinct from every other skip below: this means "the row isn't visible yet."
    // Throwing lets Bull's retry/backoff catch the rare case where ENQUEUE_DELAY_MS
    // (translationQueue.ts) wasn't enough — e.g. the enclosing transaction committing
    // unusually slowly.
    throw new Error(`[DetectMessageLanguage] Message ${messageId} not found (not yet committed?)`);
  }
  if (message.sourceLang) return { detected: message.sourceLang };

  const plainText = stripHtml(message.content);
  if (!plainText) return { detected: null };

  const detected = detectSourceLanguage(plainText, DETECTION_CANDIDATES);
  if (!detected) return { detected: null };

  await db.message.update({ where: { messageId }, data: { sourceLang: detected } });
  await resyncIfInitialMessage(messageId, message.conversationId);

  return { detected };
}

export interface TranslateOnDemandResult {
  translated: boolean;
  skipped?: string;
}

/**
 * Click-time translation (Slack model): translate one message into one target
 * language, on request, the first time anyone asks for that pair — cached afterward
 * in `message_translations` so a second click (by anyone) is instant. This is the
 * only place LibreTranslate actually runs; write time never does.
 */
export async function translateMessageOnDemand(
  messageId: string,
  targetLang: string,
): Promise<TranslateOnDemandResult> {
  const message = await db.message.findUnique({
    where: { messageId },
    select: {
      messageId: true,
      content: true,
      workspaceId: true,
      conversationId: true,
      sourceLang: true,
    },
  });
  if (!message) {
    throw new Error(`[TranslateOnDemand] Message ${messageId} not found (not yet committed?)`);
  }

  const plainText = stripHtml(message.content);
  if (!plainText) return { translated: false, skipped: 'empty-content' };

  let sourceLang = message.sourceLang;
  if (!sourceLang) {
    sourceLang = detectSourceLanguage(plainText, DETECTION_CANDIDATES);
    if (sourceLang) {
      await db.message.update({ where: { messageId }, data: { sourceLang } });
    }
  }
  if (!sourceLang) return { translated: false, skipped: 'source-undetected' };
  if (sourceLang === targetLang) return { translated: false, skipped: 'already-target-language' };
  if (!isLibreConfigured()) return { translated: false, skipped: 'libretranslate-not-configured' };

  const translatedHtml = await translateHtml(message.content, sourceLang, targetLang);
  await db.messageTranslation.upsert({
    where: { messageId_targetLang: { messageId, targetLang } },
    create: {
      workspaceId: message.workspaceId,
      messageId,
      targetLang,
      translatedText: translatedHtml,
    },
    update: { translatedText: translatedHtml },
  });

  await resyncIfInitialMessage(messageId, message.conversationId);

  logger.info('[TranslateOnDemand] Translated message', { messageId, sourceLang, targetLang });
  return { translated: true };
}
