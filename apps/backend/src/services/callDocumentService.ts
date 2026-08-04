/**
 * Call Document Service - Generates documents from call transcripts
 * Handles both PRD (Product Requirements Documents) and Detailed Summaries
 * Creates Canvas documents and posts them to conversations via Xyne Automatic bot
 */

import { v4 as uuidv4 } from 'uuid';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { DEFAULT_SUMMARY_FIELDS, MessageType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { formatToISTLocaleString } from '@/utils/dateUtils';
import { CanvasRole } from '@prisma/client';
import { ServerBlockNoteEditor } from '@blocknote/server-util';
import { getCanvasUrl, findExistingDetailedSummaryCanvas } from '@/services/canvasService';
import { CanvasSideEffectHandler } from '@/zero/side-effects/tables/canvas-handler';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { db } from '@/database/client';
import type {
  BlockNoteBlock,
  BlockNoteTableBlock,
  BlockNoteInlineContent,
} from '@/types/blockNoteTypes';
import {
  buildSummaryTemplateSelectionPrompt,
  parseSelectedSummaryTemplate,
  type SummaryTemplateCandidate,
} from './summaryTemplateSelection';
import {
  BUILTIN_RECORDING_SUMMARY_TEMPLATES,
  DEFAULT_RECORDING_SUMMARY_FIELDS,
  RECORDING_DETAILED_SUMMARY_PROMPT,
  getBuiltinRecordingSummaryTemplate,
  type BuiltinRecordingSummaryTemplate,
  type BuiltinRecordingSummaryTemplateId,
} from './recordingSummaryTemplates';

// PRD Document structure
interface PRDDocument {
  title: string;
  problemStatement: string;
  userStories: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  acceptanceCriteria: string[];
  outOfScope: string[];
  openQuestions: string[];
  participants: string[];
}

// Participant information for mentions
interface ParticipantInfo {
  userId: string;
  username: string;
  userEmail: string;
  userPicture?: string;
}

import { executeStreamingLlmRequest } from './callLlmRetry';
import { initializeYSweetDoc, syncToYSweet } from '@/utils/ysweetUtils.js';

/**
 * Sanitize input strings to prevent injection attacks
 * Removes control characters and limits length
 */
function sanitizeInput(input: string | null): string {
  if (!input) return '';

  // Remove null bytes and other control characters except newlines and tabs
  const sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Limit length to prevent excessive token usage (adjust as needed)
  const maxLength = 100000; // ~100K chars
  return sanitized.length > maxLength ? sanitized.substring(0, maxLength) : sanitized;
}

function renderPromptTemplate(template: string, values: Record<string, string>): string {
  const replacements = new Map(Object.entries(values));
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    replacements.has(key) ? (replacements.get(key) ?? '') : match,
  );
}

// ── Call-summary citations ───────────────────────────────────────────────────
// Mirrors xyne-claw's `clf-` pattern: the summariser LLM emits a compact inline
// token `[clf-<n>]` after a claim (never a link), where <n> is the transcript
// SEGMENT number shown in the numbered transcript we feed it. Each token is
// mapped to a self-contained BlockNote `citation` inline node whose props carry
// the segment's metadata, so a citation survives canvas regeneration and the
// frontend chip can open the transcript at that moment.
const CITATION_TOKEN_RE = /\[clf-(\d+)\]/g;
const MAX_CITATION_SNIPPET = 300;

interface CitationSegment {
  n: number;
  timestamp: string; // "MM:SS" or "HH:MM:SS"
  speaker: string;
  speakerId?: string; // resolved participant userId (best-effort) → real avatar on the chip
  text: string;
}
export interface CitationContext {
  callId: string;
  segments: Map<number, CitationSegment>;
}

// A single formatted transcript line: "[MM:SS] Speaker: text".
const TRANSCRIPT_LINE_RE = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+?):\s*([\s\S]*)$/;

/**
 * Parse a formatted transcript ("[MM:SS] Speaker: text" lines) into numbered
 * segments AND produce a copy with each line prefixed by its segment number
 * (`[12] [03:24] Alice: …`) for the LLM to cite. Deterministic, so numbering for
 * the prompt and building the citation map from the SAME transcript string always
 * agree on segment ids. Non-matching lines pass through and are not numbered.
 */
export function numberTranscriptSegments(formatted: string): { numbered: string; segments: CitationSegment[] } {
  const numberedLines: string[] = [];
  const segments: CitationSegment[] = [];
  let n = 0;
  for (const rawLine of formatted.split('\n')) {
    const m = rawLine.trimEnd().match(TRANSCRIPT_LINE_RE);
    if (!m) {
      numberedLines.push(rawLine);
      continue;
    }
    n += 1;
    const [, timestamp, speaker, text] = m;
    segments.push({ n, timestamp, speaker: speaker.trim(), text: text.trim() });
    numberedLines.push(`[${n}] [${timestamp}] ${speaker}: ${text}`);
  }
  return { numbered: numberedLines.join('\n'), segments };
}

/**
 * Build one BlockNote `citation` inline node from one-or-more consecutive
 * segments. Top-level props mirror the FIRST segment (single-chip render + the
 * modal-open default + the server-spec textContent); the full run is carried as
 * a JSON `segments` array so the frontend can render a grouped "cluster" chip.
 */
function buildCitationNode(callId: string, segs: CitationSegment[]): BlockNoteInlineContent {
  const first = segs[0]!;
  return {
    type: 'citation',
    props: {
      callId,
      segment: String(first.n),
      timestamp: first.timestamp,
      speaker: first.speaker,
      speakerId: first.speakerId ?? '',
      snippet: first.text.slice(0, MAX_CITATION_SNIPPET),
      segments: JSON.stringify(
        segs.map(s => ({
          n: s.n,
          timestamp: s.timestamp,
          speaker: s.speaker,
          speakerId: s.speakerId ?? '',
          snippet: s.text.slice(0, MAX_CITATION_SNIPPET),
        })),
      ),
    },
  };
}

/**
 * Expand `[clf-<n>]` tokens in a text run into BlockNote `citation` inline nodes.
 * - a RUN of tokens separated only by whitespace → ONE grouped citation node
 * - known segment  → included in the group's metadata
 * - unknown segment / no context → dropped (never leaks as literal text); a group
 *   whose tokens are ALL unknown collapses to nothing
 * Returns the input as a single text node when there is nothing to expand, so
 * callers can splice the result unconditionally.
 */
