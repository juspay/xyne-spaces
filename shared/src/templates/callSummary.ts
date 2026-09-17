export const SUMMARY_PROMPT_MAX_LENGTH = 20000;

export const DEFAULT_SUMMARY_FIELDS = `### 💡 Key Takeaways
1. [Most important outcome]
2. [Second most important]
3. [Third if applicable]

---

### 📋 Action Items
| # | Task | Assignee | Due | Priority |
|---|------|----------|-----|----------|
| 1 | [Task] | [Person] | [Date] | [H/M/L] |

---

### Call Overview
**Estimated Duration**: [Short/Medium/Long based on transcript length]
**Participants**: [List all participants mentioned; keep the "{HOST}" marker immediately after the name of the person who created the call]
**Primary Focus**: [1-2 sentence summary of main purpose]

---

### 📍 Call Phases

#### Phase 1: [Phase Title - e.g., "Opening & Context Setting"]
**Summary**: [2-3 sentence summary of this phase]

**Key Points**:
- [Point 1]
- [Point 2]

**Notable Mentions**:
- [Specific names, numbers, dates, or quotes mentioned]

---

#### Phase 2: [Phase Title - e.g., "Main Discussion"]
**Summary**: [2-3 sentence summary]

**Key Points**:
- [Point 1]
- [Point 2]

**Decisions/Outcomes** (if any):
- [Decision made in this phase]

---

#### Phase 3: [Phase Title - e.g., "Wrap-up & Next Steps"]
**Summary**: [2-3 sentence summary]

**Commitments**:
- [Who agreed to do what]

---

### 📋 Consolidated Outcomes

#### Decisions Made
| # | Decision | Owner | Context |
|---|----------|-------|---------|
| 1 | [Decision] | [Person] | [Why/Context] |

#### Open Items
- [ ] [Unresolved question or parked topic]

---

### 🔗 Follow-up
- **Next Meeting**: [If mentioned]
- **Blockers**: [Any blockers identified]`;
