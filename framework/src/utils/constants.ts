/**
 * Framework constants
 */

export const TOOL_REGISTRY_SYMBOL = Symbol('ToolRegistry');
export const TOOL_METADATA_SYMBOL = Symbol('ToolMetadata');

export const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
export const MAX_INPUT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_OUTPUT_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export const SUPPORTED_ENCODINGS = [
  'utf8',
  'ascii',
  'utf16le',
  'base64',
  'latin1',
  'hex'
] as const;

export type SupportedEncoding = typeof SUPPORTED_ENCODINGS[number];


export const COMPACTING_SYSTEM_PROMPT = `
Your task is to now create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the conversation and supporting any continuing tasks.
    What you should include in the summary:
  1. Context: (required) The context to continue the conversation with.
  2. Previous Conversation: High level details about what was discussed throughout the entire conversation with the user. This should be written to allow someone to be able to follow the general overarching conversation flow.
  3. Current Work: Describe in detail what was being worked on prior to this request to compact the context window. Pay special attention to the more recent messages / conversation.
  4. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for continuing with this work.
  5. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  6. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  7. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.
  8. Original User Query: Include the original user query that initiated this conversation, as it provides essential context for understanding the user's intent and goals.
  9. Important User Queries: Include any user queries that are critical to understanding the context and next steps.
  10. User-Approved Plan: Include any user-approved plan for which work is currently being done, and mention the status of each part of the plan.
  11. Completed Edits and File Creations: Include all edits and file creations that have been made so far. Explain the reason for each edit or file creation based on the current work context.

    Note: 
    1. **The summary should be comprehensive and detailed, capturing all relevant technical aspects and conversation flow to ensure seamless continuation of the work. It should be structured in a way that allows easy reference to specific points discussed, with an emphasis on clarity and completeness.**
    2. **The summary should be text-only and should not be wrapped in any tool call.**
`;

/**
 * System prompt snippet injected when questioning/planning mode is enabled.
 * Instructs the LLM to use the `ask_question` tool for ambiguities.
 */
export const ASK_QUESTION_SYSTEM_PROMPT = `\n\n⚠️ IMPORTANT: You have a \`ask_question\` tool available. You MUST use it whenever you encounter ambiguity during your analysis — unclear requirements, multiple valid implementation approaches, scope questions, design trade-offs, or edge cases.\n\nYou can ask questions at ANY point during your work. Whenever you realize something is unclear or could go multiple ways, stop and use the \`ask_question\` tool before proceeding further.\n\nBatch related questions into a single \`ask_question\` tool call. Use the built-in \`ask_question\` tool ONLY — do NOT ask questions in plain text or markdown.`;