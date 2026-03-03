import { useCallback, useRef, useEffect, RefObject } from 'react';
import { BASE_URL } from '../services/clients/apiClient';
import { parsePartialSummarizerJSON } from '../utils/partialJsonParser';
import type {
  Message,
  MessageAttachment,
  SummarizerKeyPoint,
  SummarizerOutput,
  Participant,
  UserTag,
  SelectionContext,
} from '../components/Chat/XyneAISidebar/utils/XyneAITypes';
import {
  parseStreamingContent,
  transformToolOutput,
} from '../components/Chat/XyneAISidebar/utils/XyneAIUtils';
import { generateToolInputStatus } from '../components/Chat/XyneAISidebar/utils/toolInputStatus';
import type { ToolOutput as GeniusToolOutput } from 'cosmic-ai-genius';
import type { ResearchContext } from '@xyne/shared';

/**
 * Convert userTags to participants format
 * Transforms {tag: {name, userId}} to [{id, name, email, picture}]
 */
function convertUserTagsToParticipants(userTags?: Record<string, UserTag>): Participant[] {
  if (!userTags || Object.keys(userTags).length === 0) return [];

  return Object.values(userTags).map(userTag => ({
    id: userTag.userId,
    name: userTag.name,
    email: '', // Not available from userTags
    picture: '', // Will be handled by ParticipantsDropdown's getAvatarUrl helper
  }));
}

interface UseXyneAIStreamParams {
  channelIds: string[];
  conversationId: string;
  threadConversationId?: string | undefined;
  attachmentIds?: string[] | undefined; // Attachment IDs to fetch from GCS on backend
  canvasViewAccessId?: string | null;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setConversationId: React.Dispatch<React.SetStateAction<string>>;
  setCurrentTraceId?: React.Dispatch<React.SetStateAction<string | undefined>>;
  webSearchEnabled?: boolean;
  researchContext?: ResearchContext | null;
  createCanvasEnabled?: boolean;
}

// Helper function to clear status message from a message object
const clearStatusMessage = <T extends { statusMessage?: string }>(
  message: T,
): Omit<T, 'statusMessage'> => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { statusMessage, ...rest } = message;
  return rest;
};

// Canvas creation instruction appended when createCanvasEnabled is true
const CANVAS_CREATION_INSTRUCTION = `
<mandatory_final_step>
You MUST perform these steps after completing your analysis:

1. Call the <tool>create_canvas</tool> tool with:
   - title: A descriptive title for the document
   - markdown: Your complete response formatted in markdown with proper headings, sections, and structure

2. After the tool returns, you MUST include the canvas URL from the tool output in your response.
   The tool will return: "Canvas created successfully! Title: ... URL: https://spaces.xyne.juspay.net/chat/canvas/..."
   Extract and display this URL so the user can click on it.

This is MANDATORY - the user requires the output in a canvas document with a clickable link.
</mandatory_final_step>`;

