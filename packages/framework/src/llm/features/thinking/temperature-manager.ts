import type { Message } from '../../core/types/messages.js';
import type { ToolDefinition } from '../../core/types/tools.js';
import { logger } from '../../../utils/logger.js';

/**
 * Task types for automatic temperature optimization
 */
export type TaskType = 
  | 'coding' 
  | 'creative' 
  | 'factual' 
  | 'conversational' 
  | 'analytical' 
  | 'tool_calling' 
  | 'thinking' 
  | 'unknown';

/**
 * Temperature configuration for different task types
 */
export interface TemperatureConfig {
  readonly coding: number;
  readonly creative: number;
  readonly factual: number;
  readonly conversational: number;
  readonly analytical: number;
  readonly toolCalling: number;
  readonly thinking: number;
  readonly default: number;
}

/**
 * Task detection result with confidence score
 */
export interface TaskDetectionResult {
  readonly taskType: TaskType;
  readonly confidence: number;
  readonly reasoning?: string;
  readonly suggestedTemperature: number;
  readonly enableThinking?: boolean;
}

/**
 * Advanced temperature management with task type detection
 * Automatically optimizes temperature based on conversation content and context
 */
export class TemperatureManager {
  private temperatureConfig: TemperatureConfig;

  // Keywords for task type detection
  private readonly TASK_KEYWORDS = {
    coding: [
      'code', 'function', 'class', 'method', 'programming', 'algorithm', 
      'debug', 'compile', 'syntax', 'variable', 'array', 'object',
      'typescript', 'javascript', 'python', 'java', 'c++', 'rust',
      'implementation', 'refactor', 'optimize', 'performance'
    ],
    creative: [
      'creative', 'story', 'poem', 'narrative', 'character', 'plot',
      'imagine', 'brainstorm', 'artistic', 'design', 'innovative',
      'original', 'unique', 'fantasy', 'fiction', 'writing'
    ],
    factual: [
      'what is', 'define', 'explain', 'facts', 'information', 'research',
      'data', 'statistics', 'evidence', 'documentation', 'reference',
      'knowledge', 'learn', 'understand', 'clarify', 'details'
    ],
    conversational: [
      'hello', 'hi', 'how are you', 'thanks', 'please', 'sorry',
      'chat', 'talk', 'discuss', 'conversation', 'opinion',
      'feel', 'think', 'believe', 'personal', 'casual'
    ],
    analytical: [
      'analyze', 'compare', 'evaluate', 'assessment', 'review',
      'critical', 'reasoning', 'logic', 'argument', 'evidence',
      'conclusion', 'systematic', 'methodology', 'framework',
      'strategy', 'planning', 'decision', 'optimization'
    ]
  } as const;

  // Patterns that suggest thinking mode should be enabled
  private readonly THINKING_PATTERNS = [
    /let me think/i,
    /step by step/i,
    /break.*down/i,
    /complex.*problem/i,
    /reasoning/i,
    /analyze.*deeply/i,
    /careful.*consideration/i,
    /multiple.*approaches/i,
    /pros.*cons/i,
    /thorough.*analysis/i
  ];

  constructor(config?: Partial<TemperatureConfig>) {
    this.temperatureConfig = {
      coding: 0.2,
      creative: 0.8,
      factual: 0.3,
      conversational: 0.7,
      analytical: 0.4,
      toolCalling: 0.2,
      thinking: 0.1,
      default: 0.7,
      ...config
    };

    logger.debug('Temperature manager initialized', {
      config: this.temperatureConfig
    });
  }

