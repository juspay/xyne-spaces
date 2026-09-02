/**
 * Call Document Service - Generates documents from call transcripts
 * Handles both PRD (Product Requirements Documents) and Detailed Summaries
 * Creates Canvas documents and posts them to conversations via Xyne Automatic bot
 */

import { v4 as uuidv4 } from 'uuid';
import { DatabaseClient } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { repositories } from '@/database/repositories';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { CallOrigin, DEFAULT_SUMMARY_FIELDS, MessageType, CanvasRole, CanvasVisibility } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { formatToISTLocaleString } from '@/utils/dateUtils';
import type { Prisma, SummaryTemplate } from '@prisma/client';
import { withServerEditor } from '@/utils/serverBlockNoteEditor';
import { getCanvasUrl, findExistingDetailedSummaryCanvas } from '@/services/canvasService';
import { logDetailedSummaryFailed } from '@/services/detailedSummaryFailureLog';
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
  formatSummaryTemplateSections,
  parseSelectedSummaryTemplate,
  type SummaryTemplateCandidate,
} from './summaryTemplateSelection';
import {
  DEFAULT_RECORDING_SUMMARY_TEMPLATE,
  DEFAULT_RECORDING_SUMMARY_FIELDS,
  RECORDING_DETAILED_SUMMARY_PROMPT,
} from './recordingSummaryTemplates';
import {
  extractMarkedItemsFromRecordingSummary,
  mergeRecordingSummaryMarkedItems,
  stripRecordingSummaryMarkedItemAnnotations,
  type RecordingSummaryMarkedItem,
} from './recordingSummaryMarkedItems';
import { summaryTemplateService } from './summaryTemplateService';

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

interface CanvasSideEffectContext {
  canvasHandler: CanvasSideEffectHandler;
  workspaceId: string;
}

import { executeStreamingLlmRequest, type SummaryModelType } from './callLlmRetry';
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

/**
 * Some legacy custom-template prompts cause the model to copy the template
 * prompt-generation response shape and return { "systemPrompt": "..." }.
 * Accept that response defensively, but keep ordinary Markdown untouched.
 */
function normalizeDetailedSummaryMarkdown(content: string): string {
  const trimmed = content.trim();
  const fencedJson = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate = fencedJson ?? trimmed;

  try {
    const parsed: unknown = JSON.parse(candidate);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).systemPrompt === 'string'
    ) {
      return ((parsed as Record<string, unknown>).systemPrompt as string).trim();
    }
  } catch {
    // Normal Markdown is not JSON and should pass through unchanged.
  }

  return content;
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
const INITIAL_DETAILED_SUMMARY_CANVAS_VERSION = 1;

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

/** Return the distinct people who actually contributed speech to a formatted transcript. */
function extractTranscriptSpeakers(transcript: string): string[] {
  const speakers = new Map<string, string>();
  const speakerLine = /^\s*(?:\[\d+\]\s*)?\[[^\]]+\]\s*([^:\n]+):/gm;

  for (const match of transcript.matchAll(speakerLine)) {
    const speaker = match[1].trim();
    if (speaker && speaker.toLowerCase() !== 'unknown') {
      speakers.set(speaker.toLowerCase(), speaker);
    }
  }

  return Array.from(speakers.values());
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

**CALL CREATOR:**
- In the CALL PARTICIPANTS list above, the person who created/initiated the call is annotated with "{HOST}".
- In the Call Overview Participants line, keep that "{HOST}" marker immediately after their name.
- Do not add a "{HOST}" marker to anyone who is not annotated as such in the list above.

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

