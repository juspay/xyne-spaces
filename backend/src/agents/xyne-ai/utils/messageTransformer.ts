/**
 * Message Transformation: Backend WorkflowSteps → Frontend StoredMessage format
 *
 * Backend stores: USER, TOOL_INPUT, TOOL_OUTPUT, ASSISTANT as separate WorkflowStep rows.
 * Frontend expects: user messages and bot messages, with tool outputs embedded in bot messages
 * and already shaped for the cosmic-ai-genius SDK (rawChartData, tableData, etc.).
 */

import { randomUUID } from 'crypto';
import type { MessageData } from '../storage/customPostgresProvider.js';
import type { XyneAIOutput, KeyPointWithCitation } from '../types.js';

// ============================================================================
// Frontend Message Type
// ============================================================================

export interface FrontendMessage {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: string;
  parentId?: string | null;
  feedback?: 0 | 1 | 2;
  attachments?: Array<{ filename: string; mimeType: string; data: string }>;
  toolOutputs?: unknown[];
  parsedContent?: {
    summary: string;
    keypoints: string[];
    citations: Record<number, number>;
    isComplete: boolean;
  };
  messageIdMapping?: Record<string, string>;
  conversationIdMapping?: Record<string, string>;
  channelIdMapping?: Record<string, string>;
  userTags?: Record<string, { name: string; userId: string }>;
}

// ============================================================================
// Tool Output Transformation
// Mirrors the transformToolOutput logic in the frontend's XyneAIUtils.ts so the
// backend can send already-shaped data and avoid redundant computation on the client.
// ============================================================================

type MetricType = 'Rate' | 'Latency' | 'Amount' | 'Volume' | 'Count';

interface MetricConfig {
  metric_name_db: string;
  metric_label: string;
  metric_type: MetricType;
}

interface GroupbyConfig {
  groupbyKeys: string[];
  timeColumn: string;
  metricColumns: string[];
  cardinality: string;
  showCardinality: boolean;
}

// Mirrors the GeniusToolOutput shape from the cosmic-ai-genius SDK
interface TransformedToolOutput {
  id: string;
  type: 'tool_output';
  toolName: string;
  rawChartData?: Array<Record<string, string | number>>;
  groupbyConfig?: GroupbyConfig;
  selectedMetrics?: MetricConfig;
  singleStat?: Array<Record<string, string | number>>;
  volumeChartData?: {
    rawData: Array<Record<string, string | number>>;
    groupKey: string;
    selectedMetrics: MetricConfig;
    defaultChartType: 'bar';
    showToggle: boolean;
  };
  barChartData?: {
    rawData: Array<Record<string, string | number>>;
    groupKey: string;
    selectedMetrics: MetricConfig;
    isHorizontalBar: boolean;
  };
  tableData?: Array<Record<string, string | number>>;
  pptData?: {
    attachmentId: string;
    downloadUrl: string;
    filename: string;
    title: string;
    slideCount: number;
    slides: Array<{ index: number; background: unknown; objects: unknown[] }>;
  };
}

function getMetricTypeFromKey(key: string): MetricType {
  const k = key.toLowerCase();
  if (k.includes('rate') || k.includes('percentage') || k.includes('percent')) return 'Rate';
  if (k.includes('latency') || k.includes('time') || k.includes('duration')) return 'Latency';
  if (k.includes('amount') || k.includes('revenue') || k.includes('price')) return 'Amount';
  if (
    k.includes('volume') || k.includes('count') || k.includes('total') ||
    k.includes('transaction') || k.includes('order') || k.includes('number') ||
    k.includes('quantity')
  ) return 'Volume';
  return 'Count';
}

function isDimensionColumn(key: string, value: unknown): boolean {
  if (typeof value === 'string') return true;
  const k = key.toLowerCase();
  return (
    k.includes('gateway') || k.includes('payment_method') || k.includes('dimension') ||
    k.includes('group') || k.includes('category') || k.includes('payment_gateway')
  );
}