  /**
   * Detect task type and suggest optimal temperature
   */
  public detectTaskAndTemperature(
    messages: readonly Message[],
    tools?: readonly ToolDefinition[],
    features?: {
      readonly thinkingMode?: boolean;
    }
  ): TaskDetectionResult {
    // Tool calling takes precedence
    if (tools && tools.length > 0) {
      return {
        taskType: 'tool_calling',
        confidence: 1.0,
        reasoning: 'Tools provided - using precision temperature for tool calling',
        suggestedTemperature: this.temperatureConfig.toolCalling,
        enableThinking: false
      };
    }

    // Thinking mode takes precedence
    if (features?.thinkingMode) {
      return {
        taskType: 'thinking',
        confidence: 1.0,
        reasoning: 'Thinking mode enabled - using low temperature for focused reasoning',
        suggestedTemperature: this.temperatureConfig.thinking,
        enableThinking: true
      };
    }

    // Analyze message content
    const content = this.extractTextContent(messages);
    const taskDetection = this.analyzeContentForTask(content);
    const thinkingDetection = this.shouldEnableThinking(content);

    return {
      ...taskDetection,
      enableThinking: thinkingDetection.shouldEnable,
      reasoning: `${taskDetection.reasoning}${thinkingDetection.shouldEnable ? ' | Thinking mode suggested based on content complexity' : ''}`
    };
  }

  /**
   * Get optimal temperature for a specific task type
   */
  public getTemperatureForTask(taskType: TaskType): number {
    switch (taskType) {
      case 'coding':
        return this.temperatureConfig.coding;
      case 'creative':
        return this.temperatureConfig.creative;
      case 'factual':
        return this.temperatureConfig.factual;
      case 'conversational':
        return this.temperatureConfig.conversational;
      case 'analytical':
        return this.temperatureConfig.analytical;
      case 'tool_calling':
        return this.temperatureConfig.toolCalling;
      case 'thinking':
        return this.temperatureConfig.thinking;
      default:
        return this.temperatureConfig.default;
    }
  }

  /**
   * Update temperature configuration
   */
  public updateConfig(updates: Partial<TemperatureConfig>): void {
    // Create new config with proper type safety
    this.temperatureConfig = {
      ...this.temperatureConfig,
      ...updates
    };
    logger.debug('Temperature configuration updated', { updates });
  }

  /**
   * Get current temperature configuration
   */
  public getConfig(): TemperatureConfig {
    return { ...this.temperatureConfig };
  }

  /**
   * Extract text content from messages for analysis
   */
  private extractTextContent(messages: readonly Message[]): string {
    return messages
      .filter(m => m.type === 'user' || m.type === 'assistant')
      .map(m => m.content)
      .join(' ')
      .toLowerCase();
  }

