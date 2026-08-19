export const RECORDING_DETAILED_SUMMARY_PROMPT = `You are creating a clear, structured meeting summary that follows the provided template.
LANGUAGE: Generate this entire summary in English, regardless of the transcript language.

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls")

FORMATTING:
- Use Markdown headings, short paragraphs, and bullet lists. DO NOT use markdown tables anywhere.
- Never leave a bare paragraph line as the last line of a section, directly above a \`---\` separator — Markdown turns it into a setext heading. Write such content as a bullet instead.
- Preserve every section heading from the MARKDOWN TEMPLATE exactly, including its leading \`###\` marker and emoji.
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

CITATIONS:
- Each transcript line may start with a segment number such as "[12] [03:24] Alice: ...".
- After a specific claim, decision, action item, number, date, name, or quote, append the supporting token [clf-N].
- Copy N exactly from the transcript. Never invent segment numbers or add a separate citations section.

Only output valid Markdown (headings, paragraphs, and bullet lists only — no tables).
No extra text.

TRANSCRIPT:
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
### ✅ Decisions
- [Decision] — Owner: [Person] ([why / context])
---
### 📋 Action Items
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