function expandCitations(
  text: string,
  styles: { bold?: boolean; italic?: boolean; code?: boolean },
  citationCtx?: CitationContext,
): BlockNoteInlineContent[] {
  if (!text) return [];
  if (text.indexOf('[clf-') === -1) return [{ type: 'text', text, styles }];

  const out: BlockNoteInlineContent[] = [];
  const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
  const matches: Array<{ index: number; end: number; n: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push({ index: m.index, end: m.index + m[0].length, n: Number(m[1]) });
  }

  let last = 0;
  let i = 0;
  while (i < matches.length) {
    // Coalesce consecutive tokens separated ONLY by whitespace into one group.
    let j = i;
    while (j + 1 < matches.length && /^\s*$/.test(text.slice(matches[j]!.end, matches[j + 1]!.index))) {
      j += 1;
    }
    const groupStart = matches[i]!.index;
    const groupEnd = matches[j]!.end;
    let pre = text.slice(last, groupStart);

    const segs: CitationSegment[] = [];
    for (let k = i; k <= j; k++) {
      const seg = citationCtx?.segments.get(matches[k]!.n);
      if (seg) segs.push(seg);
    }

    if (segs.length > 0) {
      // Chip hugs the preceding word (drop the space before), KEEP the space after.
      if (pre.endsWith(' ')) pre = pre.slice(0, -1);
      if (pre) out.push({ type: 'text', text: pre, styles });
      out.push(buildCitationNode(citationCtx!.callId, segs));
      last = groupEnd;
    } else {
      // Whole group unknown → strip the token(s) and NORMALIZE the surrounding
      // whitespace so no stray leading / doubled / pre-punctuation space is left
      // (mirrors the resolved branch, which drops the space before the chip):
      //   "in Q4 [clf-x]."  → "in Q4."      (drop space before punctuation)
      //   "foo [clf-x] bar" → "foo bar"     (collapse the doubled space)
      //   "[clf-x] bar"     → "bar"         (drop the leading space at run start)
      if (pre.endsWith(' ')) {
        pre = pre.slice(0, -1); // drop the space before the removed token; keep what follows
        last = groupEnd;
      } else if (text[groupEnd] === ' ') {
        last = groupEnd + 1; // run start / after punctuation: drop the space AFTER instead
      } else {
        last = groupEnd;
      }
      if (pre) out.push({ type: 'text', text: pre, styles });
    }
    i = j + 1;
  }

  const tail = text.slice(last);
  if (tail) out.push({ type: 'text', text: tail, styles });
  // NOTE: `out` may be empty here — the whole run was citation token(s) that got
  // stripped/converted. Returning the ORIGINAL text would leak the raw `[clf-n]`
  // token as literal prose, so return `out` as-is (the early no-token guard
  // already handled the nothing-to-expand case).
  return out;
}

/**
 * Parse text content to extract @mentions and convert to BlockNote inline content.
 * Example: "Task for @Mayank Bansal" -> [text, mention, text]
 *
 * Builds a dynamic regex from participant names so the entire text is tokenised
 * in a single `split` pass — no manual index arithmetic needed.
 * Matched user IDs are collected into `mentionedIds` for the caller.
 */
function parseTextWithMentions(
  text: string,
  participantMap: Map<string, ParticipantInfo>,
  applyBold = false,
  mentionedIds?: Set<string>,
  citationCtx?: CitationContext,
): BlockNoteInlineContent[] {
  if (!text) return [];

  const textStyles = applyBold ? { bold: true } : {};

  // Fast path: no participants to match against (still expand/strip citations).
  if (participantMap.size === 0) {
    return expandCitations(text, textStyles, citationCtx);
  }

  // Escape special regex chars in each name; sort longest-first for greedy match
  const regexReadyNames = Array.from(participantMap.keys())
    .sort((a, b) => b.length - a.length)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  // Capturing group keeps the matched delimiter in the split result array
  const mentionPattern = new RegExp(`(@(?:${regexReadyNames.join('|')}))`, 'i');

  const result: BlockNoteInlineContent[] = [];

  for (const segment of text.split(mentionPattern)) {
    if (!segment) continue;

    if (segment.startsWith('@')) {
      const key = segment.slice(1).toLowerCase();
      const info = participantMap.get(key);

      if (info) {
        logger.info(`[CallDocumentService] ✅ Matched ${segment} to ${info.username}`);
        mentionedIds?.add(info.userId);
        result.push({
          type: 'mention',
          props: {
            userId: info.userId,
            username: info.username,
            userEmail: info.userEmail,
            userPicture: info.userPicture ?? '',
          },
        });
        continue;
      }
    }

    // Plain text segment (or unmatched @) — expand/strip citation tokens within.
    result.push(...expandCitations(segment, textStyles, citationCtx));
  }

  return result;
}


/**
 * Build participant map from the channel that owns the call.
 * Maps lowercase participant name -> participant info.
 * Using channel participants (not just call attendees) ensures the AI prompt
 * and @mention resolution covers everyone who could be referenced.
 */
export async function buildParticipantMap(channelId: string): Promise<Map<string, ParticipantInfo>> {
  const participantMap = new Map<string, ParticipantInfo>();

  try {
    const participants = await repositories.channelParticipants.getChannelParticipantsWithUserDetails(channelId);

    if (participants.length === 0) {
      logger.warn(`[CallDocumentService] No channel participants found for channelId=${channelId}`);
      return participantMap;
    }

    for (const participant of participants) {
      const lowerName = participant.userName.toLowerCase();
      participantMap.set(lowerName, {
        userId: participant.userId,
        username: participant.userName,
        userEmail: participant.userEmail,
        userPicture: participant.userPicture || undefined,
      });
      logger.info(`[CallDocumentService] Added channel participant to map: "${participant.userName}" (lowercase: "${lowerName}") -> ${participant.userId}`);
    }

    logger.info(`[CallDocumentService] Built participant map with ${participantMap.size} channel participants for channelId=${channelId}`);
    logger.info(`[CallDocumentService] Participant names in map: ${Array.from(participantMap.keys()).join(', ')}`);
  } catch (error) {
    logger.error('[CallDocumentService] Error building participant map:', error);
  }

  return participantMap;
}

// PRD Generation prompt
const PRD_GENERATION_PROMPT = `You are a senior product manager creating a Product Requirements Document (PRD) from a call transcript.

Analyze the conversation and extract product requirements discussed during the call.

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls")

Return ONLY a valid JSON object with this exact structure:
\`\`\`json
{
  "title": "Brief PRD title based on main topic discussed",
  "problemStatement": "Clear description of the problem being solved",
  "userStories": ["As a [user], I want [functionality] so that [benefit]", ...],
  "functionalRequirements": ["Specific functional requirement 1", ...],
  "nonFunctionalRequirements": ["Performance, security, etc. requirements", ...],
  "acceptanceCriteria": ["Testable acceptance criteria", ...],
  "outOfScope": ["Things explicitly not included", ...],
  "openQuestions": ["Unresolved questions from discussion", ...],
  "participants": ["List of participants from transcript"]
}
\`\`\`

IMPORTANT:
- Extract real requirements from the discussion, not generic placeholders
- If a section has no relevant content, use an empty array []
- Keep each item concise but specific
- Return ONLY the JSON, no additional commentary

CALL TRANSCRIPT:
{transcript}

CALL SUMMARY:
{summary}
`;

