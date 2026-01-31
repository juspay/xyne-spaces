// Knowledge base learning generator using agentic framework

import { Agent, type AgentConfig, createUserMessage, type Message, type ConversationResult } from '@framework'
import { LogLevel } from '@framework'
import type { GitInfo, GitDiffFile } from '../workflow-types'
import {logger} from '@/utils/logger';

// Learning types for categorizing captured knowledge
export type LearningType = 'file_purpose' | 'implementation_pattern' | 'gotcha' | 'debugging_tip'

// Structure for a single knowledge learning
export interface KnowledgeLearning {
  learningType: LearningType
  title: string
  content: string  // Markdown content describing the learning
  codeContext?: string  // JSON string with relevant code snippets
  filePaths?: string[]  // Related file paths
}

// Input data for knowledge generation
interface KnowledgeGenerationInput {
  checkpointName: string
  conversationResult: ConversationResult
  gitInfo: GitInfo
}

/**
 * Extracts file paths from git diff
 */
function extractFilePaths(gitDiff?: GitDiffFile[]): string[] {
  if (!gitDiff) return []
  return gitDiff.map(file => file.newPath || file.oldPath).filter(Boolean)
}

/**
 * Formats git diff for the prompt (simplified view)
 */
function formatGitDiffSummary(gitDiff?: GitDiffFile[]): string {
  if (!gitDiff || gitDiff.length === 0) {
    return 'No file changes detected.'
  }

  return gitDiff.map(file => {
    const type = file.type === 'add' ? '+ Added' : 
                 file.type === 'delete' ? '- Deleted' : 
                 file.type === 'rename' ? '↔ Renamed' : '~ Modified'
    const path = file.type === 'rename' ? `${file.oldPath} → ${file.newPath}` : file.newPath || file.oldPath
    const hunksPreview = file.hunks.slice(0, 2).map(h => 
      h.content.split('\n').slice(0, 10).join('\n')
    ).join('\n---\n')
    
    return `### ${type}: ${path}\n\`\`\`diff\n${hunksPreview}\n\`\`\``
  }).join('\n\n')
}

/**
 * Extracts conversation summary from ConversationResult
 */
function extractConversationSummary(result: ConversationResult): string {
  const messages = result.messages || []
  
  // Get the last few messages for context
  const relevantMessages = messages.slice(-6)
  
  return relevantMessages.map((msg: Message) => {
    if (msg.type === 'user') {
      return `**User:** ${typeof msg.content === 'string' ? msg.content.substring(0, 500) : '[complex content]'}`
    } else if (msg.type === 'assistant') {
      const content = msg.content || ''
      return `**Assistant:** ${content.substring(0, 500)}${content.length > 500 ? '...' : ''}`
    } else if (msg.type === 'tool_result') {
      const toolMsg = msg as { toolCallId?: string; content?: string }
      return `**Tool Result:** ${toolMsg.toolCallId || 'unknown'} - ${typeof toolMsg.content === 'string' ? toolMsg.content.substring(0, 200) : '[result]'}`
    }
    return ''
  }).filter(Boolean).join('\n\n')
}

/**
 * Generates knowledge learnings from agentic checkpoint completion data
 * @param input - The checkpoint name, conversation result, and git info
 * @returns Array of knowledge learnings extracted from the execution
 */
