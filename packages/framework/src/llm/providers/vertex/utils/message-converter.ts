import type { Message, ToolCall, Attachment } from '../../../core/types/messages.js';
import type { VertexContent, ClaudeVertexMessage } from '../schemas.js';
import { logger } from '../../../../utils/logger.js';
import {
  LLMErrorClass,
  createToolIntegrationError,
  createProviderValidationError
} from '../../../core/errors/index.js';

/**
 * File type support matrix for provider/model combinations
 */
const FILE_TYPE_SUPPORT = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'claude-sonnet-4@20250514': {
    images: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    documents: ['application/pdf']
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'gemini-2.5-pro': {
    images: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    videos: ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm'],
    audio: ['audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac'],
    documents: ['application/pdf']
  }
} as const;

/**
 * Check if file content is valid UTF-8 text
 */
function isValidTextContent(buffer: Buffer): boolean {
  try {
    const text = buffer.toString('utf-8');
    
    // Check for null bytes (strong indicator of binary content)
    if (text.includes('\0')) {
      return false;
    }
    
    // Check if most characters are printable or common whitespace
    let printableCount = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (
        (code >= 32 && code <= 126) ||  // ASCII printable
        code === 9 ||                   // tab
        code === 10 ||                  // line feed
        code === 13 ||                  // carriage return
        code > 127                      // Unicode characters
      ) {
        printableCount++;
      }
    }
    
    // If at least 95% of characters are printable, consider it text
    return printableCount / text.length >= 0.95;
  } catch {
    return false;
  }
}

/**
 * Convert file attachment to text content
 */
function convertAttachmentToText(attachment: Attachment): string {
  if (!attachment.data) {
    throw new Error('Attachment missing data for text conversion');
  }
  
  const buffer = Buffer.from(attachment.data, 'base64');
  const content = buffer.toString('utf-8');
  const fileName = attachment.name || 'unnamed_file';
  
  return `File: ${fileName}\n${'='.repeat(50)}\n${content}`;
}

/**
 * Check if attachment is supported by model
 */
function isAttachmentSupported(attachment: Attachment, modelName: string): boolean {
  const supportInfo = FILE_TYPE_SUPPORT[modelName as keyof typeof FILE_TYPE_SUPPORT];
  if (!supportInfo) return false;
  
  const mimeType = attachment.mimeType.toLowerCase();
  const allSupportedTypes: readonly string[] = [
    ...supportInfo.images,
    ...(('videos' in supportInfo) ? supportInfo.videos : []),
    ...(('audio' in supportInfo) ? supportInfo.audio : []),
    ...supportInfo.documents
  ];
  
  return allSupportedTypes.includes(mimeType);
}


// API response interfaces for type safety
interface VertexApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string | undefined;
        functionCall?: {
          name: string;
          args: Record<string, unknown>;
        } | undefined;
      }> | undefined;
    } | undefined;
    finishReason?: string | undefined;
  }> | undefined;
  usageMetadata?: {
    promptTokenCount?: number | undefined;
    candidatesTokenCount?: number | undefined;
    totalTokenCount?: number | undefined;
  } | undefined;
}

interface ClaudeApiResponse {
  content?: Array<{
    type?: string | undefined;
    text?: string | undefined;
    thinking?: string | undefined; // Claude 4 thinking content
    signature?: string | undefined; // Claude 4 thinking signature
    id?: string | undefined;
    name?: string | undefined;
    input?: Record<string, unknown> | undefined;
  }> | undefined;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  stop_reason?: string | undefined;
  usage?: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    input_tokens?: number | undefined;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    output_tokens?: number | undefined;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    thinking_tokens?: number | undefined; // Claude 4 thinking tokens
  } | undefined;
}



/**
 * Message conversion utilities for Vertex AI
 * Handles conversion between Common message format and Vertex-specific formats
 */

/**
 * Convert common messages to Vertex AI format (for Gemini models)
 */