const DETAILED_SUMMARY_PROMPT = `You are creating a comprehensive, phase-based meeting summary that captures the natural flow of conversation.
**LANGUAGE: Generate this entire summary in English, regardless of the transcript language.**

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls")

Analyze the transcript and divide it into distinct phases/segments based on topic shifts or conversation flow.

**PHASE GUIDELINES (based on call length):**
- Very short calls (< 5 min): 1-2 phases
- Short calls (5-15 min): 2-3 phases
- Medium calls (15-30 min): 3-5 phases
- Long calls (30+ min): 5-7 phases

MARKDOWN TEMPLATE:


{fields}

**CALL PARTICIPANTS (Correct Names):**
{participants}

**IMPORTANT - NAME ACCURACY:**
- The transcript may contain misspelled or incorrectly transcribed participant names
- If a name in the transcript seems close to a participant name, use the correct version from the list
- For @mentions in Action Items, use the full correct name (e.g., @Mayank Bansal)

**INSTRUCTIONS:**
- Determine call length from transcript and use appropriate number of phases (1-7)
- Short/quick calls should have FEWER phases - don't force many phases on a brief discussion
- Each phase should represent a natural shift in topic or conversation flow
- Capture ACTUAL content from the transcript - no generic placeholders
- Include specific names, numbers, dates mentioned
- Preserve chronological order of discussion
- Skip sections that have no relevant content
- For very short calls, the "Consolidated Outcomes" section may be the most valuable part
- In Action Items: Use @ before FULL NAMES for participants in the call (e.g., @Mayank Bansal)
- In Action Items: For people NOT in the participant list, write their name plainly with "(not in channel)" notation

**CITATIONS (IMPORTANT):**
- Each transcript line is prefixed with a segment number in square brackets, e.g. "[12] [03:24] Alice: ...". The number 12 is that line's segment id.
- After any specific claim, decision, action item, number, date, name, or quote you draw from the transcript, cite the segment(s) it came from INLINE using the exact token [clf-N], where N is that segment's number. Example: "The team agreed to ship the API redesign in Q4 [clf-12]."
- Cite the MOST specific segment(s) that support the statement. You may place up to 3 tokens together, e.g. "...scope was cut [clf-8][clf-9]".
- Copy the number EXACTLY from the transcript. Do NOT invent segment numbers. Do NOT use ranges like [clf-8-11]. Only cite segment numbers that actually appear in the transcript above; if a line has no bracketed number, do not cite it.
- Write ONLY the bare token [clf-N] — never a link, URL, footnote, or a separate "Citations"/"Sources" section.

Only output valid Markdown.
No extra text.

TRANSCRIPT:
{transcript}
`;

const EDIT_SUMMARY_PROMPT = `You are an assistant that edits a MARKDOWN SECTION TEMPLATE used to generate call summaries. You will be given the CURRENT TEMPLATE and a USER INSTRUCTION, and you must return the UPDATED TEMPLATE.

WHAT THIS TEMPLATE IS:
- After every call ends, the system automatically generates a "Detailed Call Summary" from the call transcript.
- This template defines the SECTIONS and STRUCTURE of that summary (e.g. Key Takeaways, Action Items, Call Overview, Call Phases, Consolidated Outcomes, Follow-up).
- It is configured per channel. Whatever sections exist in this template are what every detailed summary for that channel will contain.

HOW IT IS USED (so your edits stay valid):
- The template you produce is inserted into a larger fixed prompt and sent to another LLM along with the call transcript. That LLM fills in the sections with real content from the transcript.
- The generated markdown is then converted into a collaborative canvas document (BlockNote). Standard Markdown renders correctly: headings (###), bold, bullet/numbered lists, checkboxes (- [ ]), and GitHub-flavored tables (| col | col |). Prefer these constructs.
- The surrounding fixed prompt ALREADY handles the following — do NOT add instructions or placeholders for them:
  - The participant list is injected separately; do not add a {participants} or {transcript} placeholder.
  - Output language is forced to English.
  - Brand-name correction: speech-to-text mis-hearings of "Xyne" (Zain/Zine/Xine/Zyne) are auto-corrected.
  - Phase count scales with call length (short calls get fewer phases).
  - Name accuracy & mentions: in Action Items, people who attended the call are written as @ + their FULL NAME (e.g. @Mayank Bansal) so they become real user mentions in the channel; people NOT in the call are written plainly with "(not in channel)". Preserve this convention if the template references assignees/owners.

RULES FOR YOUR EDIT:
- Apply the USER INSTRUCTION to the CURRENT TEMPLATE: add, remove, reorder, rename, or restructure sections as asked.
- Keep it as a clean Markdown template with clear subheadings separated by blank lines.
- Keep bracketed placeholders (e.g. [Most important outcome], [Task], [Person]) so the generating LLM knows what to fill in.
- Keep tables in valid GitHub-flavored Markdown if the section is tabular.
- Do not invent transcript content; this is a TEMPLATE, not a filled summary.
- If the instruction is unclear or out of scope, make the smallest reasonable change and keep the rest intact.

OUTPUT:
- Return ONLY the updated Markdown template. No commentary, no explanation, no code fences.

CURRENT TEMPLATE:
{current}

USER INSTRUCTION:
{instruction}
`;

/**
 * Format PRD document to BlockNote content
 */
function formatPRDToBlockNote(prd: PRDDocument, callId: string): BlockNoteBlock[] {
  const blocks: BlockNoteBlock[] = [];

  // Title
  blocks.push({
    id: uuidv4(),
    type: 'heading',
    props: { level: 1 },
    content: [{ type: 'text', text: `📋 PRD: ${prd.title}`, styles: { bold: true } }],
    children: [],
  });

  // Metadata line
  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [
      { type: 'text', text: `Generated from call `, styles: {} },
      { type: 'text', text: callId, styles: { code: true } },
      { type: 'text', text: ` on ${new Date().toLocaleDateString()}`, styles: {} },
    ],
    children: [],
  });

  // Empty line
  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [],
    children: [],
  });

  // Helper to add section
  const addSection = (title: string, items: string[], emoji: string) => {
    if (items.length === 0) return;

    blocks.push({
      id: uuidv4(),
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: `${emoji} ${title}`, styles: { bold: true } }],
      children: [],
    });

    items.forEach((item) => {
      blocks.push({
        id: uuidv4(),
        type: 'bulletListItem',
        content: [{ type: 'text', text: item, styles: {} }],
        children: [],
      });
    });

    // Empty line after section
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [],
      children: [],
    });
  };

  // Problem Statement (as paragraph)
  if (prd.problemStatement) {
    blocks.push({
      id: uuidv4(),
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: '🎯 Problem Statement', styles: { bold: true } }],
      children: [],
    });
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [{ type: 'text', text: prd.problemStatement, styles: {} }],
      children: [],
    });
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [],
      children: [],
    });
  }

  // Sections
  addSection('User Stories', prd.userStories, '👤');
  addSection('Functional Requirements', prd.functionalRequirements, '⚙️');
  addSection('Non-Functional Requirements', prd.nonFunctionalRequirements, '🔒');
  addSection('Acceptance Criteria', prd.acceptanceCriteria, '✅');
  addSection('Out of Scope', prd.outOfScope, '🚫');
  addSection('Open Questions', prd.openQuestions, '❓');
  addSection('Participants', prd.participants, '👥');

  return blocks;
}

/**
 * Convert markdown to BlockNote JSON format with mention support.
 * Returns both the blocks and the set of user IDs that were actually mentioned,
 * collected in a single pass — no second scan needed.
 */
async function convertMarkdownToBlockNote(
  markdown: string,
  participantMap: Map<string, ParticipantInfo> = new Map(),
  citationCtx?: CitationContext,
): Promise<{ blocks: BlockNoteBlock[]; mentionedUserIds: string[] }> {
  try {
    const editor = ServerBlockNoteEditor.create();
    const parsed = await editor.tryParseMarkdownToBlocks(markdown);

    // Collect mentioned IDs during the mention-processing pass
    const mentionedIds = new Set<string>();
    const blocks = processBlocksForMentions(parsed as BlockNoteBlock[], participantMap, mentionedIds, citationCtx);

    logger.info(`[CallDocumentService] Total unique mentioned user IDs found: ${mentionedIds.size}`);
    return { blocks, mentionedUserIds: Array.from(mentionedIds) };
  } catch (error) {
    logger.error('[CallDocumentService] Error converting markdown to BlockNote:', error);
    return { blocks: [], mentionedUserIds: [] };
  }
}