export async function generateKnowledgeLearnings(
  input: KnowledgeGenerationInput
): Promise<KnowledgeLearning[]> {
  const { checkpointName, conversationResult, gitInfo } = input
  
  try {
    // Create agent configuration for knowledge extraction
    const agentConfig: AgentConfig = {
      model: {
        provider: {
          type: 'litellm',
          config: {
            apiKey: process.env.LITELLM_API_KEY || '',
            baseUrl: process.env.LITELLM_BASE_URL || '',
            timeout: 600000, // 10 minutes
            retries: 3
          }
        },
        defaultModel: 'glm-46-fp8'
      },
      tools: {
        enabled: [], // No tools needed for knowledge extraction
        config: {},
        execution: {
          timeout: 60000
        }
      },
      execution: {
        maxTurns: 1, // Single turn for knowledge extraction
        mode: 'continuous',
        timeouts: {
          turn: 120000,
          tool: 60000
        },
        limits: {
          toolsPerTurn: 1
        },
        errorHandling: {
          continueOnToolError: false,
          maxRetries: 1
        }
      },
      events: {
        logging: LogLevel.ERROR
      }
    }

    // Create the agent
    const agent = Agent.create(agentConfig)

    // Prepare context for the prompt
    const filePaths = extractFilePaths(gitInfo.gitDiff)
    const diffSummary = formatGitDiffSummary(gitInfo.gitDiff)
    const conversationSummary = extractConversationSummary(conversationResult)

    // Create the prompt for knowledge extraction
    const prompt = `You are a senior software engineer creating a knowledge base from completed coding tasks. Extract valuable learnings that would help future developers working on this codebase.

## Checkpoint: ${checkpointName}

## Files Modified
${filePaths.length > 0 ? filePaths.map(f => `- ${f}`).join('\n') : 'No files modified'}

## Git Diff Summary
${diffSummary}

## Conversation Context
${conversationSummary}

---

Based on this completed task, extract 2-5 knowledge learnings. Focus on:

1. **file_purpose** - What specific files do and their role in the codebase
2. **implementation_pattern** - Correct patterns, conventions, or approaches used
3. **gotcha** - Potential pitfalls, edge cases, or non-obvious behaviors
4. **debugging_tip** - How to debug or troubleshoot similar issues

Return your response as a JSON array with this exact structure:
\`\`\`json
[
  {
    "learningType": "file_purpose" | "implementation_pattern" | "gotcha" | "debugging_tip",
    "title": "Brief descriptive title (5-10 words)",
    "content": "Detailed explanation in markdown format. Include code examples if relevant.",
    "filePaths": ["array", "of", "related", "file", "paths"]
  }
]
\`\`\`

**Important:**
- Only include genuinely useful learnings, not obvious statements
- Be specific to this codebase, not generic advice
- Include file paths that are relevant to each learning
- Content should be actionable and help future developers
- Do NOT use emojis in the title or content fields
- Return ONLY the JSON array, no additional commentary`

    // Execute the agent
    const result = await agent.execute({
      messages: [createUserMessage(prompt)]
    })

    // Extract JSON from the response
    const assistantMessages = result.messages.filter(
      (msg: Message): msg is Extract<Message, { type: 'assistant' }> =>
        msg.type === 'assistant'
    )

    const lastMessage = assistantMessages.pop()
    if (!lastMessage?.content) {
      logger.warn(`No response from knowledge extraction for ${checkpointName}`)
      return []
    }

    // Parse the JSON response
    const jsonMatch = lastMessage.content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      logger.warn(`Could not find JSON array in knowledge extraction response for ${checkpointName}`)
      return []
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      learningType: string
      title: string
      content: string
      filePaths?: string[]
    }>

    // Validate and transform the response
    const validLearningTypes: LearningType[] = ['file_purpose', 'implementation_pattern', 'gotcha', 'debugging_tip']
    
    const learnings: KnowledgeLearning[] = parsed
      .filter(item => 
        validLearningTypes.includes(item.learningType as LearningType) &&
        typeof item.title === 'string' &&
        typeof item.content === 'string'
      )
      .map(item => ({
        learningType: item.learningType as LearningType,
        title: item.title,
        content: item.content,
        filePaths: Array.isArray(item.filePaths) ? item.filePaths : undefined
      }))

    logger.info(`[KnowledgeGenerator] Extracted ${learnings.length} learnings for checkpoint ${checkpointName}`)
    return learnings

  } catch (error) {
    logger.error(`Error generating knowledge for ${checkpointName}:`, error)
    return []
  }
}

// Input data for consolidated knowledge generation (multiple checkpoints)
interface ConsolidatedKnowledgeInput {
  checkpointId: string
  conversationResult: ConversationResult
  gitInfo: GitInfo
}

/**
 * Formats multiple checkpoint results into a unified summary for consolidated learning generation
 */
function formatConsolidatedCheckpointSummary(inputs: ConsolidatedKnowledgeInput[]): {
  checkpointsSummary: string
  allFilePaths: string[]
  combinedDiffSummary: string
  combinedConversationSummary: string
} {
  const allFilePaths: string[] = []
  const diffParts: string[] = []
  const conversationParts: string[] = []

  for (const input of inputs) {
    const { checkpointId, conversationResult, gitInfo } = input
    
    // Collect file paths
    const filePaths = extractFilePaths(gitInfo.gitDiff)
    allFilePaths.push(...filePaths)
    
    // Format diff for this checkpoint
    const diffSummary = formatGitDiffSummary(gitInfo.gitDiff)
    if (diffSummary !== 'No file changes detected.') {
      diffParts.push(`### Checkpoint: ${checkpointId}\n${diffSummary}`)
    }
    
    // Format conversation summary for this checkpoint
    const conversationSummary = extractConversationSummary(conversationResult)
    if (conversationSummary) {
      conversationParts.push(`### Checkpoint: ${checkpointId}\n${conversationSummary}`)
    }
  }

  // Deduplicate file paths
  const uniqueFilePaths = [...new Set(allFilePaths)]

  return {
    checkpointsSummary: inputs.map(i => `- ${i.checkpointId}`).join('\n'),
    allFilePaths: uniqueFilePaths,
    combinedDiffSummary: diffParts.length > 0 ? diffParts.join('\n\n---\n\n') : 'No file changes detected.',
    combinedConversationSummary: conversationParts.length > 0 ? conversationParts.join('\n\n---\n\n') : 'No conversation context available.'
  }
}

/**
 * Generates consolidated knowledge learnings from multiple agentic checkpoint results
 * Called at workflow completion to create a single unified set of learnings
 * 
 * @param inputs - Array of checkpoint data (checkpointId, conversationResult, gitInfo)
 * @returns Array of knowledge learnings extracted from all checkpoints combined
 */
