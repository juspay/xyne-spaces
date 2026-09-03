export const RECORDING_DETAILED_SUMMARY_PROMPT = `You are creating a clear, structured meeting summary that follows the provided template.
LANGUAGE: Generate this entire summary in English, regardless of the transcript language.

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls")

INSUFFICIENT TRANSCRIPT (check this first, before anything else below):
- Be VERY lenient here — only treat the transcript as insufficient if it is essentially empty: fewer than roughly 100 characters total, or just noise/silence/a single stray word with no real content.
- If the TRANSCRIPT has more than that — even a short exchange or a brief conversation — treat it as enough content and generate a real summary as normal. Do not bail out just because a call was short.
- Only when the transcript is truly that tiny, output ONLY the following and nothing else (no template sections, no other headings):
    ### ⚠️ Not enough data
    - There isn't enough transcript content to generate a summary for this recording.
- Every other instruction below only applies once you've confirmed the transcript has enough real content to summarize.

FORMATTING:
- Use Markdown headings, short paragraphs, and bullet lists. DO NOT use markdown tables anywhere.
- Never leave a bare paragraph line as the last line of a section, directly above a \`---\` separator — Markdown turns it into a setext heading. Write such content as a bullet instead.
- Preserve every section heading from the MARKDOWN TEMPLATE exactly, including its leading \`###\` marker and emoji, except for the Decisions and Action Items headings described below.
- Render the Decisions heading with a yellow dot (\`### 🟡 Decisions\`) and the Action Items heading with an orange dot (\`### 🟠 Action Items\`), replacing any existing emoji on those two headings. Keep the dots on the headings, not on individual bullets.
- Never convert a template heading into plain text, bold text, or a list item.
- Keep bullets concise; put supporting detail inline after an em dash.

STRUCTURE:
- Fill the sections defined in the MARKDOWN TEMPLATE below, directly from the transcript. Follow that structure exactly — do not rename, add, or reorder sections.
- CHAPTERS (long calls only): Only if this is a LONG call — roughly 30+ minutes or a long transcript — add a "### 📍 Chapters" section that breaks the conversation into 4–7 chapters by topic shift. For short or medium calls, DO NOT add a Chapters section at all — just fill the template sections.
- When included, place the Chapters section immediately after the first overview/takeaways section, using this format per chapter:
    #### [Chapter title — e.g. "Activation flow is fragmented"]
    [1-2 sentence summary]
    - [Key point]
    - [Key point]

MARKDOWN TEMPLATE:
{fields}

CALL PARTICIPANTS (Correct Names):
{participants}

IMPORTANT - NAME ACCURACY:
- The transcript may contain misspelled or incorrectly transcribed participant names
- If a name in the transcript seems close to a participant name, use the correct version from the list
- For @mentions in Action Items, use the full correct name (e.g., @Mayank Bansal)

INSTRUCTIONS:
- Capture ACTUAL content from the transcript - no generic placeholders
- Include specific names, numbers, dates mentioned
- Preserve chronological order where it matters
- Keep all template section titles as level-three Markdown headings (\`###\`)
- Skip sections that have no relevant content — write the single bullet \`- Not discussed\` rather than inventing detail. It MUST be a bullet: a bare \`Not discussed\` line sits directly above the template's \`---\` separator, which Markdown then parses as a setext heading and renders in huge heading text.
- Add Chapters ONLY for long calls, per the STRUCTURE rule above; never force chapters onto a short or medium call
- In Action Items: Use @ before FULL NAMES for participants in the call (e.g., @Mayank Bansal)
- In Action Items: For people NOT in the participant list, write their name plainly with "(not in channel)" notation

MARKED DECISIONS AND ACTIONS:
- Prefix every concrete decision bullet with the exact private annotation \`[xyne-decision]\` immediately after the bullet marker.
- Prefix every concrete action-item bullet with the exact private annotation \`[xyne-action]\` immediately after the bullet marker.
- Every annotated bullet MUST end with at least one supporting transcript citation. The first citation must identify the moment most closely associated with that decision or action.
- Never use these annotations for takeaways, discussion points, open questions, blockers, or other bullets.
- The annotations are internal metadata and will be removed before the summary is displayed.
- Examples:
  - \`- [xyne-decision] The team approved the consolidated pipeline [clf-12]\`
  - \`- [xyne-action] @Mayank Bansal will update the backend [clf-18]\`

CITATIONS (ACCURACY IS CRITICAL):
- Each transcript line is prefixed with its segment number: "[12] [03:24] Alice: ...". The number 12 is that line's segment id.
- A citation is a PROOF POINTER, not decoration. [clf-N] asserts: "the words that make this statement true are inside segment N." The reader clicks it and is taken to that exact moment in the transcript.
- BEFORE writing [clf-N], find line N in the TRANSCRIPT below and confirm its text actually states what you just wrote. If you cannot point to the specific words in that line, do NOT cite it.
- Topic proximity is NOT support. A segment that merely discusses the same subject, or sits near the moment you have in mind, does not support the claim. Never cite "roughly where it was discussed".
- Never estimate, guess, round, shift, or reconstruct a segment number from memory of where something appeared. Read the number off the line itself. If you are not certain of the number, leave the statement uncited.
- Attribution must match: if the statement says who said, wanted, offered, agreed to, or committed to something, the cited segment must be that person's line, or a line that explicitly states their position.
- Each token in a group must independently support the statement. Never pad with extra numbers to look thorough — one exact citation beats three approximate ones. At most 3 tokens together, e.g. "...scope was cut [clf-8][clf-9]", most direct evidence first.
- For a roll-up statement that synthesises several moments (typical of Key Takeaways): cite only the 1-3 segments where that point is most explicitly stated. If no segment states it, RE-WORD the statement so it matches what a segment actually says — never attach an approximate citation just to satisfy the format.
- An uncited statement is acceptable. A wrongly cited statement is a serious error, because it looks verified and is not.
- Decision and action bullets MUST carry a citation (see MARKED DECISIONS AND ACTIONS). For those, pick the segment where the decision was actually made or the task actually assigned, and word the bullet to match that segment — do not fall back to a loose citation.
- Copy N exactly. Never invent segment numbers, never use ranges like [clf-8-11], never cite a line that has no bracketed number. Write only the bare token — no links, URLs, footnotes, or a separate "Citations"/"Sources" section.
- FINAL CHECK before you output: re-read every [clf-N] you wrote, look the segment up again, and delete or re-word any citation whose segment does not contain the claim it is attached to.

Only output valid Markdown (headings, paragraphs, and bullet lists only — no tables).
No extra text.

TRANSCRIPT:
{transcript}

FINAL REMINDER — CITATIONS: every [clf-N] you write must point at a numbered segment above whose text actually states the claim it is attached to. Verify each one against the lines above before you output. Drop or re-word any you cannot verify — an uncited statement is fine, a wrongly cited one is not.
`;