**MARKED DECISIONS AND ACTIONS:**
- Prefix every concrete decision bullet with the exact private annotation \`[xyne-decision]\` immediately after the bullet marker.
- Prefix every concrete action-item bullet with the exact private annotation \`[xyne-action]\` immediately after the bullet marker.
- Every annotated bullet MUST end with at least one supporting transcript citation. The first citation must identify the moment most closely associated with that decision or action.
- Never use these annotations for takeaways, discussion points, open questions, blockers, or other bullets.
- The annotations are internal metadata and will be removed before the summary is displayed.
- Examples:
  - \`- [xyne-decision] The team approved the consolidated pipeline [clf-12]\`
  - \`- [xyne-action] @Mayank Bansal will update the backend [clf-18]\`

**CITATIONS (ACCURACY IS CRITICAL):**
- Each transcript line is prefixed with a segment number in square brackets, e.g. "[12] [03:24] Alice: ...". The number 12 is that line's segment id.
- After any specific claim, decision, action item, number, date, name, or quote you draw from the transcript, cite the segment(s) it came from INLINE using the exact token [clf-N]. Example: "The team agreed to ship the API redesign in Q4 [clf-12]."
- A citation is a PROOF POINTER, not decoration. [clf-N] asserts: "the words that make this statement true are inside segment N." The reader clicks it and is taken to that exact moment in the transcript.
- BEFORE writing [clf-N], find line N in the TRANSCRIPT below and confirm its text actually states what you just wrote. If you cannot point to the specific words in that line, do NOT cite it.
- Topic proximity is NOT support. A segment that merely discusses the same subject, or sits near the moment you have in mind, does not support the claim. Never cite "roughly where it was discussed".
- Never estimate, guess, round, shift, or reconstruct a segment number from memory of where something appeared. Read the number off the line itself. If you are not certain of the number, leave the statement uncited.
- Attribution must match: if the statement says who said, wanted, offered, agreed to, or committed to something, the cited segment must be that person's line, or a line that explicitly states their position.
- Each token in a group must independently support the statement. Never pad with extra numbers to look thorough — one exact citation beats three approximate ones. At most 3 tokens together, e.g. "...scope was cut [clf-8][clf-9]", most direct evidence first.
- For a roll-up statement that synthesises several moments (typical of Key Takeaways): cite only the 1-3 segments where that point is most explicitly stated. If no segment states it, RE-WORD the statement so it matches what a segment actually says — never attach an approximate citation just to satisfy the format.
- An uncited statement is acceptable. A wrongly cited statement is a serious error, because it looks verified and is not.
- Copy the number EXACTLY. Do NOT invent segment numbers. Do NOT use ranges like [clf-8-11]. Only cite segment numbers that actually appear in the transcript below; if a line has no bracketed number, do not cite it.
- Write ONLY the bare token [clf-N] — never a link, URL, footnote, or a separate "Citations"/"Sources" section.
- FINAL CHECK before you output: re-read every [clf-N] you wrote, look the segment up again, and delete or re-word any citation whose segment does not contain the claim it is attached to.

Only output valid Markdown.
No extra text.

TRANSCRIPT:
{transcript}

FINAL REMINDER — CITATIONS: every [clf-N] you write must point at a numbered segment above whose text actually states the claim it is attached to. Verify each one against the lines above before you output. Drop or re-word any you cannot verify — an uncited statement is fine, a wrongly cited one is not.
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
  - Inline transcript citations: the generating LLM already appends [clf-N] tokens pointing at the transcript segments that support each claim, and is already told to verify them. Do NOT add, restate, or relax citation instructions, and do NOT add a "Citations"/"Sources" section to the template.
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
    const parsed = await withServerEditor((editor) => editor.tryParseMarkdownToBlocks(markdown));

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
    // A generated/existing call title is authoritative. In particular, the
    // first partial Markdown heading must not replace a title that completed
    // before the first streamed content delta arrived.
    let title: string;
    const normalizedCallTitle = callTitle?.trim();
    if (normalizedCallTitle) {
      title = `Detailed Summary - ${normalizedCallTitle}`;
    } else if (callStartedAt) {
      title = `Detailed Summary - ${formatToISTLocaleString(callStartedAt)}`;
    } else {
      title = `Detailed Summary (Updated)`;
    }

    // Content-derived titles remain a fallback for flows that do not have a
    // call title. They are intentionally lower priority than normalizedCallTitle.
    if (!normalizedCallTitle) {
      const firstHeadingMatch = markdownSummary.match(/^#\s+(.+)$/m);
      if (firstHeadingMatch) {
        title = firstHeadingMatch[1].trim();
      } else {
        const primaryFocusMatch = markdownSummary.match(/\*\*Primary Focus:\*\*\s*(.+?)(?:\n|$)/i);
        if (primaryFocusMatch) {
          title = `Call Summary: ${primaryFocusMatch[1].trim()}`;
        }
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

  private async createCanvasSideEffectHandler(
    createdByUserId: string,
  ): Promise<CanvasSideEffectContext> {
    const user = await db.user.findUnique({
      where: { id: createdByUserId },
      select: {
        id: true,
        workspaceId: true,
        role: true,
        orgMember: {
          select: { memberId: true, role: true },
        },
      },
    });
    if (!user?.workspaceId) {
      throw new Error(`User ${createdByUserId} not found or has no workspace assigned`);
    }
    if (!user.orgMember) {
      throw new Error(`User ${createdByUserId} is not a member of any organization`);
    }

    return {
      canvasHandler: new CanvasSideEffectHandler({
        userID: user.id,
        workspaceId: user.workspaceId,
        role: user.role,
        memberId: user.orgMember.memberId,
        orgRole: user.orgMember.role,
      }),
      workspaceId: user.workspaceId,
    };
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

  /** Select the best persisted template, falling back to the code-backed default. */
  async selectRecordingSummaryTemplateForTranscript(
    transcript: string,
    workspaceId: string,
    userId: string,
    callId: string,
  ): Promise<SummaryTemplate | null> {
    const templates = await summaryTemplateService.list(workspaceId, userId);
    const defaultTemplate = await summaryTemplateService.findAccessibleById(
      DEFAULT_RECORDING_SUMMARY_TEMPLATE.id,
      workspaceId,
      userId,
    );
    if (templates.length === 0) return defaultTemplate;

    const result = await executeStreamingLlmRequest({
      userPrompt: buildSummaryTemplateSelectionPrompt(transcript, templates),
      operation: 'recording_summary_template_selection',
      callId,
    });

    if (result.ok) {
      const selected = parseSelectedSummaryTemplate(result.content, templates);
      const template = selected
        ? templates.find(candidate => candidate.id === selected.id)
        : undefined;
      if (template) {
        logger.info(`[${callId}] recording_summary_template_selected`, {
          template_id: template.id,
          template_name: template.name,
        });
        return template;
      }
    }

    logger.warn(`[${callId}] recording_summary_template_selection_fallback`, {
      template_id: defaultTemplate?.id,
      reason: result.ok ? 'invalid_selection' : result.reason,
    });
    return defaultTemplate;
  }

  /** Generate a headless-recording summary using a saved or code-backed template. */
  async generateRecordingSummary(
    transcript: string,
    callId: string,
    templateId?: string,
    onDelta?: (accumulatedContent: string) => void | Promise<void>,
    citationSegments?: CitationContext['segments'],
    modelType?: SummaryModelType,
  ): Promise<{
    summary: string;
    template: SummaryTemplate;
    markedItems: RecordingSummaryMarkedItem[];
  } | null> {
    const call = await repositories.calls.findByExternalId(callId);
    if (!call?.workspaceId) return null;

    const selectedTemplate = templateId
      ? await summaryTemplateService.findAccessibleById(
          templateId,
          call.workspaceId,
          call.createdByUserId,
        )
      : await this.selectRecordingSummaryTemplateForTranscript(
          transcript,
          call.workspaceId,
          call.createdByUserId,
          callId,
        );

    if (!selectedTemplate) {
      logger.error(`[${callId}] recording_summary_generation_failed`, {
        reason: 'invalid_template',
        template_id: templateId,
      });
      return null;
    }

    const template = await summaryTemplateService.ensureGeneratedSystemPrompt(selectedTemplate);
    if (!template) {
      logger.error(`[${callId}] recording_summary_generation_failed`, {
        reason: 'system_prompt_generation_failed',
        template_id: selectedTemplate.id,
      });
      return null;
    }

    const rawSummary = await this.generateDetailedSummary(
      transcript,
      callId,
      template.autoTriggerPrompt ?? undefined,
      formatSummaryTemplateSections(template.sections),
      template.systemPrompt,
      RECORDING_DETAILED_SUMMARY_PROMPT,
      DEFAULT_RECORDING_SUMMARY_FIELDS,
      onDelta
        ? accumulated => onDelta(
            stripRecordingSummaryMarkedItemAnnotations(
              normalizeDetailedSummaryMarkdown(accumulated),
            ),
          )
        : undefined,
      modelType,
    );

    if (!rawSummary) return null;

    const normalizedSummary = normalizeDetailedSummaryMarkdown(rawSummary);
    const markedItems = citationSegments
      ? extractMarkedItemsFromRecordingSummary(normalizedSummary, citationSegments)
      : [];
    const summary = stripRecordingSummaryMarkedItemAnnotations(normalizedSummary);

    return { summary, template, markedItems };
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
    onDelta?: (accumulatedContent: string) => void | Promise<void>,
    modelType?: SummaryModelType,
  ): Promise<string | null> {
    // Use people who actually spoke in the transcript. A channel roster can contain
    // members who never joined or contributed to this particular call.
    const call = await repositories.calls.findByExternalId(callId);
    const spokenParticipantNames = extractTranscriptSpeakers(transcript);
    const callParticipants = await repositories.calls.getCallParticipantsWithUserDetails(callId);
    const participantByName = new Map(
      callParticipants.map((participant) => [participant.userName.toLowerCase(), participant]),
    );
    const callCreator = call
      ? await repositories.users.findById(call.createdByUserId)
      : null;

    // Resolve transcript labels to known user names when possible, then annotate
    // the creator only when they were one of the speakers.
    const callCreatorUserId = call?.createdByUserId;
    const participantList = spokenParticipantNames
      .map((speaker) => {
        const participant = participantByName.get(speaker.toLowerCase());
        const isCallCreator = participant?.userId === callCreatorUserId
          || (!participant
            && callCreator
            && speaker.toLowerCase() === (callCreator.displayName || callCreator.name).toLowerCase());
        const name = participant?.userName || speaker;
        return `- ${name}${isCallCreator ? ' {HOST}' : ''}`;
      })
      .join('\n');

    const sanitizedTranscript = sanitizeInput(transcript);
    const sanitizedCustomPrompt = customPrompt ? sanitizeInput(customPrompt) : '';
    const sanitizedFields = summaryFields?.trim() ? sanitizeInput(summaryFields) : '';
    const sanitizedSystemPrompt = systemPrompt ? sanitizeInput(systemPrompt) : '';
    const effectiveSystemPrompt = sanitizedSystemPrompt
      ? `${sanitizedSystemPrompt}