/**
 * Process BlockNote blocks to convert @mentions in text content.
 * Handles tables (cells), regular inline blocks, and children — all in one place.
 */
function processBlocksForMentions(
  blocks: BlockNoteBlock[],
  participantMap: Map<string, ParticipantInfo>,
  mentionedIds: Set<string>,
  citationCtx?: CitationContext,
): BlockNoteBlock[] {
  // Processes an array of inline items: text nodes are split on @mentions and
  // `[clf-n]` citation tokens; everything else (existing mentions, links, etc.)
  // passes through untouched.
  const processInline = (content: BlockNoteInlineContent[]): BlockNoteInlineContent[] =>
    content.flatMap(item =>
      item.type === 'text' && item.text
        ? parseTextWithMentions(item.text, participantMap, item.styles?.bold ?? false, mentionedIds, citationCtx)
        : [item]
    );

  return blocks.map(block => {
    if (block.type === 'table') {
      const t = block as BlockNoteTableBlock;
      return {
        ...t,
        content: {
          ...t.content,
          rows: t.content.rows.map(row => ({
            ...row,
            cells: row.cells.map(cell => ({ ...cell, content: processInline(cell.content) })),
          })),
        },
      } as BlockNoteTableBlock;
    }

    return {
      ...block,
      ...('content' in block && Array.isArray(block.content)
        ? { content: processInline(block.content as BlockNoteInlineContent[]) }
        : {}),
      ...('children' in block && Array.isArray(block.children)
        ? { children: processBlocksForMentions(block.children, participantMap, mentionedIds, citationCtx) }
        : {}),
    } as BlockNoteBlock;
  });
}

/**
 * Remove undefined values from BlockNote content for Prisma JSON compatibility
 * Prisma's JSON field doesn't accept undefined values
 */
function sanitizeBlockNoteContent(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeBlockNoteContent(item)).filter(item => item !== undefined);
  }

  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        sanitized[key] = sanitizeBlockNoteContent(value);
      }
    }
    return sanitized;
  }

  return obj;
}


