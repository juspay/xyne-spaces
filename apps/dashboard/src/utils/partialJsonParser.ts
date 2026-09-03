import { logger, Event as LogEvent } from './logger';
/**
 * Partial JSON Parser for Streaming Content
 *
 * Parses incomplete JSON strings and extracts available fields.
 * Useful for real-time streaming where JSON data arrives incrementally.
 */

interface PartialSummarizerOutput {
  summary: string;
  keyPoints: Array<{
    point: string;
    citation?: {
      messageIndex: number;
      messageId: string;
      conversationId: string;
    };
  }>;
}

/**
 * Parse partial JSON content from a streaming response
 * Handles incomplete JSON and extracts whatever fields are available
 */
export function parsePartialSummarizerJSON(content: string): PartialSummarizerOutput | null {
  if (!content || !content.trim()) {
    return null;
  }

  const trimmed = content.trim();

  // Only attempt full JSON parse if the content looks complete (ends with closing brace)
  // This avoids expensive exception throwing on every partial chunk during streaming
  if (trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as PartialSummarizerOutput;
      return parsed;
    } catch {
      // JSON is incomplete despite ending with }, try to extract partial data
    }
  }

  const result: PartialSummarizerOutput = {
    summary: '',
    keyPoints: [],
  };

  try {
    // Extract summary using regex — closing quote is optional to handle partial/streaming JSON
    const summaryMatch = content.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
    if (summaryMatch && summaryMatch[1] !== undefined) {
      result.summary = summaryMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\`/g, '`')
        .replace(/\\\\/g, '\\');
    }

    // Extract keyPoints array
    const keyPointsMatch = content.match(/"keyPoints"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
    if (keyPointsMatch && keyPointsMatch[1]) {
      const keyPointsContent = keyPointsMatch[1];

      // Split by objects (look for }, pattern)
      const objectMatches = keyPointsContent.match(/\{[^}]*\}/g) || [];

      for (const objStr of objectMatches) {
        try {
          const keyPoint = JSON.parse(objStr) as PartialSummarizerOutput['keyPoints'][number];
          if (keyPoint.point) {
            result.keyPoints.push(keyPoint);
          }
        } catch {
          // Try to extract partial keypoint data
          const pointMatch = objStr.match(/"point"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (pointMatch && pointMatch[1]) {
            const point = pointMatch[1]
              .replace(/\\n/g, '\n')
              .replace(/\\"/g, '"')
              .replace(/\\`/g, '`')
              .replace(/\\\\/g, '\\');

            // Extract citation if available
            const citationMatch = objStr.match(/"citation"\s*:\s*\{([^}]*)\}/);
            let citation;

            if (citationMatch) {
              try {
                citation = JSON.parse(
                  `{${citationMatch[1]}}`,
                ) as PartialSummarizerOutput['keyPoints'][number]['citation'];
              } catch {
                // Partial citation - extract what we can
                const messageIndexMatch = objStr.match(/"messageIndex"\s*:\s*(\d+)/);
                const messageIdMatch = objStr.match(/"messageId"\s*:\s*"([^"]*)"/);
                const conversationIdMatch = objStr.match(/"conversationId"\s*:\s*"([^"]*)"/);

                if (messageIndexMatch || messageIdMatch || conversationIdMatch) {
                  citation = {
                    messageIndex:
                      messageIndexMatch && messageIndexMatch[1]
                        ? parseInt(messageIndexMatch[1], 10)
                        : 0,
                    messageId: (messageIdMatch && messageIdMatch[1]) || '',
                    conversationId: (conversationIdMatch && conversationIdMatch[1]) || '',
                  };
                }
              }
            }

            if (citation) {
              result.keyPoints.push({ point, citation });
            } else {
              result.keyPoints.push({ point });
            }
          }
        }
      }

      // Also check for incomplete last object
      const incompleteMatch = keyPointsContent.match(/\{(?:[^}])*$/);
      if (incompleteMatch) {
        const objStr = incompleteMatch[0];
        const pointMatch = objStr.match(/"point"\s*:\s*"((?:[^"\\]|\\.)*)(?:")?/);
        if (pointMatch && pointMatch[1]) {
          const point = pointMatch[1]
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\`/g, '`')
            .replace(/\\\\/g, '\\');

          result.keyPoints.push({ point });
        }
      }
    }

    return result;
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('[PartialJSONParser] Error parsing partial JSON:'),
      error: error,
    });
    return null;
  }
}

/**
 * Extract raw text content from delta events (for display during streaming)
 */
export function extractStreamingText(content: string): string {
  if (!content || !content.trim()) {
    return '';
  }

  const trimmed = content.trim();

  // Only attempt full parse if JSON looks complete
  if (trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as { summary?: string };
      return parsed.summary || '';
    } catch {
      // Fall through to partial extraction
    }
  }

  // Extract summary text from incomplete JSON
  const summaryMatch = content.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
  if (summaryMatch && summaryMatch[1] !== undefined) {
    return summaryMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\`/g, '`')
      .replace(/\\\\/g, '\\');
  }
  return '';
}
