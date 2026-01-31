/**
 * Utility functions for AI agents
 */

import { z } from 'zod';

/**
 * Generic agent output parser with Zod validation
 *
 * This function:
 * 1. Removes <think>...</think> blocks (used by reasoning models)
 * 2. Extracts JSON content from the response
 * 3. Validates the output against a Zod schema
 *
 * @template T - The expected output type
 * @param content - Raw content string from the agent
 * @param schema - Zod schema to validate the output
 * @returns Parsed and validated output of type T
 * @throws Error if parsing or validation fails
 */
export function parseAgentOutput<T>(
  content: string,
  schema: z.ZodSchema<T>
): T {
  // Remove <think>...</think> blocks (used by some reasoning models)
  let jsonContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Try to find JSON object in the content
  const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonContent = jsonMatch[0];
  }

  try {
    // Parse JSON
    const parsed = JSON.parse(jsonContent);

    // Validate against Zod schema
    const validated = schema.parse(parsed);

    return validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Zod validation error
      const issues = error.issues.map(issue =>
        `${issue.path.join('.')}: ${issue.message}`
      ).join(', ');
      throw new Error(`Agent output validation failed: ${issues}`);
    } else if (error instanceof SyntaxError) {
      // JSON parsing error
      throw new Error(`Failed to parse agent output as JSON: ${error.message}`);
    } else {
      // Other errors
      throw new Error(
        `Failed to parse agent output: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
