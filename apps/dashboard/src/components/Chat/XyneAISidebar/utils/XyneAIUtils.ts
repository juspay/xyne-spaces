import type {
  ToolOutput as GeniusToolOutput,
  MetricConfig,
  GroupbyConfig,
} from '../../../../types/toolOutput';
import type { Message, StoredMessage, StreamingParsedContent } from './XyneAITypes';

export function normalizeLoadedMessagesForDisplay(
  messages: Array<Message | StoredMessage>,
): Message[] {
  return messages.map(msg => {
    const toolOutputs = msg.toolOutputs;
    if (
      msg.type === 'bot' &&
      msg.isStreaming &&
      (!msg.content || msg.content.trim().length === 0) &&
      (!toolOutputs || toolOutputs.length === 0)
    ) {
      return {
        ...msg,
        isStreaming: false,
        isAborted: true,
        content: 'Answer was aborted. Please try asking your question again.',
      };
    }

    return { ...msg, isStreaming: false };
  });
}

// Helper to determine metric type from key name
export function getMetricTypeFromKey(key: string): MetricConfig['metric_type'] {
  const keyLower = key.toLowerCase();

  if (
    keyLower.includes('rate') ||
    keyLower.includes('percentage') ||
    keyLower.includes('percent')
  ) {
    return 'Rate';
  }
  if (keyLower.includes('latency') || keyLower.includes('time') || keyLower.includes('duration')) {
    return 'Latency';
  }
  if (keyLower.includes('amount') || keyLower.includes('revenue') || keyLower.includes('price')) {
    return 'Amount';
  }
  if (
    keyLower.includes('volume') ||
    keyLower.includes('count') ||
    keyLower.includes('total') ||
    keyLower.includes('transaction') ||
    keyLower.includes('order') ||
    keyLower.includes('number') ||
    keyLower.includes('quantity')
  ) {
    return 'Volume';
  }
  return 'Count';
}

// Helper to check if column is a dimension (string or specific keywords)
export function isDimensionColumn(key: string, value: unknown): boolean {
  if (typeof value === 'string') return true;

  const keyLower = key.toLowerCase();
  return (
    keyLower.includes('gateway') ||
    keyLower.includes('payment_method') ||
    keyLower.includes('dimension') ||
    keyLower.includes('group') ||
    keyLower.includes('category') ||
    keyLower.includes('payment_gateway')
  );
}