export async function generateConsolidatedKnowledgeLearnings(
  inputs: ConsolidatedKnowledgeInput[]
): Promise<KnowledgeLearning[]> {
  if (inputs.length === 0) {
    logger.info('[KnowledgeGenerator] No checkpoint data provided for consolidated learning generation')
    return []
  }

  logger.info(`💡 [KnowledgeGenerator] Generating consolidated learnings from ${inputs.length} checkpoints`)

  try {
    // Create agent configuration for knowledge extraction
    const agentConfig: AgentConfig = {
      model: {
        provider: {
          type: 'litellm',
          config: {
            apiKey: process.env.LITELLM_API_KEY || '',
            baseUrl: process.env.LITELLM_BASE_URL || '',
            timeout: 600000, // 10 minutes
            retries: 3
          }
        },
        defaultModel: 'glm-46-fp8'
      },
      tools: {
        enabled: [], // No tools needed for knowledge extraction
        config: {},
        execution: {
          timeout: 60000
        }
      },
      execution: {
        maxTurns: 1, // Single turn for knowledge extraction
        mode: 'continuous',
        timeouts: {
          turn: 180000, // 3 minutes for larger consolidated context
          tool: 60000
        },
        limits: {
          toolsPerTurn: 1
        },
        errorHandling: {
          continueOnToolError: false,
          maxRetries: 1
        }
      },
      events: {
        logging: LogLevel.ERROR
      }
    }

    // Create the agent
    const agent = Agent.create(agentConfig)

    // Prepare consolidated context for the prompt
    const {
      checkpointsSummary,
      allFilePaths,
      combinedDiffSummary,
      combinedConversationSummary
    } = formatConsolidatedCheckpointSummary(inputs)

    // Create the prompt for consolidated knowledge extraction
    const prompt = `You are a senior software engineer creating a knowledge base from a completed workflow with multiple coding phases. Extract valuable learnings that would help future developers working on this codebase.

## Workflow Phases Completed
${checkpointsSummary}

## All Files Modified
${allFilePaths.length > 0 ? allFilePaths.map(f => `- ${f}`).join('\n') : 'No files modified'}

## Git Diff Summary (All Phases)
${combinedDiffSummary}

## Conversation Context (All Phases)
${combinedConversationSummary}

---

Based on this completed workflow, extract 3-7 knowledge learnings that capture the most important insights across ALL phases. Focus on:

1. **file_purpose** - What specific files do and their role in the codebase
2. **implementation_pattern** - Correct patterns, conventions, or approaches used
3. **gotcha** - Potential pitfalls, edge cases, or non-obvious behaviors
4. **debugging_tip** - How to debug or troubleshoot similar issues

Return your response as a JSON array with this exact structure:
\`\`\`json
[
  {
    "learningType": "file_purpose" | "implementation_pattern" | "gotcha" | "debugging_tip",
    "title": "Brief descriptive title (5-10 words)",
    "content": "Detailed explanation in markdown format. Include code examples if relevant.",
    "filePaths": ["array", "of", "related", "file", "paths"]
  }
]
\`\`\`

**Important:**
- Consolidate related learnings across phases into single comprehensive entries
- Only include genuinely useful learnings, not obvious statements
- Be specific to this codebase, not generic advice
- Include file paths that are relevant to each learning
- Content should be actionable and help future developers
- Do NOT use emojis in the title or content fields
- Return ONLY the JSON array, no additional commentary`

    // Execute the agent
    const result = await agent.execute({
      messages: [createUserMessage(prompt)]
    })

    // Extract JSON from the response
    const assistantMessages = result.messages.filter(
      (msg: Message): msg is Extract<Message, { type: 'assistant' }> =>
        msg.type === 'assistant'
    )

    const lastMessage = assistantMessages.pop()
    if (!lastMessage?.content) {
      logger.warn('[KnowledgeGenerator] No response from consolidated knowledge extraction')
      return []
    }

    // Parse the JSON response
    const jsonMatch = lastMessage.content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      logger.warn('[KnowledgeGenerator] Could not find JSON array in consolidated knowledge extraction response')
      return []
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      learningType: string
      title: string
      content: string
      filePaths?: string[]
    }>

    // Validate and transform the response
    const validLearningTypes: LearningType[] = ['file_purpose', 'implementation_pattern', 'gotcha', 'debugging_tip']
    
    const learnings: KnowledgeLearning[] = parsed
      .filter(item => 
        validLearningTypes.includes(item.learningType as LearningType) &&
        typeof item.title === 'string' &&
        typeof item.content === 'string'
      )
      .map(item => ({
        learningType: item.learningType as LearningType,
        title: item.title,
        content: item.content,
        filePaths: Array.isArray(item.filePaths) ? item.filePaths : undefined
      }))

    logger.info(`✅ [KnowledgeGenerator] Extracted ${learnings.length} consolidated learnings from ${inputs.length} checkpoints`)
    return learnings

  } catch (error) {
    logger.error('[KnowledgeGenerator] Error generating consolidated knowledge:', error)
    return []
  }
}
