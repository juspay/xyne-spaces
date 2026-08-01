export const RECORDING_DETAILED_SUMMARY_PROMPT = `You are creating a clear, structured meeting summary that follows the provided template.
**LANGUAGE: Generate this entire summary in English, regardless of the transcript language.**

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls")

**FORMATTING:**
- Use ONLY short paragraphs and bullet lists. DO NOT use markdown tables anywhere.
- Keep bullets concise; put supporting detail inline after an em dash.

**STRUCTURE:**
- Fill the sections defined in the MARKDOWN TEMPLATE below, directly from the transcript. Follow that structure exactly — do not add or reorder sections.
- CHAPTERS (long calls only): Only if this is a LONG call — roughly 30+ minutes or a long transcript — add a "### 📍 Chapters" section that breaks the conversation into 4–7 chapters by topic shift. For short or medium calls, DO NOT add a Chapters section at all — just fill the template sections.
- When included, place the Chapters section immediately after the first overview/takeaways section, using this format per chapter:
    #### [Chapter title — e.g. "Activation flow is fragmented"]
    [1-2 sentence summary]
    - [Key point]
    - [Key point]

MARKDOWN TEMPLATE:
{fields}

**CALL PARTICIPANTS (Correct Names):**
{participants}

**IMPORTANT - NAME ACCURACY:**
- The transcript may contain misspelled or incorrectly transcribed participant names
- If a name in the transcript seems close to a participant name, use the correct version from the list
- For @mentions in Action Items, use the full correct name (e.g., @Mayank Bansal)

**INSTRUCTIONS:**
- Capture ACTUAL content from the transcript - no generic placeholders
- Include specific names, numbers, dates mentioned
- Preserve chronological order where it matters
- Skip sections that have no relevant content (write "Not discussed" rather than inventing detail)
- Add Chapters ONLY for long calls, per the STRUCTURE rule above; never force chapters onto a short or medium call
- In Action Items: Use @ before FULL NAMES for participants in the call (e.g., @Mayank Bansal)
- In Action Items: For people NOT in the participant list, write their name plainly with "(not in channel)" notation

**CITATIONS:**
- Each transcript line may start with a segment number such as "[12] [03:24] Alice: ...".
- After a specific claim, decision, action item, number, date, name, or quote, append the supporting token [clf-N].
- Copy N exactly from the transcript. Never invent segment numbers or add a separate citations section.

Only output valid Markdown (paragraphs and bullet lists only — no tables).
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
**Participants**: [All participants mentioned]
**Primary Focus**: [1-2 sentence summary of the main purpose]
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
- **Blockers**: [Any blockers identified]
- **Next Meeting**: [If mentioned]`;

const PRODUCT_SYNC_FIELDS = `### 💡 Key Takeaways
- [Most important outcome]
- [Second most important]
- [Third if applicable]
---
### 🚀 Updates
- [What moved / shipped / progressed since last time]
- [Status on in-flight work — with specifics]
---
### 🚧 Blockers & Risks
- [What's stuck, why, and who owns unblocking it]
- [Risk raised and its potential impact]
---
### ❓ Open Questions
- [Unresolved question] — needs: [who should answer]
---
### ✅ Decisions
- [Decision] — Owner: [Person] ([why / context])
---
### 📋 Action Items
- [Task] — @[Assignee] · Due: [Date] · Priority: [H/M/L]`;

const CUSTOMER_DISCOVERY_FIELDS = `### 💰 Discovery Snapshot
**Company / Prospect**: [Company + who was on the call and their roles]
**Primary Focus**: [1-2 sentences: what they're trying to solve and why now]
**Deal Signal**: [Warm / Neutral / Cold — one line on why]
---
### 🎯 Their Context
- [Company, industry, size, roles on the call]
- [Current tools / setup relevant to what we sell]
- [What's driving this now — trigger event, mandate, pain]
---
### 🔥 Pain Points & Needs
- [Problem they explicitly named — quote where impactful]
- [Impact / cost of the problem, if they quantified it]
---
### ✅ Requirements & Must-Haves
- [Specific requirement, capability, or constraint they stated]
- [Integrations, compliance, timelines, or volumes — with figures]
---
### ⚠️ Objections & Concerns
- [Concern, hesitation, or blocker they raised]
- [Competitor or alternative they're weighing, if any]
---
### 💹 Buying Signals
**Budget**: [Anything on budget / pricing sensitivity, else "Not discussed"]
**Timeline**: [Their timeline / urgency, else "Not discussed"]
**Decision process**: [Who decides + next steps on their side, else "Not discussed"]
---
### ✅ Decisions
- [Decision or agreement reached] — Owner: [Person] ([why / context])
---
### 📋 Action Items
- [Follow-up task] — @[Assignee] · Due: [Date] · Priority: [H/M/L]
---
### 🔗 Next Steps
- **Agreed next step**: [What both sides committed to]
- **To send them**: [Anything we promised to share]
- **Next meeting**: [If mentioned]`;

const ONE_ON_ONE_FIELDS = `### 💡 Key Takeaways
- [Most important point from this 1:1]
- [Second most important]
- [Third if applicable]
---
### 🎯 Top of Mind
- [What's most pressing or important for them right now]
---
### 📈 Progress & Wins
- [Recent progress, wins, or things going well]
---
### 🚧 Challenges & Blockers
- [Obstacles, frustrations, or things slowing them down]
---
### 💬 Feedback & Growth
- **To them**: [Feedback given to the report, if any]
- **From them**: [Feedback / concerns they raised]
- **Development**: [Growth or career topics discussed]
---
### ✅ Decisions
- [Decision or agreement reached] — Owner: [Person] ([why / context])
---
### 📋 Action Items
- [Task] — @[Assignee] · Due: [Date] · Priority: [H/M/L]`;