// AI Title prompt for headless recordings (Xyne Scribe) — separate from the
// regular call title prompt (transcriptService.ts's CALL_TITLE_PROMPT) so the
// two can be tuned independently, mirroring the summary prompt split above.
export const RECORDING_TITLE_PROMPT = `
You are summarizing the topic of a recording in exactly 1 line.

CRITICAL RULES:
- Output EXACTLY 1 line
- One sentence summarizing the main topic (max 100 characters)
- No quotes, no labels, no bullet points, no explanations
- Write in plain, natural language

INSUFFICIENT TRANSCRIPT:
- Be VERY lenient here — only treat the transcript as insufficient if it is essentially empty: fewer than roughly 100 characters total, or just noise/silence/a single stray word with no real content.
- If the TRANSCRIPT has more than that — even a short exchange — treat it as enough to identify a topic and generate a real title as normal. Do not bail out just because a recording was short.
- Only when the transcript is truly that tiny, output EXACTLY this and nothing else: Not enough content

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls")

Generate a 1-line description for this recording:
{transcript}
`;

export const DEFAULT_RECORDING_SUMMARY_FIELDS = `### 💡 Key Takeaways
- [Most important outcome]
- [Second most important]
- [Third if applicable]
---
### 📝 Call Overview
- Participants: [All participants mentioned]
- Primary Focus: [1-2 sentence summary of the main purpose]
---
### 🗣️ Discussion Summary
- [Main point discussed]
- [Main point discussed]
- [Notable names, numbers, dates, or quotes]
---
### 🟡 Decisions
- [Decision] — Owner: [Person] ([why / context])
---
### 🟠 Action Items
- [Task] — @[Assignee] · Due: [Date] · Priority: [H/M/L]
---
### 🔗 Open Items & Follow-up
- [Unresolved question or parked topic]
- Blockers: [Any blockers identified]
- Next Meeting: [If mentioned]`;


// The only code-backed template. Every other template is created and stored in
// summary_templates through the template system.
export const DEFAULT_RECORDING_SUMMARY_TEMPLATE = {
  id: 'default',
  name: 'Default summary',
  fields: DEFAULT_RECORDING_SUMMARY_FIELDS,
  selectionCriteria: 'Use for general meetings that do not strongly match a specialized template.',
} as const;