MANDATORY OUTPUT CONTRACT:
- Return only the completed meeting summary as Markdown.
- Never wrap the summary in JSON or emit a systemPrompt, summary, content, or markdown property.
- Follow the section structure, formatting, citation, and marked-item requirements in the user prompt.`
      : '';

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
      ...(effectiveSystemPrompt ? { systemPrompt: effectiveSystemPrompt } : {}),
      ...(modelType ? { modelType } : {}),
      onDelta,
    });

    if (!result.ok) {
      // Diagnostic for the LLM step itself; the caller that gives up on the
      // summary emits the alertable detailed_summary_generation_failed event.
      logger.error(`[${callId}] detailed_summary_llm_request_failed`, { reason: result.reason });
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
   * Grant the standard access policy for a canvas generated from a call.
   */
  private async createCallCanvasAccess(
    tx: Prisma.TransactionClient,
    params: {
      canvasId: string;
      workspaceId: string;
      callId: string;
      createdByUserId: string;
      callCreatorUserId: string;
      channelId: string | null;
      now: Date;
    },
  ): Promise<string> {
    const { canvasId, workspaceId, callId, createdByUserId, callCreatorUserId, channelId, now } = params;
    const call = await tx.call.findUnique({
      where: { externalId: callId },
      select: { id: true, callOrigin: true },
    });
    const isChannelThreadCall = call?.callOrigin === CallOrigin.CONVERSATION && channelId !== null;

    await tx.canvasParticipant.create({
      data: {
        id: uuidv4(), canvasId, workspaceId, userId: createdByUserId, role: CanvasRole.OWNER,
        joinedAt: now, updatedAt: now,
      },
    });
    await tx.canvasParticipant.create({
      data: {
        id: uuidv4(), canvasId, workspaceId, userId: callCreatorUserId, role: CanvasRole.OWNER,
        joinedAt: now, updatedAt: now,
      },
    });

    if (isChannelThreadCall && call) {
      const callParticipants = await tx.callParticipant.findMany({
        where: { callId: call.id, isExternal: false },
        select: { userId: true },
      });
      const editorUserIds = [...new Set(callParticipants.map(({ userId }) => userId))]
        .filter((userId) => userId !== createdByUserId && userId !== callCreatorUserId);
      if (editorUserIds.length > 0) {
        await tx.canvasParticipant.createMany({
          data: editorUserIds.map((userId) => ({
            id: uuidv4(), canvasId, workspaceId, userId, role: CanvasRole.EDITOR,
            joinedAt: now, updatedAt: now,
          })),
        });
      }
    }

    if (channelId) {
      await tx.canvasParticipant.create({
        data: {
          id: uuidv4(), canvasId, workspaceId, channelId,
          role: isChannelThreadCall ? CanvasRole.VIEWER : CanvasRole.EDITOR,
          joinedAt: now, updatedAt: now,
        },
      });
    }

    if (isChannelThreadCall) return 'thread participants as editors and channel as viewer';
    return channelId ? 'channel as editor' : 'private access';
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
      const workspaceId = await repositories.channels.getWorkspaceId(channelId);

      const title = `📋 PRD: ${prd.title}`;
      const content = formatPRDToBlockNote(prd, callId);

      let accessMode = 'private access';
      await prisma.$transaction(async (tx) => {
        // Keep PRD canvases private and grant the same explicit access as
        // detailed-summary canvases generated from this call.
        await tx.canvas.create({
          data: {
            id: canvasId,
            title,
            content: [],
            channelId,
            workspaceId,
            createdBy: createdByUserId,
            visibility: CanvasVisibility.PRIVATE,
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
        accessMode = await this.createCallCanvasAccess(tx, {
          canvasId,
          workspaceId,
          callId,
          createdByUserId,
          callCreatorUserId,
          channelId,
          now,
        });
      });

      // Initialize Y-Sweet for collaborative editing
      const ysweetInitialized = await initializeYSweetDoc(canvasId, content, createdByUserId);
      if (!ysweetInitialized) {
        logger.warn(`[CallDocumentService] Y-Sweet init failed for PRD canvas ${canvasId}`);
      }

      logger.info(`[CallDocumentService] Created collaborative PRD canvas ${canvasId} for call ${callId} with ${accessMode}, plus Xyne Automatic and call initiator as owners`);

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
    workspaceIdOverride?: string,
    options: {
      deferInsertSideEffects?: boolean;
      summaryModelPreference?: 'fast' | 'thinking';
    } = {},
  ): Promise<string | null> {
    try {
      const prisma = DatabaseClient.getInstance();
      const now = new Date();

      const canvasId = uuidv4();
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

      // Create a private canvas with explicit access for its call context:
      // DM attendees edit, direct channel calls grant channel edit access, and
      // channel-thread calls grant attendees edit plus channel view access.
      // Additional recording shares are managed per-user/group/channel via
      // entity_access, and the recording sharing API updates canvas_participants
      // in the same transaction.
      //
      // Bootstrapping the canvas + its two initial owners (Xyne Automatic bot,
      // call creator) is a trusted system sequence, not the acting requester
      // adding arbitrary participants — that requester may just be someone the
      // recording was shared with, who isn't yet a participant on this
      // brand-new canvas. Run it as an interactive transaction so it bypasses
      // the per-request tenant ACL (CanvasParticipantsACL.canCreate would
      // otherwise deny the second insert since the requester isn't a
      // participant yet); regular canvas access after this stays ACL-gated.
      let accessMode = 'private access';
      await prisma.$transaction(async (tx) => {
        await tx.canvas.create({
          data: {
            id: canvasId,
            title,
            content: [],
            channelId,
            workspaceId,
            createdBy: createdByUserId,
            visibility: CanvasVisibility.PRIVATE,
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
              version: INITIAL_DETAILED_SUMMARY_CANVAS_VERSION,
              // Recording summary LLM tier the client carried from its
              // localStorage at recording start; read back on the headless
              // call-end path (see noteTakerTranscriptService.getSummaryModelPreference).
              ...(options.summaryModelPreference
                ? { summaryModelPreference: options.summaryModelPreference }
                : {}),
            },
          },
        });

        accessMode = await this.createCallCanvasAccess(tx, {
          canvasId,
          workspaceId,
          callId,
          createdByUserId,
          callCreatorUserId,
          channelId,
          now,
        });
      });

      // Initialize Y-Sweet for collaborative editing
      const ysweetInitialized = await initializeYSweetDoc(canvasId, sanitizedContent as unknown as BlockNoteBlock[], createdByUserId);
      if (!ysweetInitialized) {
        logger.warn(`[CallDocumentService] Y-Sweet init failed for detailed summary canvas ${canvasId}`);
      }

      logger.info(`[CallDocumentService] Created collaborative detailed summary canvas ${canvasId} for call ${callId} with ${accessMode}, plus Xyne Automatic and call creator as owners`);

      // A streaming canvas is created from its first content delta. Defer
      // creation activity, mention notifications, and indexing until the final
      // metadata/content are available.
      if (!options.deferInsertSideEffects) {
        const { canvasHandler, workspaceId: sideEffectWorkspaceId } =
          await this.createCanvasSideEffectHandler(createdByUserId);

        canvasHandler.onInsert({
          entityId: canvasId,
          entityType: 'canvases',
          operation: 'insert'
        }).catch(err => logger.error('[CallDocumentService] Canvas side-effect handler error:', err));

        await this.queueVespaIndexing(canvasId, createdByUserId, 'create', sideEffectWorkspaceId);
      }

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
    citationCtx?: CitationContext,
    callStartedAt?: Date
  ): Promise<string | null> {
    try {
      const prisma = DatabaseClient.getInstance();
      const now = new Date();

      // Prepare canvas content (title, content, mentions, citations). Falls back to
      // a timestamp-based title (instead of the bare "(Updated)" placeholder) when
      // callTitle isn't ready yet — e.g. AI title generation is still racing this update.
      const { title, content: sanitizedContent, mentionedUserIds } = await this.prepareCanvasContent(
        markdownSummary,
        channelId,
        callStartedAt,
        callTitle,
        citationCtx
      );

      const newVersion = currentVersion + 1;

      // Sync to Y-Sweet (the source of truth) FIRST. If it fails, don't bump the
      // DB version/metadata — return null so the caller reports the failure
      // instead of leaving a canvas whose recorded version doesn't match its
      // (unchanged) content.
      const ysweetSynced = await syncToYSweet(canvasId, sanitizedContent as unknown as BlockNoteBlock[], updatedByUserId);
      if (!ysweetSynced) {
        logger.error(`[CallDocumentService] Y-Sweet sync failed for canvas ${canvasId}; aborting update`);
        return null;
      }

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

      // Queue Vespa re-indexing for the updated canvas
      await this.queueVespaIndexing(canvasId, updatedByUserId, 'update');

      return canvasId;
    } catch (error) {
      logger.error('[CallDocumentService] Failed to update detailed summary canvas:', error);
      return null;
    }
  }

  /**
   * Write the final, complete detailed-summary content into a canvas that was
   * created from the first delta for live streaming. Keeps the version the
   * provisional message already announced (no extra increment) and returns
   * false if the Y-Sweet write fails, so the caller can surface it rather than
   * reporting success.
   */
  async finalizeDetailedSummaryCanvas(
    canvasId: string,
    markdownSummary: string,
    updatedByUserId: string,
    channelId: string | null,
    callId: string,
    callStartedAt: Date,
    callTitle?: string | null,
    citationCtx?: CitationContext,
    sideEffectContextPromise?: Promise<CanvasSideEffectContext | null>,
  ): Promise<boolean> {
    try {
      const prisma = DatabaseClient.getInstance();
      const now = new Date();

      const { title, content: sanitizedContent, mentionedUserIds } = await this.prepareCanvasContent(
        markdownSummary,
        channelId,
        callStartedAt,
        callTitle,
        citationCtx,
      );

      // Y-Sweet is the source of truth; write the authoritative content first and
      // bail out if it fails rather than reporting a success that never landed.
      const ysweetSynced = await syncToYSweet(canvasId, sanitizedContent as unknown as BlockNoteBlock[], updatedByUserId);
      if (!ysweetSynced) {
        logger.error(`[CallDocumentService] Final Y-Sweet sync failed for canvas ${canvasId}`);
        return false;
      }

      // Refresh title + mentions metadata at the same reserved initial version.
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
            version: INITIAL_DETAILED_SUMMARY_CANVAS_VERSION,
          },
        },
      });

      // Queue the authoritative index before notifying anyone about the finalized
      // canvas. The deferred insert handler skips its own Vespa job.
      await this.queueVespaIndexing(canvasId, updatedByUserId, 'update');

      // Creation side effects were intentionally deferred while this canvas was
      // empty. Run them now so the handler reads the finalized mention metadata.
      try {
        const sideEffectContext = sideEffectContextPromise
          ? await sideEffectContextPromise
          : await this.createCanvasSideEffectHandler(updatedByUserId);
        if (sideEffectContext) {
          await sideEffectContext.canvasHandler.onDeferredInsert({
            entityId: canvasId,
            entityType: 'canvases',
            operation: 'insert',
          });
        }
      } catch (sideEffectError) {
        logger.error('[CallDocumentService] Failed to run finalized canvas insert side effects:', sideEffectError);
      }

      return true;
    } catch (error) {
      logger.error('[CallDocumentService] Failed to finalize detailed summary canvas:', error);
      return false;
    }
  }

  /**
   * Replace the Y-Sweet content of an in-progress detailed-summary canvas
   * without changing its title, metadata, version, or search index. The final
   * authoritative write is still handled by finalizeDetailedSummaryCanvas.
   */
  async syncStreamingDetailedSummaryCanvas(
    canvasId: string,
    markdownSummary: string,
    updatedByUserId: string,
    citationCtx?: CitationContext,
  ): Promise<boolean> {
    try {
      const { blocks } = await convertMarkdownToBlockNote(
        markdownSummary,
        new Map<string, ParticipantInfo>(),
        citationCtx,
      );
      if (blocks.length === 0) return true;

      return await syncToYSweet(
        canvasId,
        sanitizeBlockNoteContent(blocks) as unknown as BlockNoteBlock[],
        updatedByUserId,
      );
    } catch (error) {
      logger.error(
        `[CallDocumentService] Failed to sync streaming detailed summary canvas ${canvasId}:`,
        error,
      );
      return false;
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
        citationCtx,
        callStartedAt
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
      version: INITIAL_DETAILED_SUMMARY_CANVAS_VERSION,
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
        // Update existing message instead of creating a new one.
        // The row belongs to the bot, not the caller, so it runs above the caller's own scope.
        await withWorkspaceScope(() =>
          prisma.message.update({
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
          }),
        );
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
    canvasUrl: string | null
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
        await prisma.$transaction(async (tx) => {
          // Title generation and first-chunk Canvas publication can now update
          // this message concurrently. Lock the row and merge from the latest
          // metadata so neither write erases the other's key.
          const [lockedMessage] = await tx.$queryRaw<Array<{ metadata: unknown }>>`
            SELECT "metadata"
            FROM "messages"
            WHERE "messageId" = ${callMessage.messageId}
            FOR UPDATE
          `;
          if (!lockedMessage) {
            return;
          }

          // Set the canvas URL, or drop the key entirely when clearing (null).
          const currentMetadata = (lockedMessage.metadata as Record<string, any>) || {};
          const nextMetadata = { ...currentMetadata };
          if (canvasUrl === null) {
            delete nextMetadata[metadataKey];
          } else {
            nextMetadata[metadataKey] = canvasUrl;
          }
          await tx.message.update({
            where: { messageId: callMessage.messageId },
            data: { metadata: nextMetadata },
          });
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
   * Undo the artifacts published up-front for a brand-new streaming canvas when
   * generation ultimately fails: delete the posted summary message (and its
   * reply-count bump), clear the detailedSummaryCanvasUrl stamped on the call
   * message, clear the live Y-Sweet content, remove all canvas database rows,
   * and remove the Vespa document. Best-effort — each step is independent so
   * one failure doesn't block the others.
   */
  private async cleanupFailedDetailedSummaryCanvas(
    canvasId: string,
    conversationId: string,
    callId: string,
    userId: string,
  ): Promise<void> {
    logger.warn(`[CallDocumentService] Cleaning up failed detailed summary canvas ${canvasId} for call ${callId}`);

    try {
      const message = await repositories.messages.findExistingDetailedSummaryMessage(conversationId, callId);
      if (message) {
        await repositories.messages.delete(message.messageId);
        await repositories.conversations.decrementReplyCount(conversationId);
      }
    } catch (error) {
      logger.error('[CallDocumentService] Cleanup: failed to remove detailed summary message:', error);
    }

    try {
      await this.updateCallMessageMetadata(conversationId, callId, 'detailedSummaryCanvasUrl', null);
    } catch (error) {
      logger.error('[CallDocumentService] Cleanup: failed to clear call metadata:', error);
    }

    // The installed Y-Sweet SDK has no document-deletion API. Clear the shared
    // fragment so connected clients no longer see partial generated content.
    // This is not physical deletion: CRDT history remains subject to Y-Sweet's
    // own retention policy until its SDK exposes a supported delete operation.
    try {
      const ysweetCleared = await syncToYSweet(canvasId, [], userId);
      if (!ysweetCleared) {
        logger.warn(`[CallDocumentService] Cleanup: failed to clear Y-Sweet canvas ${canvasId}`);
      }
    } catch (error) {
      logger.error('[CallDocumentService] Cleanup: failed to clear Y-Sweet content:', error);
    }

    try {
      const prisma = DatabaseClient.getInstance();
      // CanvasParticipant and CanvasUserStatus do not declare cascading deletes
      // in relationMode="prisma", so remove dependent rows explicitly. deleteMany
      // also keeps this cleanup idempotent if a previous attempt partially ran.
      await prisma.$transaction([
        prisma.canvasVersion.deleteMany({ where: { canvasId } }),
        prisma.canvasParticipant.deleteMany({ where: { canvasId } }),
        prisma.canvasUserStatus.deleteMany({ where: { canvasId } }),
        prisma.canvas.deleteMany({ where: { id: canvasId } }),
      ]);
    } catch (error) {
      logger.error('[CallDocumentService] Cleanup: failed to delete canvas database rows:', error);
    }

    // Deferred streaming creation does not queue a feed. Keep a defensive delete
    // in case an older or retried indexing job exists for this canvas id.
    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'delete',
        app: SubApp.CANVAS,
      });
    } catch (error) {
      logger.error('[CallDocumentService] Cleanup: failed to queue Vespa deletion:', error);
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
   * Persist a summary's annotated decisions and actions as timeline markers.
   *
   * `Call.markedItems` also holds the moments the user flagged mid-call, so the
   * merge keeps those — a regenerated summary must not drop a user's flags.
   * Timestamps come from the same segment map the citations resolve against, so
   * an unresolvable bullet is dropped rather than guessed.
   *
   * Best-effort: the summary is the deliverable, so a failure here is swallowed.
   */
  private async persistCallMarkedItems(
    callId: string,
    annotatedMarkdown: string,
    segments: CitationContext['segments'],
  ): Promise<void> {
    try {
      const generated = extractMarkedItemsFromRecordingSummary(annotatedMarkdown, segments);
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) return;

      const merged = mergeRecordingSummaryMarkedItems(call.markedItems, generated);
      await repositories.calls.update(call.id, {
        markedItems: merged as Prisma.InputJsonValue[],
      });
      logger.info(`[${callId}] call_marked_items_persisted`, {
        generated_count: generated.length,
        total_count: merged.length,
      });
    } catch (error) {
      logger.warn(`[${callId}] call_marked_items_persist_failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Generate and post detailed summary to conversation
   */
  async generateAndPostDetailedSummary(
    callId: string,
    transcript: string,
    conversationId: string,
    customPrompt?: string,
    options: { callTitlePromise?: Promise<string | null> } = {},
  ): Promise<{ success: boolean; canvasUrl?: string; error?: string }> {
    // Tracks a brand-new, lazily-created streaming canvas so any failure after
    // its first chunk can tear down the canvas and published message.
    let newCanvasId: string | null = null;
    // Mirrors xyneAutomaticBot.id outside the try block's scope so the outer
    // catch can still identify the actor for cleanup after a mid-generation failure.
    let xyneAutomaticBotId: string | undefined;
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
      const participantMapPromise = buildParticipantMap(call.channelId || conversation.channelId)
        .catch(participantMapError => {
          logger.warn(`[${callId}] detailed_summary_participant_map_unavailable`, {
            error: participantMapError instanceof Error
              ? participantMapError.message
              : String(participantMapError),
          });
          return new Map<string, ParticipantInfo>();
        });
      const speakerParticipantMap = await participantMapPromise;
      for (const s of segments) {
        const info = speakerParticipantMap.get(s.speaker.toLowerCase());
        if (info) s.speakerId = info.userId;
      }
      const citationCtx: CitationContext = {
        callId,
        segments: new Map(segments.map(s => [s.n, s])),
      };

      // Get Xyne Automatic bot
      const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic', channel.workspaceId);
      if (!xyneAutomaticBot) {
        throw new Error('Xyne Automatic bot not found');
      }
      xyneAutomaticBotId = xyneAutomaticBot.id;

      let resolvedCallTitle = call.title;
      const callTitlePromise = (options.callTitlePromise ?? Promise.resolve(null))
        .then((generatedTitle) => {
          // Scheduled/headless calls may already have a deliberate title. Only
          // fill the gap with the concurrently-generated title.
          if (!resolvedCallTitle && generatedTitle) {
            resolvedCallTitle = generatedTitle;
          }
          return resolvedCallTitle;
        })
        .catch((titleError) => {
          logger.warn(`[${callId}] detailed_summary_call_title_unavailable`, {
            error: titleError instanceof Error ? titleError.message : String(titleError),
          });
          return resolvedCallTitle;
        });
      const buildCanvasTitle = (callTitle?: string | null): string => {
        const suffix = callTitle || formatToISTLocaleString(new Date(call.startedAt));
        return `Detailed Summary - ${suffix}`;
      };

      // Only a brand-new canvas streams live. A rerun keeps its existing (valid)
      // content untouched and is written exactly once at the end, so a
      // mid-generation failure can never leave a previously-good summary erased.
      const existingCanvas = await findExistingDetailedSummaryCanvas(callId);

      if (existingCanvas) {
        const annotatedMarkdown = await this.generateDetailedSummary(
          numberedTranscript,
          callId,
          customPrompt,
          channel.callSummaryPrompt ?? undefined,
        );
        if (!annotatedMarkdown) {
          logDetailedSummaryFailed(callId, 'generation_failed');
          return { success: false, error: 'Failed to generate detailed summary' };
        }

        await this.persistCallMarkedItems(callId, annotatedMarkdown, citationCtx.segments);
        const detailedSummaryMarkdown =
          stripRecordingSummaryMarkedItemAnnotations(annotatedMarkdown);

        // A rerun keeps its existing title; only wait on concurrent title
        // generation when the call has no title yet, so a present title does
        // not add needless latency here.
        if (!resolvedCallTitle) {
          await callTitlePromise;
        }

        // Single update reserves one version for this generation; the message
        // announces that same version.
        const { canvasId, version } = await this.createOrUpdateDetailedSummaryCanvas(
          callId,
          detailedSummaryMarkdown,
          xyneAutomaticBot.id,
          conversationId,
          conversation.channelId,
          call.startedAt,
          call.createdByUserId,
          resolvedCallTitle,
          citationCtx,
        );
        if (!canvasId) {
          logDetailedSummaryFailed(callId, 'canvas_update_failed');
          return { success: false, error: 'Failed to update detailed summary canvas' };
        }

        const canvasUrl = getCanvasUrl(canvasId);
        await this.postDetailedSummaryToConversation(
          conversationId,
          callId,
          canvasUrl,
          buildCanvasTitle(resolvedCallTitle),
          channel.workspaceId,
          version
        );
        return { success: true, canvasUrl };
      }

      // New canvas: start the LLM first. The first content delta creates the
      // canvas with that content already in Y-Sweet, then publishes its URL.
      // This avoids both an empty dangling canvas and waiting for call-title
      // generation before detailed-summary streaming can begin.
      const SYNC_INTERVAL_MS = 300;
      const sleepMs = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
      let latestMarkdown = '';
      let renderedMarkdown = '';
      let canvasUrl: string | null = null;
      let postedCanvasTitle: string | null = null;
      let canvasInitialization: Promise<void> | null = null;
      let canvasInitializationError: Error | null = null;
      const getCanvasInitializationError = (): Error | null => canvasInitializationError;
      let sideEffectContextPromise: Promise<CanvasSideEffectContext | null> | null = null;
      let writerActive = false;
      let writerLoop: Promise<void> | null = null;

      const flushLatest = async (): Promise<void> => {
        if (!newCanvasId || latestMarkdown === renderedMarkdown) {
          return;
        }
        const snapshot = latestMarkdown;
        try {
          const participantMap = await participantMapPromise;
          const { blocks } = await convertMarkdownToBlockNote(snapshot, participantMap, citationCtx);
          if (blocks.length > 0) {
            const synced = await syncToYSweet(
              newCanvasId,
              sanitizeBlockNoteContent(blocks) as unknown as BlockNoteBlock[],
              xyneAutomaticBot.id,
            );
            if (!synced) {
              throw new Error('Y-Sweet sync returned false');
            }
            renderedMarkdown = snapshot;
          }
        } catch (writeError) {
          logger.warn(`[${callId}] detailed_summary_stream_write_failed`, {
            error: writeError instanceof Error ? writeError.message : String(writeError),
          });
        }
      };

      const startWriter = (): void => {
        writerActive = true;
        writerLoop = (async (): Promise<void> => {
          while (writerActive) {
            await flushLatest();
            await sleepMs(SYNC_INTERVAL_MS);
          }
        })();
      };

      const ensureStreamingCanvas = async (
        firstMarkdown: string,
        startLiveWriter: boolean = true,
      ): Promise<void> => {
        if (canvasInitialization || canvasInitializationError) {
          if (canvasInitialization) {
            await canvasInitialization;
          }
          return;
        }

        canvasInitialization = (async (): Promise<void> => {
          const canvasId = await this.createDetailedSummaryCanvas(
            callId,
            firstMarkdown,
            xyneAutomaticBot.id,
            conversationId,
            conversation.channelId,
            call.startedAt,
            call.createdByUserId,
            resolvedCallTitle,
            citationCtx,
            undefined,
            { deferInsertSideEffects: true },
          );
          if (!canvasId) {
            throw new Error('Failed to create detailed summary canvas');
          }

          // Resolve the side-effect identity once, concurrently with streaming,
          // and reuse it during finalization without delaying this first chunk.
          sideEffectContextPromise = this.createCanvasSideEffectHandler(xyneAutomaticBot.id)
            .catch(sideEffectIdentityError => {
              logger.error(`[${callId}] detailed_summary_side_effect_identity_unavailable`, {
                error: sideEffectIdentityError instanceof Error
                  ? sideEffectIdentityError.message
                  : String(sideEffectIdentityError),
              });
              return null;
            });

          newCanvasId = canvasId;
          renderedMarkdown = firstMarkdown;
          canvasUrl = getCanvasUrl(canvasId);
          postedCanvasTitle = buildCanvasTitle(resolvedCallTitle);

          // The initial Y-Sweet document already contains the first accumulated
          // chunk. Publish the link only after that write has completed.
          await this.postDetailedSummaryToConversation(
            conversationId,
            callId,
            canvasUrl,
            postedCanvasTitle,
            channel.workspaceId,
            INITIAL_DETAILED_SUMMARY_CANVAS_VERSION,
          );

          if (startLiveWriter) {
            startWriter();
          }
        })().catch((initializationError) => {
          canvasInitializationError = initializationError instanceof Error
            ? initializationError
            : new Error(String(initializationError));
          logger.error(`[${callId}] detailed_summary_canvas_initialization_failed`, {
            error: canvasInitializationError.message,
          });
        });

        await canvasInitialization;
      };

      let detailedSummaryMarkdown: string | null;
      try {
        detailedSummaryMarkdown = await this.generateDetailedSummary(
          numberedTranscript,
          callId,
          customPrompt,
          channel.callSummaryPrompt ?? undefined,
          undefined,
          DETAILED_SUMMARY_PROMPT,
          DEFAULT_SUMMARY_FIELDS,
          async (accumulated: string) => {
            // The annotations are internal metadata. Strip them from every delta,
            // partial ones included, so `[xyne-action]` is never briefly visible
            // in the canvas mid-stream.
            const visibleMarkdown = stripRecordingSummaryMarkedItemAnnotations(accumulated);
            latestMarkdown = visibleMarkdown;
            await ensureStreamingCanvas(visibleMarkdown);
          },
        );
      } finally {
        // Stop the writer on success, handled failure, or throw. It is only
        // started after the first chunk has successfully published the canvas.
        writerActive = false;
        if (writerLoop) {
          await writerLoop;
        }
        // The loop may have gone to sleep just before the last delta arrived.
        // Flush once after stopping so final streamed content is visible even
        // while the independently-generated call title is still pending.
        await flushLatest();
      }

      if (!detailedSummaryMarkdown) {
        logDetailedSummaryFailed(callId, 'generation_failed');
        if (newCanvasId) {
          await this.cleanupFailedDetailedSummaryCanvas(newCanvasId, conversationId, callId, xyneAutomaticBot.id);
        }
        return { success: false, error: 'Failed to generate detailed summary' };
      }

      // Markers come off the ANNOTATED markdown; everything downstream of here
      // renders the stripped copy.
      await this.persistCallMarkedItems(callId, detailedSummaryMarkdown, citationCtx.segments);
      detailedSummaryMarkdown = stripRecordingSummaryMarkedItemAnnotations(detailedSummaryMarkdown);

      // Defensive fallback for providers that return final content without any
      // content delta. The response is already complete, so initialize the
      // canvas without starting a writer that nothing would later stop.
      if (!newCanvasId && !canvasInitializationError) {
        await ensureStreamingCanvas(detailedSummaryMarkdown, false);
      }
      const initializationFailure = getCanvasInitializationError();
      if (initializationFailure || !newCanvasId || !canvasUrl) {
        logDetailedSummaryFailed(callId, 'canvas_create_failed', initializationFailure);
        if (newCanvasId) {
          await this.cleanupFailedDetailedSummaryCanvas(newCanvasId, conversationId, callId, xyneAutomaticBot.id);
        }
        return {
          success: false,
          error: initializationFailure?.message || 'Failed to create detailed summary canvas',
        };
      }

      await callTitlePromise;
      const finalizedCanvasId = newCanvasId;
      const finalizedCanvasUrl = canvasUrl;

      // Finalize at the same initial version: authoritative content + title/mentions
      // + re-index. Returns false if the Y-Sweet write fails so we don't report
      // success on a lost final write.
      const finalized = await this.finalizeDetailedSummaryCanvas(
        finalizedCanvasId,
        detailedSummaryMarkdown,
        xyneAutomaticBot.id,
        conversation.channelId,
        callId,
        call.startedAt,
        resolvedCallTitle,
        citationCtx,
        sideEffectContextPromise ?? undefined,
      );
      if (!finalized) {
        logDetailedSummaryFailed(callId, 'canvas_finalize_failed');
        await this.cleanupFailedDetailedSummaryCanvas(finalizedCanvasId, conversationId, callId, xyneAutomaticBot.id);
        return { success: false, error: 'Failed to write final detailed summary content' };
      }

      // If the title LLM completed after the first content delta, update the
      // already-posted link to match the finalized canvas title. This remains
      // at the initial version and therefore does not display an "updated" indicator.
      const finalizedCanvasTitle = buildCanvasTitle(resolvedCallTitle);
      if (postedCanvasTitle !== finalizedCanvasTitle) {
        try {
          await this.postDetailedSummaryToConversation(
            conversationId,
            callId,
            finalizedCanvasUrl,
            finalizedCanvasTitle,
            channel.workspaceId,
            INITIAL_DETAILED_SUMMARY_CANVAS_VERSION,
          );
        } catch (messageTitleError) {
          logger.warn(`[${callId}] detailed_summary_message_title_refresh_failed`, {
            error: messageTitleError instanceof Error ? messageTitleError.message : String(messageTitleError),
          });
        }
      }

      return { success: true, canvasUrl: finalizedCanvasUrl };
    } catch (error) {
      logDetailedSummaryFailed(callId, 'unexpected_error', error);
      // If a brand-new canvas + link was already published before the throw,
      // tear it down so an exception doesn't leave a dangling canvas/message.
      if (newCanvasId) {
        if (!xyneAutomaticBotId) {
          throw new Error(
            `[CallDocumentService] Cannot clean up canvas ${newCanvasId}: xyneAutomaticBotId was never resolved`,
          );
        }
        await this.cleanupFailedDetailedSummaryCanvas(newCanvasId, conversationId, callId, xyneAutomaticBotId);
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const callDocumentService = new CallDocumentService();