export class CallDocumentService {
  /**
   * Prepare canvas content from markdown summary.
   * Extracts title, builds participant map, converts markdown to BlockNote, and sanitizes content.
   */
  private async prepareCanvasContent(
    markdownSummary: string,
    channelId: string | null,
    callStartedAt?: Date,
    callTitle?: string | null,
    citationCtx?: CitationContext
  ): Promise<{
    title: string;
    content: any;
    mentionedUserIds: string[];
  }> {
    // Build canvas title with call title suffix, or fall back to IST timestamp
    let title: string;
    if (callStartedAt) {
      const suffix = callTitle || formatToISTLocaleString(callStartedAt);
      title = `Detailed Summary - ${suffix}`;
    } else {
      title = `Detailed Summary (Updated)`;
    }

    const firstHeadingMatch = markdownSummary.match(/^#\s+(.+)$/m);
    if (firstHeadingMatch) {
      title = firstHeadingMatch[1].trim();
    } else {
      const primaryFocusMatch = markdownSummary.match(/\*\*Primary Focus:\*\*\s*(.+?)(?:\n|$)/i);
      if (primaryFocusMatch) {
        title = `Call Summary: ${primaryFocusMatch[1].trim()}`;
      }
    }

    // Build participant map from channel members for mention resolution.
    // NOTE_TAKER calls have no channel — mentions simply resolve to none.
    const participantMap = channelId ? await buildParticipantMap(channelId) : new Map();
    const logContext = callStartedAt ? '' : ' (update)';
    logger.info(`[CallDocumentService] Built channel participant map with ${participantMap.size} participants for mentions${logContext}`);

    // Convert markdown to BlockNote with mention + citation support
    const { blocks: content, mentionedUserIds } = await convertMarkdownToBlockNote(markdownSummary, participantMap, citationCtx);

    // Sanitize content to remove undefined values for Prisma
    const sanitizedContent = sanitizeBlockNoteContent(content);

    return { title, content: sanitizedContent, mentionedUserIds };
  }

  /**
   * Queue Vespa indexing for a canvas.
   */
  private async queueVespaIndexing(canvasId: string, userId: string, operation: 'create' | 'update', workspaceId?: string): Promise<void> {
    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed',
        userId,
        app: SubApp.CANVAS,
        ...(workspaceId ? { workspaceId } : {}),
      });
      const action = operation === 'create' ? 'indexing' : 're-indexing';
      logger.info(`[CallDocumentService] Queued Vespa ${action} for canvas ${canvasId}`);
    } catch (error) {
      logger.error(`[CallDocumentService] Failed to queue Vespa job for canvas ${canvasId}:`, error);
    }
  }

  /**
   * Generate a PRD from transcript and summary
   * @param transcript - The call transcript content
   * @param summary - Optional call summary
   * @param customPrompt - Optional custom instructions to guide PRD generation (max 5000 chars)
   * @returns PRD document or null if generation fails
   */
  async generatePRDFromTranscript(
    transcript: string,
    summary: string | null,
    customPrompt?: string,
    callId?: string,
  ): Promise<PRDDocument | null> {
    const logCallId = callId || 'unknown';

    const buildPrompt = () => {
      const sanitizedTranscript = sanitizeInput(transcript);
      const sanitizedSummary = sanitizeInput(summary);
      const sanitizedCustomPrompt = customPrompt ? sanitizeInput(customPrompt) : '';

      let prompt = PRD_GENERATION_PROMPT
        .replace('{transcript}', sanitizedTranscript)
        .replace('{summary}', sanitizedSummary || 'No summary available');

      if (sanitizedCustomPrompt) {
        prompt += `\n\nADDITIONAL USER INSTRUCTIONS:\nThe user has provided specific instructions for this PRD. Please prioritize these instructions:\n"${sanitizedCustomPrompt}"\n`;
      }
      return prompt;
    };

    const result = await executeStreamingLlmRequest({
      userPrompt: buildPrompt(),
      operation: 'prd_generation',
      callId: logCallId,
    });

    if (!result.ok) {
      logger.error(`[${logCallId}] prd_generation_failed`, { reason: result.reason });
      return null;
    }

    // Extract JSON from response
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error(`[${logCallId}] Could not find JSON in PRD response`);
      return null;
    }

    try {
      const prd = JSON.parse(jsonMatch[0]) as PRDDocument;
      logger.info(`[${logCallId}] Successfully generated PRD`);
      return prd;
    } catch (parseError) {
      logger.error(`[${logCallId}] PRD JSON parse failed`, { error: parseError });
      return null;
    }
  }

  /**
   * Select the most suitable workspace summary template for a transcript.
   * A null result means the caller should use the hardcoded default summary.
   */
  async selectSummaryTemplateForTranscript(
    transcript: string,
    workspaceId: string,
    callId: string,
  ): Promise<SummaryTemplateCandidate | null> {
    let templates: SummaryTemplateCandidate[];
    try {
      templates = await repositories.summaryTemplates.listByWorkspace(workspaceId);
    } catch (error) {
      logger.error(`[${callId}] summary_template_lookup_failed`, { error });
      return null;
    }

    if (templates.length === 0) {
      logger.info(`[${callId}] summary_template_selection_skipped`, {
        reason: 'no_templates',
        fallback: 'hardcoded_default',
      });
      return null;
    }

    const result = await executeStreamingLlmRequest({
      userPrompt: buildSummaryTemplateSelectionPrompt(transcript, templates),
      operation: 'summary_template_selection',
      callId,
    });

    if (!result.ok) {
      logger.error(`[${callId}] summary_template_selection_failed`, {
        reason: result.reason,
        fallback: 'hardcoded_default',
      });
      return null;
    }

    const selectedTemplate = parseSelectedSummaryTemplate(result.content, templates);
    if (!selectedTemplate) {
      logger.error(`[${callId}] summary_template_selection_invalid`, {
        fallback: 'hardcoded_default',
      });
      return null;
    }

    logger.info(`[${callId}] summary_template_selected`, {
      template_id: selectedTemplate.id,
      template_name: selectedTemplate.name,
      template_version: selectedTemplate.version,
    });
    return selectedTemplate;
  }

  /**
   * Select one of the built-in recording templates. These templates are
   * intentionally code-backed for the v1 rollout, so every workspace gets the
   * same choices without requiring seed rows in summary_templates.
   */
  async selectRecordingSummaryTemplateForTranscript(
    transcript: string,
    callId: string,
  ): Promise<BuiltinRecordingSummaryTemplate> {
    const candidates: SummaryTemplateCandidate[] = BUILTIN_RECORDING_SUMMARY_TEMPLATES.map(
      template => ({
        id: template.id,
        name: template.name,
        version: 1,
        autoTriggerPrompt: template.selectionCriteria,
        sections: template.fields,
        systemPrompt: '',
      }),
    );

    const result = await executeStreamingLlmRequest({
      userPrompt: buildSummaryTemplateSelectionPrompt(transcript, candidates),
      operation: 'recording_summary_template_selection',
      callId,
    });

    if (result.ok) {
      const selected = parseSelectedSummaryTemplate(result.content, candidates);
      const template = selected ? getBuiltinRecordingSummaryTemplate(selected.id) : undefined;
      if (template) {
        logger.info(`[${callId}] recording_summary_template_selected`, {
          template_id: template.id,
          template_name: template.name,
        });
        return template;
      }
    }

    logger.warn(`[${callId}] recording_summary_template_selection_fallback`, {
      template_id: 'default',
      reason: result.ok ? 'invalid_selection' : result.reason,
    });
    return getBuiltinRecordingSummaryTemplate('default')!;
  }

  /** Generate a headless-recording summary using the supplied v1 seed prompt. */
  async generateRecordingSummary(
    transcript: string,
    callId: string,
    templateId?: BuiltinRecordingSummaryTemplateId,
  ): Promise<{ summary: string; template: BuiltinRecordingSummaryTemplate } | null> {
    const template = templateId
      ? getBuiltinRecordingSummaryTemplate(templateId)
      : await this.selectRecordingSummaryTemplateForTranscript(transcript, callId);

    if (!template) {
      logger.error(`[${callId}] recording_summary_generation_failed`, {
        reason: 'invalid_template',
        template_id: templateId,
      });
      return null;
    }

    const summary = await this.generateDetailedSummary(
      transcript,
      callId,
      undefined,
      template.fields,
      undefined,
      RECORDING_DETAILED_SUMMARY_PROMPT,
      DEFAULT_RECORDING_SUMMARY_FIELDS,
    );

    return summary ? { summary, template } : null;
  }

  /**
   * Generate detailed summary from transcript with explicit retry loop.
   */
  async generateDetailedSummary(
    transcript: string,
    callId: string,
    customPrompt?: string,
    summaryFields?: string,
    systemPrompt?: string,
    promptTemplate = DETAILED_SUMMARY_PROMPT,
    defaultSummaryFields = DEFAULT_SUMMARY_FIELDS,
  ): Promise<string | null> {
    // Resolve channelId and build participant map once (expensive DB lookups)
    const call = await repositories.calls.findByExternalId(callId);
    const channelId = call?.channelId;

    const participantMap: Map<string, ParticipantInfo> = channelId
      ? await buildParticipantMap(channelId)
      : new Map<string, ParticipantInfo>();

    if (!channelId && call) {
      const callParticipants = await repositories.calls.getCallParticipantsWithUserDetails(callId);
      for (const participant of callParticipants) {
        participantMap.set(participant.userName.toLowerCase(), {
          userId: participant.userId,
          username: participant.userName,
          userEmail: participant.userEmail,
          userPicture: participant.userPicture || undefined,
        });
      }
    }

    const participantList = Array.from(participantMap.values())
      .map(p => `- ${p.username}`)
      .join('\n');

    const sanitizedTranscript = sanitizeInput(transcript);
    const sanitizedCustomPrompt = customPrompt ? sanitizeInput(customPrompt) : '';
    const sanitizedFields = summaryFields?.trim() ? sanitizeInput(summaryFields) : '';
    const sanitizedSystemPrompt = systemPrompt ? sanitizeInput(systemPrompt) : '';

    const buildPrompt = () => {
      let prompt = renderPromptTemplate(promptTemplate, {
        fields: sanitizedFields || defaultSummaryFields,
        participants: participantList || '- No participants found',
        transcript: sanitizedTranscript,
      });

      if (sanitizedCustomPrompt) {
        prompt += `\n\nADDITIONAL USER INSTRUCTIONS:\nThe user has provided specific instructions for this summary. Please prioritize these instructions:\n"${sanitizedCustomPrompt}"\n`;
      }
      return prompt;
    };

    const result = await executeStreamingLlmRequest({
      userPrompt: buildPrompt(),
      operation: 'detailed_summary_generation',
      callId,
      ...(sanitizedSystemPrompt ? { systemPrompt: sanitizedSystemPrompt } : {}),
    });

    if (!result.ok) {
      logger.error(`[${callId}] detailed_summary_generation_failed`, { reason: result.reason });
      return null;
    }

    logger.info(`[${callId}] Successfully generated detailed summary`);
    return result.content;
  }

  async editSummaryStructureWithAI(
    currentFields: string,
    instruction: string,
    callId?: string,
  ): Promise<string | null> {
    const sanitizedCurrent = sanitizeInput(currentFields);
    const sanitizedInstruction = sanitizeInput(instruction);

    const buildPrompt = (): string =>
      renderPromptTemplate(EDIT_SUMMARY_PROMPT, {
        current: sanitizedCurrent || DEFAULT_SUMMARY_FIELDS,
        instruction: sanitizedInstruction,
      });

    const result = await executeStreamingLlmRequest({
      userPrompt: buildPrompt(),
      operation: 'summary_prompt_edit',
      callId: callId || 'prompt-edit',
    });

    if (!result.ok) {
      logger.error('[CallDocumentService] summary_prompt_edit_failed', { reason: result.reason });
      return null;
    }

    return result.content.trim();
  }

  /**
   * Create PRD Canvas in database
   */
  async createPRDCanvas(
    callId: string,
    prd: PRDDocument,
    createdByUserId: string,
    conversationId: string,
    channelId: string,
    callCreatorUserId: string
  ): Promise<string | null> {
    try {
      const prisma = DatabaseClient.getInstance();
      const now = new Date();

      const canvasId = uuidv4();
      const participantId = uuidv4();
      const workspaceId = await repositories.channels.getWorkspaceId(channelId);

      const title = `📋 PRD: ${prd.title}`;
      const content = formatPRDToBlockNote(prd, callId);

      // Create canvas with empty content (Y-Sweet is source of truth)
      await prisma.canvas.create({
        data: {
          id: canvasId,
          title,
          content: [],
          channelId,
          workspaceId,
          createdBy: createdByUserId,
          visibility: 'PUBLIC',
          isTemplate: false,
          isCollaborative: true,
          lastEditedBy: createdByUserId,
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now,
          metadata: {
            source: 'call_prd',
            callId,
            conversationId,
            generatedAt: now.toISOString(),
          },
        },
      });

      // Add creator (Xyne Automatic bot) as OWNER
      await prisma.canvasParticipant.create({
        data: {
          id: participantId,
          canvasId,
          workspaceId,
          userId: createdByUserId,
          role: 'OWNER',
          joinedAt: now,
          updatedAt: now,
        },
      });

      // Add call initiator as OWNER
      await prisma.canvasParticipant.create({
        data: {
          id: uuidv4(),
          canvasId,
          workspaceId,
          userId: callCreatorUserId,
          role: 'OWNER',
          joinedAt: now,
          updatedAt: now,
        },
      });

      // Initialize Y-Sweet for collaborative editing
      const ysweetInitialized = await initializeYSweetDoc(canvasId, content);
      if (!ysweetInitialized) {
        logger.warn(`[CallDocumentService] Y-Sweet init failed for PRD canvas ${canvasId}`);
      }

      logger.info(`[CallDocumentService] Created collaborative PRD canvas ${canvasId} for call ${callId} with Xyne Automatic and call initiator as owners`);

      // Fetch workspaceId from channel for Vespa job routing
      const channel = await db.channel.findUnique({ where: { id: channelId }, select: { workspaceId: true } });

      // Queue Vespa indexing for the canvas
      await this.queueVespaIndexing(canvasId, createdByUserId, 'create', channel?.workspaceId);

      return canvasId;
    } catch (error) {
      logger.error('[CallDocumentService] Failed to create PRD canvas:', error);
      return null;
    }
  }

  /**
   * Create detailed summary Canvas in database
   */
  async createDetailedSummaryCanvas(
    callId: string,
    markdownSummary: string,
    createdByUserId: string,
    conversationId: string | null,
    channelId: string | null,
    callStartedAt: Date,
    callCreatorUserId: string,
    callTitle?: string | null,
    citationCtx?: CitationContext,
    workspaceIdOverride?: string
  ): Promise<string | null> {
    try {
      const prisma = DatabaseClient.getInstance();
      const now = new Date();

      const canvasId = uuidv4();
      const participantId = uuidv4();
      const workspaceId = workspaceIdOverride ?? (channelId ? await repositories.channels.getWorkspaceId(channelId) : undefined);
      if (!workspaceId) {
        throw new Error(`Cannot resolve workspaceId for detailed summary canvas (call ${callId})`);
      }

      // Prepare canvas content (title, content, mentions, citations)
      const { title, content: sanitizedContent, mentionedUserIds } = await this.prepareCanvasContent(
        markdownSummary,
        channelId,
        callStartedAt,
        callTitle,
        citationCtx
      );

      // Create canvas with empty content (Y-Sweet is source of truth).
      // PRIVATE — note-taker recordings are shared per-user/group/channel via
      // entity_access, and the recording sharing API updates canvas_participants
      // in the same transaction.
      await prisma.canvas.create({
        data: {
          id: canvasId,
          title,
          content: [],
          channelId,
          workspaceId,
          createdBy: createdByUserId,
          visibility: 'PRIVATE',
          isTemplate: false,
          isCollaborative: true,
          lastEditedBy: createdByUserId,
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now,
          metadata: {
            source: 'call_detailed_summary',
            callId,
            conversationId,
            isAiGenerated: true,
            generatedAt: now.toISOString(),
            mentionedUserIds, // Store mentioned users for side effect handler
            version: 1, // Initial version for new canvases
          },
        },
      });

      // Add Xyne Automatic bot as OWNER
      await prisma.canvasParticipant.create({
        data: {
          id: participantId,
          canvasId,
          workspaceId,
          userId: createdByUserId,
          role: CanvasRole.OWNER,
          joinedAt: now,
          updatedAt: now,
        },
      });

      // Add call creator as OWNER
      await prisma.canvasParticipant.create({
        data: {
          id: uuidv4(),
          canvasId,
          workspaceId,
          userId: callCreatorUserId,
          role: CanvasRole.OWNER,
          joinedAt: now,
          updatedAt: now,
        },
      });

      // Initialize Y-Sweet for collaborative editing
      const ysweetInitialized = await initializeYSweetDoc(canvasId, sanitizedContent as unknown as BlockNoteBlock[]);
      if (!ysweetInitialized) {
        logger.warn(`[CallDocumentService] Y-Sweet init failed for detailed summary canvas ${canvasId}`);
      }

      logger.info(`[CallDocumentService] Created collaborative detailed summary canvas ${canvasId} for call ${callId} with Xyne Automatic and call creator as owners`);

      // Fetch complete context for the user to pass to side-effect handler
      const user = await db.user.findUnique({
        where: { id: createdByUserId },
        select: { id: true, email: true, workspaceId: true, role: true },
      });
      if (!user || !user.workspaceId) {
        throw new Error(`User ${createdByUserId} not found or has no workspace assigned`);
      }
      // Email is globally unique in orgMember, single lookup is sufficient
      const orgMember = await db.orgMember.findUnique({
        where: { email: user.email },
      });
      if (!orgMember) {
        throw new Error(`User ${createdByUserId} is not a member of any organization`);
      }

      // Manually call canvas handler for activities and notifications
      // (Canvas is created via Prisma, not Zero mutator, so handler won't auto-trigger)
      const canvasHandler = new CanvasSideEffectHandler({
        userID: user.id,
        workspaceId: user.workspaceId,
        role: user.role,
        memberId: orgMember.memberId,
        orgRole: orgMember.role,
      });
      canvasHandler.onInsert({
        entityId: canvasId,
        entityType: 'canvases',
        operation: 'insert'
      }).catch(err => logger.error('[CallDocumentService] Canvas side-effect handler error:', err));

      // Queue Vespa indexing for the canvas
      await this.queueVespaIndexing(canvasId, createdByUserId, 'create', user.workspaceId);

      return canvasId;
    } catch (error) {
      logger.error('[CallDocumentService] Failed to create detailed summary canvas:', error);
      return null;
    }
  }

  /**
   * Update an existing detailed summary Canvas with new content.
   * Same canonical canvas id is used, so existing links remain valid.
   */
  async updateDetailedSummaryCanvas(
    canvasId: string,
    markdownSummary: string,
    updatedByUserId: string,
    channelId: string | null,
    currentVersion: number,
    callId: string,
    callTitle?: string | null,
    citationCtx?: CitationContext
  ): Promise<string | null> {
    try {
      const prisma = DatabaseClient.getInstance();
      const now = new Date();

      // Prepare canvas content (title, content, mentions, citations)
      const { title, content: sanitizedContent, mentionedUserIds } = await this.prepareCanvasContent(
        markdownSummary,
        channelId,
        undefined,
        callTitle,
        citationCtx
      );

      const newVersion = currentVersion + 1;

      // Update existing canvas; content is kept empty in DB (Y-Sweet is source of truth)
      await prisma.canvas.update({
        where: { id: canvasId },
        data: {
          title,
          content: [],
          lastEditedBy: updatedByUserId,
          lastEditedAt: now,
          updatedAt: now,
          metadata: {
            source: 'call_detailed_summary',
            callId,
            isAiGenerated: true,
            generatedAt: now.toISOString(),
            mentionedUserIds,
            version: newVersion,
            lastUpdatedAt: now.toISOString(),
          },
        },
      });

      logger.info(`[CallDocumentService] Updated detailed summary canvas ${canvasId} for call ${callId}, version ${currentVersion} -> ${newVersion}`);

      // Sync to Y-Sweet for collaborative editing
      const ysweetSynced = await syncToYSweet(canvasId, sanitizedContent as unknown as BlockNoteBlock[]);
      if (!ysweetSynced) {
        logger.warn(`[CallDocumentService] Y-Sweet sync failed for canvas ${canvasId}`);
      }

      // Queue Vespa re-indexing for the updated canvas
      await this.queueVespaIndexing(canvasId, updatedByUserId, 'update');

      return canvasId;
    } catch (error) {
      logger.error('[CallDocumentService] Failed to update detailed summary canvas:', error);
      return null;
    }
  }

  /**
   * Create or update detailed summary Canvas.
   * If an existing canvas is found for the call, updates it instead of creating a duplicate.
   */
  async createOrUpdateDetailedSummaryCanvas(
    callId: string,
    markdownSummary: string,
    createdByUserId: string,
    conversationId: string | null,
    channelId: string | null,
    callStartedAt: Date,
    callCreatorUserId: string,
    callTitle?: string | null,
    citationCtx?: CitationContext,
    workspaceIdOverride?: string
  ): Promise<{ canvasId: string | null; version: number }> {
    // Check if an existing canvas exists for this call
    const existingCanvas = await findExistingDetailedSummaryCanvas(callId);

    if (existingCanvas) {
      // Update existing canvas instead of creating a new one
      const updatedCanvasId = await this.updateDetailedSummaryCanvas(
        existingCanvas.canvasId,
        markdownSummary,
        createdByUserId,
        channelId,
        existingCanvas.version,
        callId,
        callTitle,
        citationCtx
      );

      return {
        canvasId: updatedCanvasId,
        version: existingCanvas.version + 1,
      };
    }

    // No existing canvas, create a new one
    const canvasId = await this.createDetailedSummaryCanvas(
      callId,
      markdownSummary,
      createdByUserId,
      conversationId,
      channelId,
      callStartedAt,
      callCreatorUserId,
      callTitle,
      citationCtx,
      workspaceIdOverride
    );

    return {
      canvasId,
      version: 1,
    };
  }

  /**
   * Post PRD canvas link to conversation via Xyne Automatic bot
   */
  async postPRDToConversation(
    conversationId: string,
    callId: string,
    canvasUrl: string,
    prdTitle: string,
    workspaceId: string
  ): Promise<void> {
    try {
      // Get Xyne Automatic bot
      const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic', workspaceId);
      if (!xyneAutomaticBot) {
        throw new Error('Xyne Automatic bot not found');
      }

      // Create Markdown message content
      const messageContent = `## 📋 ${prdTitle}

A Product Requirements Document has been generated from this call discussion.

[📄 View PRD Canvas](${canvasUrl})`;

      // Create message
      await repositories.messages.create({
        conversationId,
        senderId: xyneAutomaticBot.id,
        content: messageContent,
        msgType: MessageType.BOT,
        showInChannel: false,
        metadata: {
          messageSubtype: 'call_prd',
          callId,
          canvasUrl,
          isAiGenerated: true,
          contentFormat: 'markdown',
        },
      });

      await repositories.conversations.incrementReplyCount(conversationId);

      // Update the original call message with PRD canvas URL
      await this.updateCallMessageMetadata(conversationId, callId, 'prdCanvasUrl', canvasUrl);

      logger.info(`[CallDocumentService] Posted PRD link to conversation ${conversationId}`);
    } catch (error) {
      logger.error('[CallDocumentService] Failed to post PRD to conversation:', error);
      throw error;
    }
  }

  /**
   * Post a notes-canvas link (notes taken live during a recording) to the conversation thread.
   * Mirrors postPRDToConversation: posts as the Xyne Automatic bot and stamps the call message.
   */
  async postNotesCanvasToConversation(
    conversationId: string,
    callId: string,
    canvasUrl: string,
    workspaceId: string
  ): Promise<void> {
    try {
      // Idempotent: the automatic summary pipeline may run more than once per call
      const existing = await repositories.messages.findNotesCanvasByCallId(conversationId, callId);
      if (existing) {
        logger.info(`[CallDocumentService] Notes canvas already posted for call ${callId}, skipping`);
        return;
      }

      const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic', workspaceId);
      if (!xyneAutomaticBot) {
        throw new Error('Xyne Automatic bot not found');
      }

      const messageContent = `## 📝 Recording Notes

Notes taken during this recording:

[📄 View Notes Canvas](${canvasUrl})`;

      await repositories.messages.create({
        conversationId,
        senderId: xyneAutomaticBot.id,
        content: messageContent,
        msgType: MessageType.BOT,
        showInChannel: false,
        metadata: {
          messageSubtype: 'recording_notes',
          callId,
          canvasUrl,
          contentFormat: 'markdown',
        },
      });

      await repositories.conversations.incrementReplyCount(conversationId);

      // Update the original call message with the notes canvas URL
      await this.updateCallMessageMetadata(conversationId, callId, 'notesCanvasUrl', canvasUrl);

      logger.info(`[CallDocumentService] Posted notes canvas link to conversation ${conversationId}`);
    } catch (error) {
      logger.error('[CallDocumentService] Failed to post notes canvas to conversation:', error);
      throw error;
    }
  }

  /**
   * Post detailed summary canvas link to conversation (or update existing message)
   */
  async postDetailedSummaryToConversation(
    conversationId: string,
    callId: string,
    canvasUrl: string,
    summaryTitle: string,
    workspaceId: string,
    version: number = 1
  ): Promise<void> {
    try {
      const prisma = DatabaseClient.getInstance();
      const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic', workspaceId);
      if (!xyneAutomaticBot) {
        throw new Error('Xyne Automatic bot not found');
      }

      // Build message content with version indicator if updated
      const isUpdate = version > 1;
      const versionIndicator = isUpdate ? ` (v${version})` : '';
      const updatedIndicator = isUpdate ? '\n\n_This summary has been updated with the latest call content._' : '';

      const messageContent = `## 📊 ${summaryTitle}${versionIndicator}

A comprehensive detailed summary has been generated from this call.

[📄 View Detailed Summary](${canvasUrl})${updatedIndicator}`;

      // Check if a detailed summary message already exists for this call
      const existingMessage = await repositories.messages.findExistingDetailedSummaryMessage(conversationId, callId);

      if (existingMessage) {
        // Update existing message instead of creating a new one
        await prisma.message.update({
          where: { messageId: existingMessage.messageId },
          data: {
            content: messageContent,
            metadata: {
              messageSubtype: 'call_detailed_summary',
              callId,
              canvasUrl,
              isAiGenerated: true,
              contentFormat: 'markdown',
              version: version,
              lastUpdatedAt: new Date().toISOString(),
            },
          },
        });
      } else {
        // Create new message
        await repositories.messages.create({
          conversationId,
          senderId: xyneAutomaticBot.id,
          content: messageContent,
          msgType: MessageType.BOT,
          showInChannel: false,
          metadata: {
            messageSubtype: 'call_detailed_summary',
            callId,
            canvasUrl,
            isAiGenerated: true,
            contentFormat: 'markdown',
            version: version,
            createdAt: new Date().toISOString(),
          },
        });

        await repositories.conversations.incrementReplyCount(conversationId);
        logger.info(`[CallDocumentService] Posted new detailed summary link to conversation ${conversationId}`);
      }

      // Update call message with canvas URL
      await this.updateCallMessageMetadata(conversationId, callId, 'detailedSummaryCanvasUrl', canvasUrl);

      logger.info(`[CallDocumentService] Detailed summary processing completed for conversation ${conversationId}`);
    } catch (error) {
      logger.error('[CallDocumentService] Failed to post detailed summary to conversation:', error);
      throw error;
    }
  }

  /**
   * Update call message metadata with canvas URL (generic method)
   */
  private async updateCallMessageMetadata(
    conversationId: string,
    callId: string,
    metadataKey: string,
    canvasUrl: string
  ): Promise<void> {
    try {
      const prisma = DatabaseClient.getInstance();

      // Find the original call message (not bot messages that also have callId)
      const callMessage = await prisma.message.findFirst({
        where: {
          conversationId,
          AND: [
            {
              metadata: {
                path: ['isCallMessage'],
                equals: true,
              },
            },
            {
              metadata: {
                path: ['callId'],
                equals: callId,
              },
            },
          ],
        },
      });

      if (callMessage) {
        // Update metadata with canvas URL
        const currentMetadata = (callMessage.metadata as Record<string, any>) || {};
        await prisma.message.update({
          where: { messageId: callMessage.messageId },
          data: {
            metadata: {
              ...currentMetadata,
              [metadataKey]: canvasUrl,
            },
          },
        });
        logger.info(`[CallDocumentService] Updated call message ${callMessage.messageId} with ${metadataKey}`);
      } else {
        logger.warn(`[CallDocumentService] Call message not found for callId ${callId}`);
      }
    } catch (error) {
      // Don't throw - this is a non-critical update
      logger.error(`[CallDocumentService] Failed to update call message with ${metadataKey}:`, error);
    }
  }

  /**
   * Generate and post PRD to conversation
   */
  async generateAndPostPRD(
    callId: string,
    transcript: string,
    summary: string | null,
    createdByUserId: string,
    conversationId: string,
    customPrompt?: string
  ): Promise<{ success: boolean; canvasUrl?: string; error?: string }> {
    try {
      const conversation = await repositories.conversations.findById(conversationId);
      if (!conversation) {
        return { success: false, error: 'Conversation not found' };
      }

      const channel = await db.channel.findUnique({
        where: { id: conversation.channelId },
        select: { workspaceId: true }
      });
      if (!channel?.workspaceId) {
        return { success: false, error: 'Channel workspace not found' };
      }
      // 1. Generate PRD from transcript
      const prd = await this.generatePRDFromTranscript(transcript, summary, customPrompt, callId);
      if (!prd) {
        return { success: false, error: 'Failed to generate PRD from transcript' };
      }

      // Get Xyne Automatic bot to create canvas
      const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic', channel.workspaceId);
      if (!xyneAutomaticBot) {
        return { success: false, error: 'Xyne Automatic bot not found' };
      }


      // 2. Create Canvas with bot as creator and call initiator as co-owner
      const canvasId = await this.createPRDCanvas(
        callId,
        prd,
        xyneAutomaticBot.id,
        conversationId,
        conversation.channelId,
        createdByUserId
      );
      if (!canvasId) {
        return { success: false, error: 'Failed to create PRD canvas' };
      }

      const canvasUrl = getCanvasUrl(canvasId);

      // 3. Post to conversation
      await this.postPRDToConversation(
        conversationId,
        callId,
        canvasUrl,
        prd.title,
        channel.workspaceId
      );

      return { success: true, canvasUrl };
    } catch (error) {
      logger.error('[CallDocumentService] Error in generateAndPostPRD:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate and post detailed summary to conversation
   */
  async generateAndPostDetailedSummary(
    callId: string,
    transcript: string,
    conversationId: string,
    customPrompt?: string
  ): Promise<{ success: boolean; canvasUrl?: string; error?: string }> {
    try {
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        return { success: false, error: 'Call not found' };
      }

      const conversation = await repositories.conversations.findById(conversationId);
      if (!conversation) {
        return { success: false, error: 'Conversation not found' };
      }

      const channel = await db.channel.findUnique({
        where: { id: call.channelId || conversation.channelId },
        select: { workspaceId: true, callSummaryPrompt: true }
      });
      if (!channel?.workspaceId) {
        return { success: false, error: 'Channel workspace not found' };
      }

      // Number the transcript segments so the LLM can cite them, and build the
      // token→segment map used to turn `[clf-n]` tokens into canvas citation chips.
      // Both derive from the SAME transcript string, so segment ids always agree.
      const { numbered: numberedTranscript, segments } = numberTranscriptSegments(transcript);
      // Best-effort: attach each speaker's participant userId (matched by name) so
      // the citation chip + hover can show the real user avatar. Unmatched speakers
      // fall back to initials on the frontend.
      const speakerParticipantMap = await buildParticipantMap(call.channelId || conversation.channelId);
      for (const s of segments) {
        const info = speakerParticipantMap.get(s.speaker.toLowerCase());
        if (info) s.speakerId = info.userId;
      }
      const citationCtx: CitationContext = {
        callId,
        segments: new Map(segments.map(s => [s.n, s])),
      };

      const detailedSummaryMarkdown = await this.generateDetailedSummary(numberedTranscript, callId, customPrompt, channel.callSummaryPrompt ?? undefined);
      if (!detailedSummaryMarkdown) {
        return { success: false, error: 'Failed to generate detailed summary' };
      }

      // Get Xyne Automatic bot
      const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic', channel.workspaceId);
      if (!xyneAutomaticBot) {
        throw new Error('Xyne Automatic bot not found');
      }

      // 2. Create or Update Canvas (handles rejoin scenario)
      const { canvasId, version } = await this.createOrUpdateDetailedSummaryCanvas(
        callId,
        detailedSummaryMarkdown,
        xyneAutomaticBot.id,
        conversationId,
        conversation.channelId,
        call.startedAt,
        call.createdByUserId,
        call.title,
        citationCtx
      );
      if (!canvasId) {
        return { success: false, error: 'Failed to create or update detailed summary canvas' };
      }

      const canvasUrl = getCanvasUrl(canvasId);
      // Use call title as suffix, or fall back to IST timestamp
      const suffix = call.title || formatToISTLocaleString(new Date(call.startedAt));
      const canvasTitle = `Detailed Summary - ${suffix}`;

      // 3. Post to conversation (or update existing message)
      await this.postDetailedSummaryToConversation(
        conversationId,
        callId,
        canvasUrl,
        canvasTitle,
        channel.workspaceId,
        version
      );

      return { success: true, canvasUrl };
    } catch (error) {
      logger.error('[CallDocumentService] Error in generateAndPostDetailedSummary:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const callDocumentService = new CallDocumentService();