export function convertToVertexFormat(messages: readonly Message[]): VertexContent[] {
  const vertexMessages: VertexContent[] = [];
  
  logger.debug('Converting messages to Vertex format', {
    messageCount: messages.length
  });

  for (const message of messages) {
    try {
      switch (message.type) {
        case 'user': {
          // Handle multimodal content with attachments for Gemini
          const parts: Array<{
            text?: string;
            inlineData?: {
              mimeType: string;
              data: string;
            };
          }> = [];

          // Add text content if present
          if (message.content) {
            parts.push({ text: message.content });
          }

          // Add attachments if present
          if (message.attachments && message.attachments.length > 0) {
            let textContent = '';
            
            for (const attachment of message.attachments) {
              if (!attachment.data) {
                logger.warn('Attachment missing data, skipping', {
                  attachmentId: attachment.id,
                  attachmentType: attachment.type
                });
                continue;
              }

              // Check if attachment is natively supported by Gemini
              if (isAttachmentSupported(attachment, 'gemini-2.5-pro')) {
                // Send as native attachment
                parts.push({
                  inlineData: {
                    mimeType: attachment.mimeType,
                    data: attachment.data
                  }
                });
              } else {
                // Try to convert to text if it's a text file
                const buffer = Buffer.from(attachment.data, 'base64');
                if (isValidTextContent(buffer)) {
                  textContent += '\n\n' + convertAttachmentToText(attachment);
                } else {
                  throw new LLMErrorClass(createProviderValidationError(
                    'vertex',
                    [`File type ${attachment.mimeType} is not supported by Gemini and cannot be converted to text`],
                    {
                      context: {
                        attachmentId: attachment.id,
                        fileName: attachment.name,
                        mimeType: attachment.mimeType
                      }
                    }
                  ));
                }
              }
            }
            
            // Add converted text content to the message
            if (textContent) {
              if (parts.length === 0) {
                parts.push({ text: textContent.trim() });
              } else {
                // Append to existing text or create new text part
                const textPart = parts.find(part => part.text !== undefined);
                if (textPart) {
                  textPart.text += textContent;
                } else {
                  parts.push({ text: textContent.trim() });
                }
              }
            }
          }

          vertexMessages.push({
            role: 'user',
            parts
          });
          break;
        }
          
        case 'assistant': {
          const assistantParts: Array<{
            text?: string;
            functionCall?: { name: string; args: Record<string, unknown> };
          }> = [];
          
          // Add main content
          if (message.content) {
            assistantParts.push({ text: message.content });
          }
          
          // Add tool calls as function calls
          if (message.toolCalls) {
            for (const toolCall of message.toolCalls) {
              assistantParts.push({
                functionCall: {
                  name: toolCall.name,
                  args: toolCall.arguments
                }
              });
            }
          }
          
          if (assistantParts.length > 0) {
            vertexMessages.push({
              role: 'model',
              parts: assistantParts
            });
          }
          break;
        }
          
        case 'tool_result':
          vertexMessages.push({
            role: 'function',
            parts: [{
              functionResponse: {
                name: message.toolCallId,
                response: {
                  success: message.success,
                  content: message.content,
                  ...(message.error && { error: message.error })
                }
              }
            }]
          });
          break;
          
        case 'system':
          // System messages are handled separately in Vertex AI
          logger.debug('System message skipped in conversion (handled separately)', {
            messageId: message.id
          });
          break;
          
        default:
          logger.warn('Unknown message type skipped', {
            messageType: message.type,
            messageId: message.id
          });
      }
    } catch (error) {
      throw new LLMErrorClass(createToolIntegrationError(
        `Failed to convert message to Vertex format: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'schema_conversion',
        {
          toolName: 'message-converter',
          context: { messageId: message.id, messageType: message.type }
        }
      ));
    }
  }

  logger.debug('Message conversion to Vertex format completed', {
    inputCount: messages.length,
    outputCount: vertexMessages.length
  });

  return vertexMessages;
}

/**
 * Convert common messages to Claude on Vertex format
 */
export function convertToClaudeVertexFormat(messages: readonly Message[]): ClaudeVertexMessage[] {
  const claudeMessages: ClaudeVertexMessage[] = [];
  
  logger.debug('Converting messages to Claude Vertex format', {
    messageCount: messages.length
  });

  for (const message of messages) {
    try {
      switch (message.type) {
        case 'user': {
          // Handle multimodal content with attachments
          const contentParts: Array<{
            type: 'text' | 'image' | 'document';
            text?: string;
            source?: {
              type: 'base64';
              // eslint-disable-next-line @typescript-eslint/naming-convention
              media_type: string;
              data: string;
            };
          }> = [];

          // Add text content if present
          if (message.content) {
            contentParts.push({
              type: 'text',
              text: message.content
            });
          }

          // Add attachments if present
          if (message.attachments && message.attachments.length > 0) {
            let textContent = '';
            
            for (const attachment of message.attachments) {
              if (!attachment.data) {
                logger.warn('Attachment missing data, skipping', {
                  attachmentId: attachment.id,
                  attachmentType: attachment.type
                });
                continue;
              }

              // Check if attachment is natively supported by Claude
              if (isAttachmentSupported(attachment, 'claude-sonnet-4@20250514')) {
                // Determine content type based on attachment type and MIME type
                let contentType: 'image' | 'document';
                
                if (attachment.type === 'image') {
                  contentType = 'image';
                } else {
                  // All non-image attachments (file, audio, video) are treated as documents
                  contentType = 'document';
                }

                contentParts.push({
                  type: contentType,
                  source: {
                    type: 'base64',
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    media_type: attachment.mimeType,
                    data: attachment.data
                  }
                });
              } else {
                // Try to convert to text if it's a text file
                const buffer = Buffer.from(attachment.data, 'base64');
                if (isValidTextContent(buffer)) {
                  textContent += '\n\n' + convertAttachmentToText(attachment);
                } else {
                  throw new LLMErrorClass(createProviderValidationError(
                    'vertex',
                    [`File type ${attachment.mimeType} is not supported by Claude and cannot be converted to text`],
                    {
                      context: {
                        attachmentId: attachment.id,
                        fileName: attachment.name,
                        mimeType: attachment.mimeType
                      }
                    }
                  ));
                }
              }
            }
            
            // Add converted text content to the message
            if (textContent) {
              if (contentParts.length === 0) {
                contentParts.push({
                  type: 'text',
                  text: textContent.trim()
                });
              } else {
                // Append to existing text or create new text part
                const textPart = contentParts.find(part => part.type === 'text');
                if (textPart && textPart.text) {
                  textPart.text += textContent;
                } else {
                  contentParts.push({
                    type: 'text',
                    text: textContent.trim()
                  });
                }
              }
            }
          }

          // Always use array format for consistent multimodal support
          claudeMessages.push({
            role: 'user',
            content: contentParts
          });
          break;
        }
          
        case 'assistant': {
          const content: Array<{
            type: 'text' | 'tool_use' | 'thinking';
            text?: string;
            thinking?: string;
            signature?: string;
            id?: string;
            name?: string;
            input?: Record<string, unknown>;
          }> = [];
          
          // Add thinking block first if present (required for thinking mode)
          if (message.thinking) {
            content.push({
              type: 'thinking',
              thinking: message.thinking,
              signature: message.thinkingSignature || 'claude-assistant' // Use actual signature or fallback
            });
          }
          
          // Add main content if present
          if (message.content) {
            content.push({
              type: 'text',
              text: message.content
            });
          }
          
          // Add tool calls
          if (message.toolCalls) {
            for (const toolCall of message.toolCalls) {
              content.push({
                type: 'tool_use',
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.arguments
              });
            }
          }
          
          if (content.length > 0) {
            claudeMessages.push({
              role: 'assistant',
              content
            });
          }
          break;
        }
          
        case 'tool_result':
          claudeMessages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              // eslint-disable-next-line @typescript-eslint/naming-convention
              tool_use_id: message.toolCallId,
              content: message.content,
              // eslint-disable-next-line @typescript-eslint/naming-convention
              is_error: !message.success
            }]
          });
          break;
          
        case 'system':
          // System messages are handled separately in Claude
          logger.debug('System message skipped in conversion (handled separately)', {
            messageId: message.id
          });
          break;
          
        default:
          logger.warn('Unknown message type skipped', {
            messageType: message.type,
            messageId: message.id
          });
      }
    } catch (error) {
      throw new LLMErrorClass(createToolIntegrationError(
        `Failed to convert message to Claude Vertex format: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'schema_conversion',
        {
          toolName: 'message-converter',
          context: { messageId: message.id, messageType: message.type }
        }
      ));
    }
  }

  logger.debug('Message conversion to Claude Vertex format completed', {
    inputCount: messages.length,
    outputCount: claudeMessages.length
  });

  return claudeMessages;
}

