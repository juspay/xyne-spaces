/**
 * User Prompts for Issue Workflow
 * System prompts come from agent configs in database
 */

/**
 * Step 1: Repository Identification
 * Identifies which repository or repositories the issue belongs to
 */
export function buildStep1RepositoryIdentificationPrompt(
  description: string,
  ticketId: string
): string {
  return `# Task: Identify Repository/Repositories for Issue

You need to identify which repository or repositories contain the code related to this issue.

**Issue Description:**
${description}

**Ticket ID:** ${ticketId}

**Important Notes:**
- This system has MULTIPLE repositories across different domains
- An issue can affect ONE repository (single-repo) or MULTIPLE repositories (multi-repo)
- Common repositories include (but not limited to):
  - **api-gateway** - Payment gateway integrations
  - **api-txns** - Transaction processing
  - **api-customer** - Customer management
  - **api-order** - Order processing
  - **api-cards** - Card management
  - **api-dashboard** - Dashboard backend
  - **frontend** - Frontend applications
  - **shared** - Shared utilities and types
  - And many more...

**Your Task:**
1. Analyze the issue description carefully
2. Identify ALL repositories that might be affected
3. Determine if this is a single-repo or multi-repo issue
4. If multiple repos, identify the primary repository where the main fix should be

**Output Format (JSON):**
{
  "repositories": ["repository-name-1", "repository-name-2", ...],
  "primary_repository": "main-repository-name-if-multiple",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "Detailed explanation of why these repositories were identified",
  "affectedComponents": ["list", "of", "affected", "components"],
  "multiRepo": true | false
}

**Guidelines:**
- Look for clues about which parts of the system are affected
- Consider dependencies between services
- If the issue mentions shared types, utilities, or cross-cutting concerns, it might be multi-repo
- If the issue is isolated to one feature or service, it's likely single-repo
- List ALL repositories that need changes, not just the primary one
- Be specific about component names (file paths, service names, module names)
`;
}

/**
 * Step 2: Issue Analysis
 * Analyzes the issue to classify type, severity, and determine if code change is needed
 */
export function buildStep2IssueAnalysisPrompt(
  description: string,
  repositories: string[],
  multiRepo: boolean,
  affectedComponents: string[],
  ticketId: string
): string {
  return `# Task: Analyze Issue

Analyze this issue to understand its nature, severity, and whether it requires code changes.

**Issue Description:**
${description}

**Affected Repositories:** ${repositories.join(', ')}
**Multi-Repository Issue:** ${multiRepo ? 'Yes' : 'No'}
**Ticket ID:** ${ticketId}
**Affected Components:** ${affectedComponents.join(', ')}

**Your Task:**
1. Classify the issue type
2. Determine severity level
3. Identify root cause if possible
4. Suggest solution approach
5. Determine if code changes are required
6. Estimate complexity

**Output Format (JSON):**
{
  "issueType": "bug" | "feature_request" | "improvement" | "question" | "other",
  "severity": "critical" | "high" | "medium" | "low",
  "affectedComponents": ["refined", "list", "of", "components"],
  "rootCause": "Explanation of what's causing the issue (if identifiable)",
  "suggestedSolution": "High-level solution approach",
  "requiresCodeChange": true | false,
  "estimatedComplexity": "simple" | "moderate" | "complex"
}

**Guidelines:**
- **Issue Types:**
  - bug: Something is broken or not working as expected
  - feature_request: Request for new functionality
  - improvement: Enhancement to existing functionality
  - question: Clarification or information request
  - other: Doesn't fit other categories

- **Severity Levels:**
  - critical: System down, data loss, security issue
  - high: Major functionality broken, affecting many users
  - medium: Moderate impact, workaround available
  - low: Minor issue, cosmetic, nice-to-have

- **Code Change Required:**
  - true: Issue can be resolved by modifying code
  - false: Requires investigation, configuration change, or manual intervention

- **Complexity:**
  - simple: Single file change, straightforward fix
  - moderate: Multiple files, moderate logic changes
  - complex: Significant refactoring, architectural changes
`;
}

/**
 * Step 3: Code Analysis
 * Performs code analysis and suggests fixes (only if requiresCodeChange is true)
 */
export function buildStep3CodeAnalysisPrompt(
  description: string,
  repositories: string[],
  multiRepo: boolean,
  issueType: string,
  severity: string,
  affectedComponents: string[],
  rootCause: string | undefined,
  suggestedSolution: string | undefined,
  ticketId: string
): string {
  return `# Task: Code Analysis and Fix Suggestion

Analyze the codebase and suggest a fix for this issue.

**Issue Description:**
${description}

**Affected Repositories:** ${repositories.join(', ')}
**Multi-Repository Issue:** ${multiRepo ? 'Yes' : 'No'}
**Issue Type:** ${issueType}
**Severity:** ${severity}
**Affected Components:** ${affectedComponents.join(', ')}
${rootCause ? `**Root Cause:** ${rootCause}` : ''}
${suggestedSolution ? `**Suggested Solution:** ${suggestedSolution}` : ''}

**Ticket ID:** ${ticketId}

**Your Task:**
1. Identify the specific files and functions that need to be modified
2. Analyze the current implementation
3. Suggest code changes to fix the issue
4. Provide clear change descriptions
5. If multi-repo, organize changes by repository

**Output Format (JSON):**
{
  "analysis_summary": "Brief summary of the code analysis",
  "is_fixable": true | false,
  "affected_files": [
    {
      "repository": "repository-name",
      "file_path": "path/to/file",
      "function_name": "functionName (if applicable)",
      "line_numbers": "line range (if known)",
      "issue_description": "What's wrong in this file"
    }
  ],
  "suggested_fix": {
    "type": "code_change" | "configuration" | "documentation" | "investigation_needed",
    "description": "Detailed description of the fix",
    "code_changes": [
      {
        "repository": "repository-name",
        "file": "path/to/file",
        "change_description": "Description of changes needed in this file"
      }
    ]
  },
  "requires_investigation": false,
  "investigation_steps": []
}

**Guidelines:**
- Be specific about which files need to be changed
- For multi-repo issues, clearly indicate which repository each file belongs to
- Provide clear descriptions of what changes are needed in each repository
- If the issue requires investigation first, set requires_investigation to true
- Include investigation steps if further analysis is needed
- Set is_fixable to false if the issue cannot be fixed through code changes
- For fixable issues, provide detailed change descriptions per repository
- Consider dependencies and execution order if changes span multiple repos
`;
}