function transformQApiOutput(
  toolName: string,
  content: unknown,
): TransformedToolOutput | null {
  // q_api output may arrive as a JSON string (serialized by the stream event handler)
  let parsed = content;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  content = parsed;

  const data = content as Array<Record<string, string | number>>;
  const firstItem = data[0];
  if (!firstItem) return null;

  const keys = Object.keys(firstItem);
  const timeColumn = keys.find(key => key.toLowerCase().includes('_time'));
  const base = { id: `tool-${toolName}-${randomUUID()}`, type: 'tool_output' as const, toolName };

  if (timeColumn) {
    const dimensionColumns: string[] = [];
    const metricColumns: string[] = [];
    keys.forEach(key => {
      if (key === timeColumn) return;
      if (isDimensionColumn(key, firstItem[key])) dimensionColumns.push(key);
      else if (typeof firstItem[key] === 'number') metricColumns.push(key);
    });

    const primaryMetric = metricColumns[0];
    return {
      ...base,
      rawChartData: data,
      groupbyConfig: { groupbyKeys: dimensionColumns, timeColumn, metricColumns, cardinality: 'TOP_5', showCardinality: true },
      ...(primaryMetric && {
        selectedMetrics: {
          metric_name_db: primaryMetric,
          metric_label: primaryMetric.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          metric_type: getMetricTypeFromKey(primaryMetric),
        },
      }),
    };
  }

  if (data.length === 1) {
    return { ...base, singleStat: data };
  }

  if (keys.length === 2) {
    const dimensionKey = keys.find(key => isDimensionColumn(key, firstItem[key]));
    const metricKey = keys.find(key => typeof firstItem[key] === 'number');
    if (dimensionKey && metricKey) {
      const metricType = getMetricTypeFromKey(metricKey);
      const metricConfig: MetricConfig = {
        metric_name_db: metricKey,
        metric_label: metricKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        metric_type: metricType,
      };
      if (metricType === 'Volume') {
        return { ...base, volumeChartData: { rawData: data, groupKey: dimensionKey, selectedMetrics: metricConfig, defaultChartType: 'bar', showToggle: true } };
      }
      return { ...base, barChartData: { rawData: data, groupKey: dimensionKey, selectedMetrics: metricConfig, isHorizontalBar: true } };
    }
  }

  return { ...base, tableData: data };
}

/**
 * Transform a raw tool output into the GeniusToolOutput shape.
 * Returns null for tools that produce no visual output (e.g. 'info').
 */
function transformToolOutputContent(toolName: string, content: unknown): TransformedToolOutput | null {
  if (toolName === 'q_api') return transformQApiOutput(toolName, content);

  if (toolName === 'create_ppt') {
    let parsed = content;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { return null; }
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const base = { id: `tool-${toolName}-${randomUUID()}`, type: 'tool_output' as const, toolName };
    return { ...base, pptData: parsed as TransformedToolOutput['pptData'] };
  }

  return null; // all other tools produce no visual output
}

// ============================================================================
// Message Tree Helpers
// ============================================================================

/**
 * Walk backwards through previousStepId chain to find the nearest USER or ASSISTANT step.
 * Skips TOOL_INPUT/TOOL_OUTPUT steps to get the logical parent.
 */
export function findLogicalParent(step: MessageData, stepMap: Map<string, MessageData>): string | null {
  let currentId = step.previousStepId;
  while (currentId) {
    const parentStep = stepMap.get(currentId);
    if (!parentStep) break;
    if (parentStep.role === 'USER' || parentStep.role === 'ASSISTANT') return parentStep.messageId;
    currentId = parentStep.previousStepId;
  }
  return null;
}

/**
 * Collect TOOL_INPUT/TOOL_OUTPUT steps between an ASSISTANT step and its preceding USER step.
 * Tool outputs are pre-transformed into GeniusToolOutput shape; items producing no visual
 * output (e.g. 'info') are omitted.
 */
export function collectToolOutputsForAssistant(
  assistantStep: MessageData,
  stepMap: Map<string, MessageData>,
): unknown[] {
  const tools: { role: string; content: any }[] = [];
  let currentId = assistantStep.previousStepId;

  while (currentId) {
    const step = stepMap.get(currentId);
    if (!step) break;
    if (step.role === 'USER' || step.role === 'ASSISTANT') break;
    if (step.role === 'TOOL_INPUT' || step.role === 'TOOL_OUTPUT') {
      tools.unshift({ role: step.role, content: step.content });
    }
    currentId = step.previousStepId;
  }

  return tools.flatMap(t => {
    if (t.role === 'TOOL_INPUT') {
      return [{ type: 'tool_input', toolName: t.content?.toolName, input: t.content?.input } as unknown];
    }
    const transformed = transformToolOutputContent(t.content?.toolName as string, t.content?.content);
    return transformed ? [transformed as unknown] : [];
  });
}

/**
 * Collect TOOL_INPUT/TOOL_OUTPUT steps whose logical parent is a given USER step.
 * Used for aborted turns where no ASSISTANT step was written.
 */