/**
 * Extract system prompt from messages
 */
export function extractSystemPrompt(messages: readonly Message[]): string | undefined {
  const systemMessages = messages.filter(m => m.type === 'system');
  
  if (systemMessages.length === 0) {
    return undefined;
  }
  
  if (systemMessages.length === 1) {
    return systemMessages[0]?.content;
  }
  
  // Multiple system messages - combine them
  logger.debug('Multiple system messages found, combining', {
    count: systemMessages.length
  });
  
  return systemMessages
    .sort((a, b) => {
      // Sort by priority: higher priority number first
      // Convert string priority to number for sorting
      const aPriority = convertPriorityToNumber(a.priority);
      const bPriority = convertPriorityToNumber(b.priority);
      return bPriority - aPriority;
    })
    .map(m => m.content)
    .join('\n\n');
}

/**
 * Convert string priority to number for sorting
 * Higher numbers = higher priority
 */
function convertPriorityToNumber(priority?: 'high' | 'medium' | 'low'): number {
  switch (priority) {
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 2; // Default to medium priority
  }
}

/**
 * Convert Vertex response back to common format
 */
export function convertFromVertexResponse(
  vertexResponse: VertexApiResponse,
  requestId: string
): {
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
} {
  try {
    const candidate = vertexResponse.candidates?.[0];
    
    if (!candidate) {
      throw new Error('No candidates in Vertex response');
    }
    
    let content = '';
    let thinking = '';
    const toolCalls: ToolCall[] = [];
    
    // Process parts with thinking support
    if (candidate.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          // Check if this part is marked as thinking content
          const partWithThought = part as { text: string; thought?: boolean; [key: string]: unknown };
          if (partWithThought.thought) {
            thinking += part.text;
          } else {
            content += part.text;
          }
        }
        
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).substring(2)}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args || {},
            type: 'function'
          });
        }
      }
    }
    
    // Determine finish reason
    let finishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';
    
    if (candidate.finishReason) {
      switch (candidate.finishReason) {
        case 'MAX_TOKENS':
          finishReason = 'length';
          break;
        case 'STOP':
          finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
          break;
        case 'SAFETY':
        case 'RECITATION':
        case 'OTHER':
          finishReason = 'error';
          break;
        default:
          finishReason = 'stop';
      }
    }
    
    return {
      content: content.trim(),
      finishReason,
      ...(thinking && { thinking: thinking.trim() }),
      ...(toolCalls.length > 0 && { toolCalls })
    };
    
  } catch (error) {
    throw new LLMErrorClass(createToolIntegrationError(
      `Failed to convert Vertex response: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'result_processing',
      {
        toolName: 'message-converter',
        context: { requestId }
      }
    ));
  }
}

/**
 * Convert Claude Vertex response back to common format with thinking support
 */
export function convertFromClaudeVertexResponse(
  claudeResponse: ClaudeApiResponse,
  requestId: string
): {
  content: string;
  thinking?: string;
  thinkingSignature?: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
} {
  try {
    let content = '';
    let thinking: string | undefined;
    let thinkingSignature: string | undefined;
    const toolCalls: ToolCall[] = [];
    
    // Process content array
    if (claudeResponse.content && Array.isArray(claudeResponse.content)) {
      for (const item of claudeResponse.content) {
        if (item.type === 'thinking') {
          // Handle explicit thinking content blocks from Claude 4
          thinking = item.thinking || '';
          thinkingSignature = item.signature; // Capture the signature
        } else if (item.type === 'text') {
          // Check if this is thinking content (usually starts with specific markers)
          if (item.text && isThinkingContent(item.text)) {
            thinking = extractThinkingContent(item.text);
            // Remove thinking markers from main content
            const cleanContent = removeThinkingMarkers(item.text);
            if (cleanContent) {
              content += cleanContent;
            }
          } else {
            content += item.text || '';
          }
        } else if (item.type === 'tool_use') {
          toolCalls.push({
            id: item.id || `call_${Date.now()}_${Math.random().toString(36).substring(2)}`,
            name: item.name || 'unknown',
            arguments: item.input || {},
            type: 'tool'
          });
        }
      }
    }
    
    // Determine finish reason
    let finishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';
    
    if (claudeResponse.stop_reason) {
      switch (claudeResponse.stop_reason) {
        case 'max_tokens':
          finishReason = 'length';
          break;
        case 'tool_use':
          finishReason = 'tool_calls';
          break;
        case 'end_turn':
          finishReason = 'stop';
          break;
        case 'stop_sequence':
          finishReason = 'stop';
          break;
        default:
          finishReason = 'stop';
      }
    }
    
    return {
      content: content.trim(),
      finishReason,
      ...(thinking && { thinking }),
      ...(thinkingSignature && { thinkingSignature }),
      ...(toolCalls.length > 0 && { toolCalls })
    };
    
  } catch (error) {
    throw new LLMErrorClass(createToolIntegrationError(
      `Failed to convert Claude Vertex response: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'result_processing',
      {
        toolName: 'message-converter',
        context: { requestId }
      }
    ));
  }
}