  /**
   * Analyze content to determine task type
   */
  private analyzeContentForTask(content: string): {
    taskType: TaskType;
    confidence: number;
    reasoning: string;
    suggestedTemperature: number;
  } {
    const scores: Record<TaskType, number> = {
      coding: 0,
      creative: 0,
      factual: 0,
      conversational: 0,
      analytical: 0,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      tool_calling: 0,
      thinking: 0,
      unknown: 0
    };

    // Score each task type based on keyword presence
    for (const [taskType, keywords] of Object.entries(this.TASK_KEYWORDS)) {
      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          scores[taskType as keyof typeof scores] += 1;
        }
      }
    }

    // Apply context-based scoring adjustments
    this.applyContextualScoring(content, scores);

    // Find the highest scoring task type
    const topTask = Object.entries(scores).reduce((max, [task, score]) => {
      return score > max.score ? { task: task as TaskType, score } : max;
    }, { task: 'unknown' as TaskType, score: 0 });

    // Calculate confidence based on score distribution
    const totalScore = Object.values(scores).reduce((sum, score) => sum + score, 0);
    const confidence = totalScore > 0 ? topTask.score / totalScore : 0;

    // If confidence is too low, default to conversational
    if (confidence < 0.3 || topTask.task === 'unknown') {
      return {
        taskType: 'conversational',
        confidence: 0.5,
        reasoning: 'Low confidence in task detection - defaulting to conversational temperature',
        suggestedTemperature: this.temperatureConfig.conversational
      };
    }

    return {
      taskType: topTask.task,
      confidence,
      reasoning: `Detected ${topTask.task} task (confidence: ${(confidence * 100).toFixed(1)}%)`,
      suggestedTemperature: this.getTemperatureForTask(topTask.task)
    };
  }

  /**
   * Apply contextual scoring based on content patterns
   */
  private applyContextualScoring(
    content: string, 
    scores: Record<TaskType, number>
  ): void {
    // Boost coding score for code-like patterns
    if (/\{|\}|\(|\)|;|import|export|function|const|let|var/.test(content)) {
      scores.coding += 2;
    }

    // Boost creative score for emotional or imaginative language
    if (/beautiful|amazing|wonderful|imagine|dream|feel|emotion/.test(content)) {
      scores.creative += 1;
    }

    // Boost factual score for question patterns
    if (/\?|what|how|when|where|why|who/.test(content)) {
      scores.factual += 1;
    }

    // Boost analytical score for comparative language
    if (/compare|versus|better|worse|pros|cons|advantage|disadvantage/.test(content)) {
      scores.analytical += 1;
    }

    // Reduce all scores if content is very short (likely conversational)
    if (content.length < 50) {
      Object.keys(scores).forEach(key => {
        if (key !== 'conversational') {
          scores[key as TaskType] *= 0.5;
        }
      });
    }
  }

  /**
   * Determine if thinking mode should be enabled based on content
   */
  private shouldEnableThinking(content: string): {
    shouldEnable: boolean;
    confidence: number;
  } {
    let score = 0;
    const maxScore = this.THINKING_PATTERNS.length;

    // Check for thinking-related patterns
    for (const pattern of this.THINKING_PATTERNS) {
      if (pattern.test(content)) {
        score += 1;
      }
    }

    // Additional indicators for complex reasoning
    const complexityIndicators = [
      content.length > 200, // Long queries often need thinking
      (content.match(/\?/g) || []).length > 1, // Multiple questions
      /complex|difficult|challenging|sophisticated/.test(content),
      /multiple.*option|several.*choice|various.*approach/.test(content)
    ];

    score += complexityIndicators.filter(Boolean).length;

    const confidence = Math.min(score / (maxScore + complexityIndicators.length), 1);
    const shouldEnable = confidence > 0.3;

    logger.debug('Thinking mode analysis', {
      content: content.substring(0, 100) + '...',
      score,
      confidence,
      shouldEnable
    });

    return { shouldEnable, confidence };
  }

  /**
   * Get temperature recommendations for common scenarios
   */
  public getScenarioRecommendations(): Record<string, { temperature: number; reasoning: string }> {
    return {
      codeGeneration: {
        temperature: this.temperatureConfig.coding,
        reasoning: 'Low temperature for precise, syntactically correct code'
      },
      creativeWriting: {
        temperature: this.temperatureConfig.creative,
        reasoning: 'High temperature for diverse, imaginative content'
      },
      technicalDocumentation: {
        temperature: this.temperatureConfig.factual,
        reasoning: 'Low-medium temperature for accurate, clear explanations'
      },
      casualConversation: {
        temperature: this.temperatureConfig.conversational,
        reasoning: 'Medium-high temperature for natural, engaging dialogue'
      },
      dataAnalysis: {
        temperature: this.temperatureConfig.analytical,
        reasoning: 'Medium temperature for systematic, logical analysis'
      },
      toolUsage: {
        temperature: this.temperatureConfig.toolCalling,
        reasoning: 'Very low temperature for precise tool parameter generation'
      },
      complexReasoning: {
        temperature: this.temperatureConfig.thinking,
        reasoning: 'Very low temperature for focused, step-by-step reasoning'
      }
    };
  }
}

/**
 * Create a temperature manager with default configuration
 */
export function createTemperatureManager(config?: Partial<TemperatureConfig>): TemperatureManager {
  return new TemperatureManager(config);
}

/**
 * Quick temperature detection for simple use cases
 */
export function detectOptimalTemperature(
  messages: readonly Message[],
  tools?: readonly ToolDefinition[],
  features?: { readonly thinkingMode?: boolean }
): number {
  const manager = createTemperatureManager();
  const result = manager.detectTaskAndTemperature(messages, tools, features);
  return result.suggestedTemperature;
}