// Transform API tool output to SDK-compatible format with intelligent component selection
export function transformToolOutput(
  toolName: string,
  _input: unknown,
  output: unknown,
): Partial<GeniusToolOutput> {
  const result: Partial<GeniusToolOutput> = {};

  // Handle q_api tool output
  if (toolName === 'q_api') {
    if (!Array.isArray(output) || output.length === 0) {
      return result;
    }

    const data = output as Array<Record<string, string | number>>;
    const firstItem = data[0];
    if (!firstItem) {
      return result;
    }

    const keys = Object.keys(firstItem);

    // 1. Check for time column (contains '_time')
    const timeColumn = keys.find(key => key.toLowerCase().includes('_time'));

    if (timeColumn) {
      // TIME-SERIES CHART
      const dimensionColumns: string[] = [];
      const metricColumns: string[] = [];

      keys.forEach(key => {
        if (key === timeColumn) return;

        if (isDimensionColumn(key, firstItem[key])) {
          dimensionColumns.push(key);
        } else if (typeof firstItem[key] === 'number') {
          metricColumns.push(key);
        }
      });

      // Create chart data
      result.rawChartData = data;
      result.groupbyConfig = {
        groupbyKeys: dimensionColumns,
        timeColumn: timeColumn,
        metricColumns: metricColumns,
        cardinality: 'TOP_5',
        showCardinality: true,
      } as GroupbyConfig;

      // Create metric config for primary metric
      if (metricColumns.length > 0 && metricColumns[0]) {
        const primaryMetric = metricColumns[0];
        result.selectedMetrics = {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          metric_name_db: primaryMetric,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          metric_label: primaryMetric.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          // eslint-disable-next-line @typescript-eslint/naming-convention
          metric_type: getMetricTypeFromKey(primaryMetric),
        } as MetricConfig;
      }

      return result;
    }

    // 2. Check for single stat (length === 1)
    if (data.length === 1) {
      result.singleStat = data as unknown as { metric: string; value: string | number };
      return result;
    }

    // 3. Check for bar chart (exactly 2 columns: 1 dimension + 1 metric)
    if (keys.length === 2) {
      const dimensionKey = keys.find(key => isDimensionColumn(key, firstItem[key]));
      const metricKey = keys.find(key => typeof firstItem[key] === 'number');

      if (dimensionKey && metricKey) {
        const metricType = getMetricTypeFromKey(metricKey);

        // Check if it's a volume metric
        if (metricType === 'Volume') {
          result.volumeChartData = {
            rawData: data,
            groupKey: dimensionKey,
            selectedMetrics: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              metric_name_db: metricKey,
              // eslint-disable-next-line @typescript-eslint/naming-convention
              metric_label: metricKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              // eslint-disable-next-line @typescript-eslint/naming-convention
              metric_type: metricType,
            } as MetricConfig,
            defaultChartType: 'bar' as const,
            showToggle: true,
          };
        } else {
          result.barChartData = {
            rawData: data,
            groupKey: dimensionKey,
            selectedMetrics: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              metric_name_db: metricKey,
              // eslint-disable-next-line @typescript-eslint/naming-convention
              metric_label: metricKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              // eslint-disable-next-line @typescript-eslint/naming-convention
              metric_type: metricType,
            } as MetricConfig,
            isHorizontalBar: true,
          };
        }

        return result;
      }
    }

    // 4. Fallback to table
    result.tableData = data;
    return result;
  }
  // Handle info tool output
  else if (toolName === 'info') {
    // Info output is metadata - skip displaying it entirely
    return {};
  }

  // Handle create_ppt tool output — pass through the structured slide data for preview
  if (toolName === 'create_ppt') {
    if (output && typeof output === 'object') {
      return { pptData: output } as Partial<GeniusToolOutput> & { pptData: unknown };
    }
    return {};
  }

  return result;
}

export function parseStreamingContent(content: string): StreamingParsedContent {
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/<think>[\s\S]*/gi, '');

  const isJsonEnvelope =
    /^\s*(?:```json)?\s*\{/.test(cleaned) ||
    cleaned.includes('"summary"') ||
    cleaned.includes('"keypoints"');
  if (isJsonEnvelope) {
    cleaned = cleaned.replace(/```json\s*/gi, '');
    cleaned = cleaned.replace(/```\s*/gi, '');
  }
  cleaned = cleaned.trim();

  let summary = '';
  const keypoints: string[] = [];
  let citations: Record<number, number> = {};

  // Try to detect format: JSON vs plain text/markdown
  // Also detect early JSON by checking if content starts with '{' to avoid showing raw JSON fragments
  const isJsonFormat =
    cleaned.startsWith('{') || cleaned.includes('"summary"') || cleaned.includes('"keypoints"');

  if (isJsonFormat) {
    // JSON format parsing (legacy)
    const summaryMatch = cleaned.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
    if (summaryMatch && summaryMatch[1] !== undefined) {
      summary = summaryMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\`/g, '`')
        .replace(/\\\\/g, '\\');
    }

    const keypointsMatch = cleaned.match(/"keypoints"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
    if (keypointsMatch && keypointsMatch[1]) {
      const keypointsStr = keypointsMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\`/g, '`')
        .replace(/\\\\/g, '\\');

      const points = keypointsStr
        .split('\n')
        .map(p => p.replace(/^[•\-*]\s*/, '').trim())
        .filter(p => p.length > 0);

      keypoints.push(...points);
    }

    const citationsMatch = cleaned.match(/"citations"\s*:\s*\{([^}]*)\}/);
    if (citationsMatch && citationsMatch[1]) {
      try {
        const citationsStr = `{${citationsMatch[1]}}`;
        citations = JSON.parse(citationsStr) as Record<number, number>;
      } catch {
        const citationContent = citationsMatch[1];
        const pairMatches = citationContent.matchAll(/(\d+)\s*:\s*(\d+)/g);
        for (const match of pairMatches) {
          if (match[1] && match[2]) {
            citations[parseInt(match[1], 10)] = parseInt(match[2], 10);
          }
        }
      }
    }
  } else {
    // Plain text/markdown format
    // Split on keypoints header (case insensitive)
    const keypointsHeaderMatch = cleaned.match(/\*\*key\s*points?\*\*:/i);

    if (keypointsHeaderMatch) {
      const splitIndex = keypointsHeaderMatch.index || 0;
      summary = cleaned.slice(0, splitIndex).trim();

      // Extract keypoints after the header
      const keypointsSection = cleaned.slice(splitIndex);
      const lines = keypointsSection.split('\n');

      for (const line of lines) {
        const trimmedLine = line.trim();
        // Match lines starting with bullet points (•, -, *)
        if (/^[•\-*]\s+/.test(trimmedLine)) {
          const point = trimmedLine.replace(/^[•\-*]\s+/, '').trim();
          if (point.length > 0) {
            keypoints.push(point);
          }
        }
      }
    } else {
      // No keypoints section yet, everything is summary
      summary = cleaned;
    }
  }

  const isComplete = isJsonFormat
    ? cleaned.includes('"citations"') && cleaned.includes('}')
    : cleaned.toLowerCase().includes('keypoints') && keypoints.length > 0;

  return { summary, keypoints, citations, isComplete };
}