const HIRING_FIELDS = `### 🧭 Candidate Snapshot
**Candidate**: [Name]
**Role**: [Role interviewed for]
**Recommendation**: [Strong hire / Hire / Lean hire / Lean no / No hire]
---
### 📋 Background
- [Relevant experience, current situation, notable history]
---
### 🧪 What We Assessed
- [Skill / competency / exercise covered] — [how they did, with specifics]
---
### ✅ Strengths
- [Clear strength, backed by something they said or did]
---
### ⚠️ Concerns / Gaps
- [Gap, weakness, or open concern — be specific, not vague]
---
### 🎯 Recommendation
[Hire / no-hire / lean, with the reasoning. Tie it to the evidence above.]
---
### 🔎 Suggested Follow-up Areas
- [What the next round should probe further]
---
### ✅ Decisions
- [Decision reached — e.g. advance / reject / hold] — Owner: [Person] ([why / context])
---
### 📋 Action Items
- [Task] — @[Assignee] · Due: [Date] · Priority: [H/M/L]`;

const STANDUP_FIELDS = `### 👤 Per-Person Updates
- **[Name]** — Yesterday: [done]; Today: [doing]; Blocked: [blocker or "none"]
---
### 🚧 Blockers Needing Help
- [Who is blocked] on [what] — can be unblocked by [who]
---
### ✅ Decisions
- [Any decision made during stand-up] — Owner: [Person] ([why / context])
---
### 📋 Action Items
- [Task] — @[Assignee] · Due: [Date] · Priority: [H/M/L]`;

const SPRINT_REVIEW_FIELDS = `### 💡 Key Takeaways
- [Most important outcome of the review]
- [Second most important]
- [Third if applicable]
---
### ✅ Shipped This Sprint
- [What was completed and demoed]
---
### ⏳ Not Completed
- [What didn't land, why, and whether it carries over]
---
### 💬 Demo Feedback
- [Reaction / requested change raised during a demo]
---
### ✅ Decisions
- [Decision] — Owner: [Person] ([why / context])
---
### 🎯 Next Sprint Focus
- [What the team is prioritizing next]
---
### 📋 Action Items
- [Task] — @[Assignee] · Due: [Date] · Priority: [H/M/L]`;

const CUSTOMER_FEEDBACK_FIELDS = `### 📌 Feedback Snapshot
**Customer**: [Who + company]
**Overall Sentiment**: [Positive / Neutral / Frustrated / At-risk]
**Summary**: [1-2 sentences on the core of their feedback]
---
### 🔥 Feedback & Pain Points
- [Problem / issue raised] — impact: [severity or impact, if stated]
---
### ✨ Feature Requests
- [What they explicitly asked for]
---
### 😀 Sentiment & Risk
- [Overall tone; any churn / escalation risk signals]
---
### 🎫 Suggested Follow-ups
- [What to raise as a ticket or action, and to which team]
---
### ✅ Decisions
- [Any decision reached] — Owner: [Person] ([why / context])
---
### 📋 Action Items
- [Task] — @[Assignee] · Due: [Date] · Priority: [H/M/L]`;

export const BUILTIN_RECORDING_SUMMARY_TEMPLATES = [
  {
    id: 'default',
    name: 'Default summary',
    icon: '⚡',
    fields: DEFAULT_RECORDING_SUMMARY_FIELDS,
    selectionCriteria: 'Use for general meetings that do not strongly match a specialized template.',
  },
  {
    id: 'product_sync',
    name: 'Product sync',
    icon: '🔁',
    fields: PRODUCT_SYNC_FIELDS,
    selectionCriteria: 'Internal product or engineering working sessions about progress, blockers, risks, and decisions.',
  },
  {
    id: 'customer_discovery',
    name: 'Customer: Discovery',
    icon: '💰',
    fields: CUSTOMER_DISCOVERY_FIELDS,
    selectionCriteria: 'Sales or discovery conversations with a prospect about needs, requirements, objections, budget, or buying process.',
  },
  {
    id: 'one_on_one',
    name: '1 to 1',
    icon: '👥',
    fields: ONE_ON_ONE_FIELDS,
    selectionCriteria: 'A manager and direct report discussing progress, challenges, feedback, growth, or priorities.',
  },
  {
    id: 'hiring',
    name: 'Hiring',
    icon: '💼',
    fields: HIRING_FIELDS,
    selectionCriteria: 'Candidate interview or hiring debrief assessing skills, strengths, concerns, and recommendation.',
  },
  {
    id: 'standup',
    name: 'Stand-Up',
    icon: '🧍',
    fields: STANDUP_FIELDS,
    selectionCriteria: 'A daily or recurring stand-up with per-person updates and blockers.',
  },
  {
    id: 'sprint_review',
    name: 'Sprint review',
    icon: '📈',
    fields: SPRINT_REVIEW_FIELDS,
    selectionCriteria: 'Sprint review or demo covering shipped work, incomplete work, feedback, and next-sprint focus.',
  },
  {
    id: 'customer_feedback',
    name: 'Customer feedback',
    icon: '🔄',
    fields: CUSTOMER_FEEDBACK_FIELDS,
    selectionCriteria: 'Customer feedback, support, or voice-of-customer conversation focused on pain points, feature requests, or risk.',
  },
] as const;

export type BuiltinRecordingSummaryTemplate = (typeof BUILTIN_RECORDING_SUMMARY_TEMPLATES)[number];
export type BuiltinRecordingSummaryTemplateId = BuiltinRecordingSummaryTemplate['id'];

export function getBuiltinRecordingSummaryTemplate(
  templateId: string,
): BuiltinRecordingSummaryTemplate | undefined {
  return BUILTIN_RECORDING_SUMMARY_TEMPLATES.find(template => template.id === templateId);
}