/**
 * Helper functions for thinking content detection and extraction
 */
function isThinkingContent(text: string): boolean {
  // Claude thinking content typically starts with <thinking> or similar markers
  const thinkingMarkers = ['<thinking>', '<think>', '(thinking)', '[thinking]'];
  const lowerText = text.toLowerCase().trim();
  return thinkingMarkers.some(marker => lowerText.startsWith(marker));
}

function extractThinkingContent(text: string): string {
  // Extract content between thinking markers
  const patterns = [
    /<thinking>([\s\S]*?)<\/thinking>/gi,
    /<think>([\s\S]*?)<\/think>/gi,
    /\(thinking\)([\s\S]*?)\(\/thinking\)/gi,
    /\[thinking\]([\s\S]*?)\[\/thinking\]/gi
  ];
  
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  // If no closing tag found, assume the entire text is thinking
  return text.replace(/^(<thinking>|<think>|\(thinking\)|\[thinking\])/i, '').trim();
}

function removeThinkingMarkers(text: string): string {
  // Remove thinking markers and content from the main text
  const patterns = [
    /<thinking>[\s\S]*?<\/thinking>/gi,
    /<think>[\s\S]*?<\/think>/gi,
    /\(thinking\)[\s\S]*?\(\/thinking\)/gi,
    /\[thinking\][\s\S]*?\[\/thinking\]/gi
  ];
  
  let cleanText = text;
  for (const pattern of patterns) {
    cleanText = cleanText.replace(pattern, '');
  }
  
  return cleanText.trim();
}