export function collectToolOutputsForOrphanedUserStep(
  userStepId: string,
  steps: MessageData[],
  stepMap: Map<string, MessageData>,
): unknown[] {
  const toolSteps = steps
    .filter(s =>
      (s.role === 'TOOL_INPUT' || s.role === 'TOOL_OUTPUT') &&
      findLogicalParent(s, stepMap) === userStepId,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return toolSteps.flatMap(s => {
    const c = s.content as any;
    if (s.role === 'TOOL_INPUT') {
      return [{ type: 'tool_input', toolName: c?.toolName, input: c?.input } as unknown];
    }
    const transformed = transformToolOutputContent(c?.toolName as string, c?.content);
    return transformed ? [transformed as unknown] : [];
  });
}

/**
 * Build citation mappings from XyneAIOutput keyPoints for the frontend.
 */
export function buildCitationMappings(output: XyneAIOutput): {
  citations: Record<number, number>;
  messageIdMapping: Record<string, string>;
  conversationIdMapping: Record<string, string>;
  channelIdMapping: Record<string, string>;
} {
  const citations: Record<number, number> = {};
  const messageIdMapping: Record<string, string> = {};
  const conversationIdMapping: Record<string, string> = {};
  const channelIdMapping: Record<string, string> = {};

  if (!output.keyPoints) return { citations, messageIdMapping, conversationIdMapping, channelIdMapping };

  output.keyPoints.forEach((kp: KeyPointWithCitation, index: number) => {
    if (kp.citation) {
      citations[index] = kp.citation.messageIndex;
      messageIdMapping[String(kp.citation.messageIndex)] = kp.citation.messageId;
      conversationIdMapping[String(kp.citation.messageIndex)] = kp.citation.conversationId;
      if (kp.citation.channelId) channelIdMapping[String(kp.citation.messageIndex)] = kp.citation.channelId;
    }
  });

  return { citations, messageIdMapping, conversationIdMapping, channelIdMapping };
}

/**
 * Transform backend MessageData[] (WorkflowSteps) to frontend FrontendMessage format.
 * Tool outputs are pre-transformed into GeniusToolOutput-compatible shape.
 */
export function transformMessagesToFrontendFormat(steps: MessageData[]): FrontendMessage[] {
  const stepMap = new Map(steps.map(s => [s.messageId, s]));

  const respondedUserStepIds = new Set<string>();
  for (const step of steps) {
    if (step.role === 'ASSISTANT') {
      const parentId = findLogicalParent(step, stepMap);
      if (parentId) respondedUserStepIds.add(parentId);
    }
  }

  const messages: FrontendMessage[] = [];

  for (const step of steps) {
    if (step.role === 'USER') {
      const content = step.content as { query?: string; timestamp?: string } | null;
      const attachments = step.attachment?.map(a => ({
        filename: a.file_name,
        mimeType: a.mime_type,
        data: '', // Attachment data is in GCS, not returned in listing
      }));

      messages.push({
        id: step.messageId,
        type: 'user',
        content: content?.query || '',
        timestamp: step.createdAt.toISOString(),
        parentId: findLogicalParent(step, stepMap),
        ...(attachments && attachments.length > 0 && { attachments }),
      });

      if (!respondedUserStepIds.has(step.messageId)) {
        const partialToolOutputs = collectToolOutputsForOrphanedUserStep(step.messageId, steps, stepMap);
        messages.push({
          id: `aborted-${step.messageId}`,
          type: 'bot',
          content: 'Answer was aborted. Please try asking your question again.',
          timestamp: step.createdAt.toISOString(),
          parentId: step.messageId,
          toolOutputs: partialToolOutputs.length > 0 ? partialToolOutputs : undefined,
        });
      }
    } else if (step.role === 'ASSISTANT') {
      const output = step.content as XyneAIOutput | null;
      const toolOutputs = collectToolOutputsForAssistant(step, stepMap);
      const { citations, messageIdMapping, conversationIdMapping, channelIdMapping } =
        buildCitationMappings(output || { summary: '', keyPoints: [] });

      messages.push({
        id: step.messageId,
        type: 'bot',
        content: output?.summary || '',
        timestamp: step.createdAt.toISOString(),
        parentId: findLogicalParent(step, stepMap),
        toolOutputs: toolOutputs.length > 0 ? toolOutputs : undefined,
        parsedContent: {
          summary: output?.summary || '',
          keypoints: output?.keyPoints?.map((kp: KeyPointWithCitation) => kp.point) || [],
          citations,
          isComplete: true,
        },
        messageIdMapping: Object.keys(messageIdMapping).length > 0 ? messageIdMapping : undefined,
        conversationIdMapping: Object.keys(conversationIdMapping).length > 0 ? conversationIdMapping : undefined,
        channelIdMapping: Object.keys(channelIdMapping).length > 0 ? channelIdMapping : undefined,
        userTags: output?.userTags,
      });
    }
    // TOOL_INPUT and TOOL_OUTPUT steps are folded into their parent ASSISTANT (or aborted) message
  }

  return messages;
}

/**
 * Apply feedbackMap from session metadata to transformed messages.
 */
export function applyFeedbackToMessages(
  messages: FrontendMessage[],
  feedbackMap: Record<string, number>,
): FrontendMessage[] {
  if (Object.keys(feedbackMap).length === 0) return messages;
  return messages.map(msg => {
    const feedback = feedbackMap[msg.id];
    return feedback !== undefined ? { ...msg, feedback: feedback as 0 | 1 | 2 } : msg;
  });
}