export const useXyneAIStream = ({
  channelIds,
  conversationId,
  threadConversationId,
  attachmentIds,
  canvasViewAccessId,
  setMessages,
  setConversationId,
  setCurrentTraceId,
  webSearchEnabled = false,
  researchContext,
  createCanvasEnabled = false,
}: UseXyneAIStreamParams) => {
  const abortControllerRef = useRef<AbortController | null>(null);
  const participantsRef = useRef<Participant[]>([]);

  // Cleanup effect to abort ongoing requests on unmount
  useEffect(() => {
    return () => {
      // Cleanup on unmount - abort any ongoing requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const submitQuery = useCallback(
    async (
      query: string,
      attachments: MessageAttachment[] = [],
      selectionContexts?: SelectionContext[],
    ): Promise<void> => {
      // Allow empty query if there are selection contexts
      if (!query.trim() && (!selectionContexts || selectionContexts.length === 0)) return;

      // Build internal query with selection context format
      // Format: from canvas(canvas_view_access_id) ```selected_text```
      let internalQuery = query;
      if (selectionContexts && selectionContexts.length > 0) {
        const selectionFormatted = selectionContexts
          .map(
            ctx =>
              `\n\nfrom canvas(${ctx.canvasViewAccessId})\n\`\`\`\n${ctx.selectedText}\n\`\`\``,
          )
          .join('');
        internalQuery = query + selectionFormatted;
      }

      // Append canvas context hint for better accuracy when Ask AI is triggered from a canvas
      if (canvasViewAccessId) {
        const canvasContextHint = `\n\ncanvas view_access_id: ${canvasViewAccessId}`;
        internalQuery = internalQuery + canvasContextHint;
      }

      // Append hidden canvas instruction when create canvas is enabled
      // This forces the LLM to create a canvas with the output at the end
      if (createCanvasEnabled) {
        internalQuery = internalQuery + '\n\n' + CANVAS_CREATION_INSTRUCTION;
      }

      // Add user message (original query without internal formatting, but with selectionContexts for UI)
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        type: 'user',
        content: query,
        timestamp: new Date(),
        ...(attachments.length > 0 && { attachments }),
        ...(selectionContexts && selectionContexts.length > 0 && { selectionContexts }),
      };

      setMessages(prev => [...prev, userMessage]);

      // Create bot message with streaming state
      const botMessageId = `bot-${Date.now()}`;
      const botMessage: Message = {
        id: botMessageId,
        type: 'bot',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        streamingContent: '',
        parsedContent: { summary: '', keypoints: [], citations: {}, isComplete: false },
        messageIdMapping: {},
        conversationIdMapping: {},
        channelIdMapping: {},
        statusMessage: 'Thinking',
        participants: [],
      };

      // Reset refs
      participantsRef.current = [];

      setMessages(prev => [...prev, botMessage]);

      // Cancel any ongoing request
      if (abortControllerRef.current) abortControllerRef.current.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        // Format attachments for API
        const apiAttachments = attachments.map(att => ({
          data: att.data,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          mime_type: att.mimeType,
          filename: att.filename,
        }));

        // eslint-disable-next-line local-rules/no-fetch-use-axios
        const response = await fetch(`${BASE_URL}/xyne-ai`, {
          method: 'POST',
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          credentials: 'include',
          body: JSON.stringify({
            query: internalQuery,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            channel_ids: channelIds,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            conversation_id: threadConversationId || '',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            session_id: conversationId,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            web_search_enabled: webSearchEnabled,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            research_context: researchContext
              ? { type: researchContext.type, name: researchContext.name }
              : null,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            ...(canvasViewAccessId && { canvas_view_access_id: canvasViewAccessId }),
            ...(apiAttachments.length > 0 && { attachments: apiAttachments }),
            ...(attachmentIds &&
              attachmentIds.length > 0 && {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                message_attachment_ids: attachmentIds,
              }),
          }),
          signal: abortController.signal,
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('No response body');

        let buffer = '';
        let rawContent = '';
        const toolOutputs: GeniusToolOutput[] = [];

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
        while (true) {
          if (abortController.signal.aborted) {
            void reader.cancel();
            return;
          }

          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed: unknown = JSON.parse(line.slice(6));
                if (typeof parsed !== 'object' || parsed === null) continue;

                const data = parsed as Record<string, unknown>;

                processStreamEvent(
                  data,
                  botMessageId,
                  rawContent,
                  toolOutputs,
                  setMessages,
                  setConversationId,
                  setCurrentTraceId,
                  participantsRef,
                );

                // Update rawContent if there's new content
                if (data['type'] === 'delta' || data['type'] === 'content') {
                  if (data['content'] && typeof data['content'] === 'string') {
                    rawContent += data['content'];
                  }
                }
              } catch (err) {
                console.error('Failed to parse SSE event:', err);
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;

        console.error('[XyneAISidebar] Error fetching from Xyne AI:', err);
        setMessages(prev =>
          prev.map(msg =>
            msg.id === botMessageId
              ? {
                  ...msg,
                  content: 'Unexpected error occurred',
                  isStreaming: false,
                }
              : msg,
          ),
        );
      }
    },
    [
      channelIds,
      conversationId,
      threadConversationId,
      attachmentIds,
      canvasViewAccessId,
      researchContext,
      setMessages,
      setConversationId,
      setCurrentTraceId,
      webSearchEnabled,
      createCanvasEnabled,
    ],
  );

  const abortCurrentRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;

      // Update the streaming message to show it was aborted
      setMessages(prev =>
        prev.map(msg =>
          msg.isStreaming
            ? {
                ...msg,
                content: 'Query aborted by user.',
                isStreaming: false,
                isAborted: true,
                streamingContent: '',
              }
            : msg,
        ),
      );
    }
  }, [setMessages]);

  return {
    submitQuery,
    abortCurrentRequest,
  };
};