// ============================================================================
// Tree Branching Helpers
// ============================================================================

export const BRANCH_ROOT_KEY = '__root__';

/**
 * Walk the message tree from root, picking the selected branch at each fork.
 * Returns the active path of messages to display.
 */
export function resolveActivePath<T extends { id: string; parentId?: string | null }>(
  allMessages: T[],
  branchSelections: Record<string, string>,
): T[] {
  if (allMessages.length === 0) return [];

  // Legacy conversations: no message has parentId set — return as-is, no branching
  if (allMessages.every(m => m.parentId === null || m.parentId === undefined)) return allMessages;

  // Build children map: parentId → children (sorted by creation order / array index)
  const childrenMap = new Map<string, T[]>();
  for (const msg of allMessages) {
    const key = msg.parentId ?? BRANCH_ROOT_KEY;
    const children = childrenMap.get(key);
    if (children) {
      children.push(msg);
    } else {
      childrenMap.set(key, [msg]);
    }
  }

  const path: T[] = [];
  const visitedIds = new Set<string>();
  let currentKey: string = BRANCH_ROOT_KEY;

  for (let step = 0; step < allMessages.length; step += 1) {
    const children = childrenMap.get(currentKey);
    if (!children || children.length === 0) break;

    // Pick selected child, or default to the last one (most recent)
    const parentId = currentKey;
    const selectedId = branchSelections[parentId];
    const selected = selectedId
      ? (children.find(c => c.id === selectedId) ?? children[children.length - 1]!)
      : children[children.length - 1]!;

    if (visitedIds.has(selected.id)) break;

    path.push(selected);
    visitedIds.add(selected.id);
    currentKey = selected.id;
  }

  return path;
}

/**
 * Get siblings (messages sharing the same parentId) and the current message's index.
 */
export function getSiblings<T extends { id: string; parentId?: string | null }>(
  allMessages: T[],
  messageId: string,
): { siblings: T[]; currentIndex: number } {
  const message = allMessages.find(m => m.id === messageId);
  if (!message) return { siblings: [], currentIndex: -1 };

  const parentKey = message.parentId ?? null;
  const siblings = allMessages.filter(m => (m.parentId ?? null) === parentKey);
  const currentIndex = siblings.findIndex(m => m.id === messageId);

  return { siblings, currentIndex };
}
