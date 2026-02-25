import { FidoWorkType } from '../types';

export const createRequirementAnalysisTemplate = (workflowDescription?: string, type?: FidoWorkType) => {

  const finalDescription = type === FidoWorkType.DEEP ?
   `I want to generate requirememt in XML format for the following feature in very detail and specific to requested feature and SAVE IT TO A FILE \`generated-requirement-analysis.xml\:
  
# Feature Request

**Description:** ${workflowDescription}
` :

`# Feature Request

**Description:** ${workflowDescription}

# CRITICAL: PLAN OUTPUT REQUIREMENT

**YOUR FINAL RESPONSE MUST BE THE COMPLETE IMPLEMENTATION PLAN.**

Your final response should follow this exact format:

\`\`\`
# Implementation Plan

## 1. Feature Analysis
[What needs to be built and why]

## 2. Files to Create/Modify
[Exact file paths and what changes to make]

## 3. Implementation Steps
[Step-by-step implementation order]

## 4. Technical Details
[Specific code patterns, components to use, etc.]
\`\`\`

Remember: Output the COMPLETE plan as your final response. Do NOT use plan_mode_response tool.
`;

return finalDescription;
};

// Keep backward compatibility with the original static template
export const REQUIREMENT_ANALYSIS_TEMPLATE = createRequirementAnalysisTemplate();
