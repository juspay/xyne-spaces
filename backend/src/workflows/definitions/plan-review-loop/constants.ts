/**
 * Plan Review Loop Constants
 *
 * Separated from utils.ts to avoid circular dependency with config.ts
 */

export type TaskType = 'feature' | 'bug' | 'refactor' | 'performance' | 'security' | 'documentation';

// =============================================================================
// QUALITY GATES - Must be included in all agent outputs
// =============================================================================

/**
 * Quality gates that must be addressed in every plan and implementation
 * These apply based on task type (feature, bug, refactor, etc.)
 */
export const QUALITY_GATES = `
## MANDATORY QUALITY GATES

For this task, you MUST address ALL applicable quality gates in your output:

### 1. CODE REUSE
- What existing features/functions/variables/code can be reused?
- When to reuse vs create new? Why?
- Check: @xyne/shared, existing types, utilities, schemas, components

### 2. ARCHITECTURE & CODING STYLE
- Follow existing folder structure, naming conventions
- Match coding patterns used in the codebase

### 3. COMMENTS
- Add comments when making changes
- If comment already exists, APPEND to it. NEVER remove existing comments

### 4. SAME ISSUE ELSEWHERE
**Only for bug fixes** - For other tasks, state "N/A - Not a bug fix"
- How many OTHER places can trigger the EXACT same issue?
- NOT similar issues - list all places where THIS exact issue can happen
- Search codebase for the problematic pattern and list every occurrence

### 5. SOLUTION ANALYSIS
- 5a. CRASH RISK: Can this solution crash the system? What safeguards needed?
- 5b. PERFORMANCE: Is it performant? Any bottlenecks?
- 5c. BACKWARD COMPATIBLE: Will it break existing behavior? Migration needed?

### 6. SCALE DESIGN
- Assume 1000s of workflows running 24X7
- Resource cleanup, caching, memory leaks, concurrency

### 7. DESIGN PRINCIPLES
- Which are followed? SRP, DRY, YAGNI, KISS, etc.
- Trade-offs made

### 8. NEW APIS/COMPONENTS
- Are we introducing new APIs? New components?
- List them explicitly

### 9. FILE CHANGES SUMMARY
- Exact files to create/modify
- Count: X new files, Y modified files
- Format: \`backend/src/..., dashboard/src/...\`

### 10. EXISTING CODE/FOLDER STRUCTURE
- Did you follow the existing folder structure?
- Did you follow existing naming conventions?
- Did you use existing patterns or components?
- If you changed structure, what's the justification?

### 11. SUCCINCTNESS
- Is the solution concise?
- No unnecessary code/files/changes?
- Output is clear and to the point?

**OUTPUT FORMAT:** Your response MUST end with a markdown section:

\`\`\`markdown
## Quality Gates Section

### 1. Code Reuse
[What to reuse, why, specific files/components]

### 2. Architecture & Coding Style
[Patterns followed - folder structure, naming conventions]

### 3. Comments
[How comments handled - add/append strategy, never remove]

### 4. Same Issue Elsewhere
[If bug fix: Found X places with exact same issue - list each file:line]
[If feature: "N/A - Feature implementation"]

### 5a. Crash Risk
[What can crash the system, safeguards needed]

### 5b. Performance
[Bottlenecks identified, mitigations]

### 5c. Backward Compatible
[Breaking changes, migration path if any]

### 6. Scale Design
[Resource considerations for 1000s workflows 24X7]

### 7. Design Principles
[Which principles followed: SRP, DRY, YAGNI, KISS]

### 8. New APIs/Components
[List any new APIs or components being introduced]

### 9. File Changes
X new files, Y modified files:
- new: [list]
- modified: [list]

### 10. Existing Code/Folder Structure
[How existing patterns are followed - or changed with justification]

### 11. Succinctness
[How solution is concise - no unnecessary changes]
\`\`\`
`;