// Process individual stream events
function processStreamEvent(
  data: Record<string, unknown>,
  botMessageId: string,
  rawContent: string,
  toolOutputs: GeniusToolOutput[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setConversationId: React.Dispatch<React.SetStateAction<string>>,
  setCurrentTraceId?: React.Dispatch<React.SetStateAction<string | undefined>>,
  participantsRef?: RefObject<Participant[]>,
): void {
  switch (data['type']) {
    case 'start':
      if (data['sessionId'] && typeof data['sessionId'] === 'string') {
        console.log(
          '[XyneAISidebar] Received conversation ID from start event:',
          data['sessionId'],
        );
        setConversationId(data['sessionId']);
      }
      if (data['traceId'] && typeof data['traceId'] === 'string' && setCurrentTraceId) {
        console.log('[XyneAISidebar] Received traceId from start event:', data['traceId']);
        setCurrentTraceId(data['traceId']);
        // Store traceId with the current bot message
        setMessages(prev =>
          prev.map(msg =>
            msg.id === botMessageId && msg.type === 'bot'
              ? { ...msg, traceId: data['traceId'] as string }
              : msg,
          ),
        );
      }
      // Capture participants from start event
      if (data['participants'] && Array.isArray(data['participants']) && participantsRef) {
        participantsRef.current = data['participants'] as Participant[];
        setMessages(prev =>
          prev.map(msg =>
            msg.id === botMessageId ? { ...msg, participants: participantsRef.current } : msg,
          ),
        );
      }
      break;

    case 'delta':
    case 'content':
      if (data['content'] && typeof data['content'] === 'string') {
        setMessages(prev =>
          prev.map(msg => {
            if (msg.id !== botMessageId) return msg;

            // Only clear status message once we have substantial content (30+ chars)
            const shouldClearStatus = rawContent.length > 30;

            // For Summarizer, parse partial JSON in real-time
            if (msg.agentType === 'summarizer') {
              const partialOutput = parsePartialSummarizerJSON(rawContent);
              if (partialOutput) {
                if (shouldClearStatus) {
                  return {
                    ...clearStatusMessage(msg),
                    streamingContent: partialOutput.summary,
                    summarizerOutput: partialOutput,
                  };
                }
                return {
                  ...msg,
                  streamingContent: partialOutput.summary,
                  summarizerOutput: partialOutput,
                };
              }
              if (shouldClearStatus) {
                return {
                  ...clearStatusMessage(msg),
                  streamingContent: rawContent,
                };
              }
              return {
                ...msg,
                streamingContent: rawContent,
              };
            }

            // For Genius, parse the streaming content
            const parsed = parseStreamingContent(rawContent);
            if (shouldClearStatus) {
              return {
                ...clearStatusMessage(msg),
                streamingContent: parsed.summary,
                parsedContent: parsed,
              };
            }
            return {
              ...msg,
              streamingContent: parsed.summary,
              parsedContent: parsed,
            };
          }),
        );
      }
      break;

    case 'tool_input': {
      // Handle both 'toolName' and 'tool_name' (API sends both formats)
      const toolName = (data['toolName'] || data['tool_name']) as string | undefined;
      const toolInput = data['input'];

      if (toolName) {
        // Generate contextual status message
        const statusMessage = generateToolInputStatus(toolName, toolInput);

        setMessages(prev =>
          prev.map(msg =>
            msg.id === botMessageId
              ? {
                  ...msg,
                  toolName,
                  toolInput,
                  statusMessage,
                  ...(toolName === 'fetch_channel_messages' && {
                    agentType: 'summarizer' as const,
                  }),
                }
              : msg,
          ),
        );
      }
      break;
    }

    case 'tool_output':
      handleToolOutput(data, botMessageId, toolOutputs, setMessages);
      break;

    case 'complete':
    case 'done':
      handleCompletionEvent(
        data,
        botMessageId,
        rawContent,
        toolOutputs,
        setMessages,
        setConversationId,
        participantsRef,
      );
      break;

    case 'error':
      console.error('[XyneAISidebar] Backend error:', data['error']);
      setMessages(prev =>
        prev.map(msg =>
          msg.id === botMessageId
            ? {
                ...msg,
                content: 'Unexpected error occurred',
                isStreaming: false,
              }
            : msg,
        ),
      );
      break;

    case 'agent_update':
      if (data['message'] && typeof data['message'] === 'string') {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === botMessageId
              ? {
                  ...msg,
                  statusMessage: 'Running JAF agent',
                }
              : msg,
          ),
        );
      }
      break;

    case 'genius_start':
      if (data['toolName'] === 'genius') {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === botMessageId
              ? {
                  ...msg,
                  isGeniusResponse: true,
                }
              : msg,
          ),
        );
      }
      break;
  }
}

// Handle tool output events
function handleToolOutput(
  data: Record<string, unknown>,
  botMessageId: string,
  toolOutputs: GeniusToolOutput[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
): void {
  // Check for fetch_channel_messages tool
  const toolName = (data['toolName'] || data['tool_name']) as string | undefined;

  if (toolName === 'fetch_channel_messages') {
    const content = data['content'] as string;
    setMessages(prev =>
      prev.map(msg =>
        msg.id === botMessageId
          ? {
              ...msg,
              fetchedMessages: content,
              agentType: 'summarizer',
            }
          : msg,
      ),
    );
    return;
  }

  // Handle web_search tool - store it in toolOutputs for badge display
  if (toolName === 'web_search') {
    const content = data['content'] as string;

    // Create a minimal tool output entry for web_search
    const webSearchToolOutput: GeniusToolOutput = {
      id: `tool-websearch-${Date.now()}-${Math.random()}`,
      toolName: 'web_search',
      content: content,
    } as GeniusToolOutput;

    toolOutputs.push(webSearchToolOutput);

    setMessages(prev =>
      prev.map(msg =>
        msg.id === botMessageId
          ? {
              ...msg,
              toolOutputs: [...toolOutputs],
            }
          : msg,
      ),
    );
    return;
  }

  // Handle Genius tool outputs
  if (toolName) {
    const inputStr = data['input'] as string;
    const outputStr = data['output'] as string;

    let parsedInput: unknown = inputStr;
    let parsedOutput: unknown = outputStr;

    // Try to parse JSON strings
    try {
      if (typeof inputStr === 'string' && (inputStr.startsWith('{') || inputStr.startsWith('['))) {
        parsedInput = JSON.parse(inputStr);
      }
    } catch (e) {
      console.warn('Failed to parse tool input:', e);
    }

    try {
      if (
        typeof outputStr === 'string' &&
        (outputStr.startsWith('{') || outputStr.startsWith('['))
      ) {
        parsedOutput = JSON.parse(outputStr);
      }
    } catch (e) {
      console.warn('Failed to parse tool output:', e);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const transformedData = transformToolOutput(toolName, parsedInput, parsedOutput);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (Object.keys(transformedData).length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const newToolOutput: GeniusToolOutput = {
      id: `tool-${Date.now()}-${Math.random()}`,
      ...transformedData,
    } as GeniusToolOutput;

    toolOutputs.push(newToolOutput);

    setMessages(prev =>
      prev.map(msg =>
        msg.id === botMessageId
          ? {
              ...msg,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              toolOutputs: [...toolOutputs],
              agentType: 'genius',
            }
          : msg,
      ),
    );
  }
  // Legacy format support
  else if (data['toolOutput'] && typeof data['toolOutput'] === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const toolOutput = data['toolOutput'] as GeniusToolOutput;
    toolOutputs.push(toolOutput);

    setMessages(prev =>
      prev.map(msg =>
        msg.id === botMessageId
          ? {
              ...msg,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              toolOutputs: [...toolOutputs],
            }
          : msg,
      ),
    );
  }
}

// Handle completion events
function handleCompletionEvent(
  data: Record<string, unknown>,
  botMessageId: string,
  rawContent: string,
  toolOutputs: GeniusToolOutput[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setConversationId: React.Dispatch<React.SetStateAction<string>>,
  participantsRef?: React.RefObject<Participant[]>,
): void {
  if (data['sessionId'] && typeof data['sessionId'] === 'string') {
    console.log(
      '[XyneAISidebar] Received conversation ID from completion event:',
      data['sessionId'],
    );
    setConversationId(data['sessionId']);
  }

  const userTags = extractUserTags(data);

  // Extract participants from data (root level or nested in output)
  if (participantsRef) {
    const participants = extractParticipants(data);
    if (participants && participants.length > 0) {
      participantsRef.current = participants;
    } else {
      // If no participants array, try to convert from userTags
      if (userTags && Object.keys(userTags).length > 0) {
        participantsRef.current = convertUserTagsToParticipants(userTags);
      }
    }
  }

  // Check if this is a Summarizer response (both nested and at root level)
  const output = 'keyPoints' in data ? data : (data['output'] as Record<string, unknown> | null);

  if (output && 'keyPoints' in output && Array.isArray(output['keyPoints'])) {
    const summary = (output['summary'] as string) || '';
    const keyPoints = (output['keyPoints'] as unknown[]) || [];
    // Convert keyPoints to SummarizerOutput format if needed
    let summarizerOutput: SummarizerOutput;
    // Check if keyPoints are already in the correct format (with point and citation)
    if (
      keyPoints.length > 0 &&
      typeof keyPoints[0] === 'object' &&
      keyPoints[0] !== null &&
      'point' in keyPoints[0]
    ) {
      // Already in correct format
      summarizerOutput = {
        summary,
        keyPoints: keyPoints as SummarizerKeyPoint[],
      };
    } else {
      // Convert from string array to SummarizerKeyPoint format
      summarizerOutput = {
        summary,
        keyPoints: keyPoints.map((kp: unknown) => ({
          point: typeof kp === 'string' ? kp : JSON.stringify(kp),
        })),
      };
    }

    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== botMessageId) return msg;
        const { traceId } = msg; // Preserve traceId
        const updatedMsg: Message = {
          ...msg,
          content: summary,
          summarizerOutput,
          isStreaming: false,
          agentType: 'summarizer' as const,
          ...(userTags && { userTags }),
          ...(participantsRef &&
            participantsRef.current.length > 0 && { participants: participantsRef.current }),
        };
        if (traceId) updatedMsg.traceId = traceId;
        return updatedMsg;
      }),
    );
    return;
  }

  // Fallback: Check for legacy summarizer output format
  const summarizerOutput = extractSummarizerOutput(data);

  if (summarizerOutput) {
    // Summarizer complete event - preserve traceId
    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== botMessageId) return msg;
        const { traceId } = msg; // Preserve traceId
        const updatedMsg: Message = {
          ...msg,
          content: (summarizerOutput['summary'] as string) || '',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
          summarizerOutput: summarizerOutput as any,
          isStreaming: false,
          agentType: 'summarizer' as const,
          ...(userTags && { userTags }),
        };
        if (traceId) updatedMsg.traceId = traceId;
        return updatedMsg;
      }),
    );
    return;
  }

  // Genius response - use the streamed content as final content - preserve traceId
  const finalParsed = parseStreamingContent(rawContent);

  setMessages(prev =>
    prev.map(msg => {
      if (msg.id !== botMessageId) return msg;
      const { traceId } = msg; // Preserve traceId
      const updatedMsg: Message = {
        ...msg,
        content: finalParsed.summary,
        isStreaming: false,
        streamingContent: finalParsed.summary,
        parsedContent: finalParsed,
        ...(!msg.agentType && { agentType: 'genius' as const }),
        ...(toolOutputs.length > 0 && { toolOutputs }),
        ...(userTags && { userTags }),
      };
      if (traceId) updatedMsg.traceId = traceId;
      return updatedMsg;
    }),
  );
}
// Generic helper to extract a value from root level or nested in output object
function extractNestedValue<T>(data: Record<string, unknown>, key: string): T | undefined {
  return (data[key] ?? (data['output'] as Record<string, unknown> | undefined)?.[key]) as
    | T
    | undefined;
}

// Extract userTags from data (root level or nested in output)
const extractUserTags = (
  data: Record<string, unknown>,
): Record<string, { name: string; userId: string }> | undefined =>
  extractNestedValue<Record<string, { name: string; userId: string }>>(data, 'userTags');

// Extract participants from data (root level or nested in output)
const extractParticipants = (data: Record<string, unknown>): Participant[] | undefined => {
  const participants = extractNestedValue<unknown>(data, 'participants');
  return Array.isArray(participants) ? (participants as Participant[]) : undefined;
};

// Extract summarizer output from data (checks both root and nested in output)
const extractSummarizerOutput = (
  data: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const obj = 'keyPoints' in data ? data : (data['output'] as Record<string, unknown> | undefined);
  return obj && 'keyPoints' in obj && Array.isArray(obj['keyPoints']) ? obj : undefined;
};
