import type { Message, Attachment } from '../../../core/types/messages.js';
import type { LiteLLMMessage } from '../schemas.js';
import { logger } from '../../../../utils/logger.js';
import {
  LLMErrorClass,
  createProviderValidationError
} from '../../../core/errors/index.js';

/**
 * Message conversion utilities for LiteLLM
 * Handles conversion between Common message format and LiteLLM-specific formats
 */

/**
 * Convert internal messages to LiteLLM format
 */
export function convertMessages(messages: readonly Message[], model?: string): LiteLLMMessage[] {
  return messages.map(message => {
    switch (message.type) {
      case 'user': {
        // Handle multimodal content with attachments (OpenAI format)
        if (message.attachments && message.attachments.length > 0) {
          const contentParts: Array<{
            type: 'text' | 'image_url' | 'file';
            text?: string;
            // eslint-disable-next-line @typescript-eslint/naming-convention
            image_url?: {
              url: string;
              detail?: 'auto' | 'low' | 'high';
            };
            file?: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              file_data?: string;
              // eslint-disable-next-line @typescript-eslint/naming-convention
              file_id?: string;
              format?: string;
            };
          }> = [];

          // Add text content if present
          if (message.content) {
            contentParts.push({
              type: 'text',
              text: message.content
            });
          }

          let hasTextConversions = false;
          let textContent = '';

          // Process attachments
          for (const attachment of message.attachments) {
            logger.debug('Processing attachment', {
              attachmentId: attachment.id,
              attachmentType: attachment.type,
              mimeType: attachment.mimeType,
              hasData: !!attachment.data,
              dataLength: attachment.data?.length || 0
            });

            if (!attachment.data) {
              logger.warn('Attachment missing data, skipping', {
                attachmentId: attachment.id,
                attachmentType: attachment.type
              });
              continue;
            }

            // Check if attachment type is supported for native multimodal
            const isNativeSupported = model ? isAttachmentSupportedByModel(attachment, model) : false;
            logger.debug('Native support check', {
              attachmentId: attachment.id,
              isNativeSupported,
              attachmentType: attachment.type,
              mimeType: attachment.mimeType,
              model
            });

            if (isNativeSupported) {
              // Use appropriate format based on attachment type
              if (attachment.type === 'image') {
                // Send images as image_url (OpenAI format)
                const dataUrl = `data:${attachment.mimeType};base64,${attachment.data}`;
                contentParts.push({
                  type: 'image_url',
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  image_url: {
                    url: dataUrl,
                    detail: 'auto'
                  }
                });
                logger.debug('Added image attachment to content parts', {
                  attachmentId: attachment.id,
                  mimeType: attachment.mimeType
                });
              } else {
                // Send documents as file type (LiteLLM preferred format)
                const dataUrl = `data:${attachment.mimeType};base64,${attachment.data}`;
                contentParts.push({
                  type: 'file',
                  file: {
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    file_data: dataUrl,
                    format: attachment.mimeType
                  }
                });
                logger.debug('Added document attachment to content parts', {
                  attachmentId: attachment.id,
                  mimeType: attachment.mimeType,
                  attachmentType: attachment.type
                });
              }
            } else {
              // Try to convert to text if it's a text file
              const buffer = Buffer.from(attachment.data, 'base64');
              if (isValidTextContent(buffer)) {
                textContent += '\n\n' + convertAttachmentToText(attachment);
                hasTextConversions = true;
              } else {
                // Throw error for unsupported binary files
                throw new LLMErrorClass(createProviderValidationError(
                  'litellm',
                  [`File type ${attachment.mimeType} is not supported by this model and cannot be converted to text`],
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

          // Add converted text content if any
          if (hasTextConversions) {
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

          logger.debug('Final multimodal message content', {
            messageId: message.id,
            contentPartsCount: contentParts.length,
            contentParts: contentParts.map(part => ({
              type: part.type,
              textLength: part.text?.length,
              hasImageUrl: !!part.image_url
            }))
          });

          return {
            role: 'user' as const,
            content: contentParts
          };
        } 
        // Simple text message
        return {
          role: 'user' as const,
          content: message.content
        };
      }
      case 'assistant': {
        const baseMessage: LiteLLMMessage = {
          role: 'assistant' as const,
          content: message.content
        };

        // Handle tool calls for assistant messages
        if ('toolCalls' in message && message.toolCalls?.length) {
          baseMessage.tool_calls = message.toolCalls.map(toolCall => ({
            id: toolCall.id || 'call_' + Math.random().toString(36).substring(2, 9),
            type: 'function' as const,
            function: {
              name: toolCall.name,
              arguments: typeof toolCall.arguments === 'string' 
                ? toolCall.arguments 
                : JSON.stringify(toolCall.arguments)
            }
          }));
        }

        return baseMessage;
      }
      case 'system':
        return {
          role: 'system' as const,
          content: message.content
        };
      case 'tool_result':
        return {
          role: 'tool' as const,
          content: message.content,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          tool_call_id: message.toolCallId
        };
      case 'tool_call':
        // Tool calls are handled within assistant messages
        return {
          role: 'assistant' as const,
          content: message.content
        };
      default:
        return {
          role: 'user' as const,
          content: (message as { content: string }).content
        };
    }
  });
}

/**
 * File type support matrix for LiteLLM models
 */
const LITELLM_FILE_TYPE_SUPPORT = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'claude-sonnet-4': {
    images: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    documents: ['application/pdf']
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'claude-sonnet-4-20250514': {
    images: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    documents: ['application/pdf']
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'gemini-2.5-pro': {
    images: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    videos: ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm'],
    audio: ['audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac'],
    documents: ['application/pdf']
  },
  // GLM models - images only for now
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'glm-45-fp8': {
    images: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'glm-46-fp8': {
    images: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  },
  'glm-latest': {
    images: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  },
  // MiniMax M2 - images support
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'xyne-spaces-minimax-m2': {
    images: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  }
} as const;

/**
 * Check if attachment is supported by specific LiteLLM model
 */
export function isAttachmentSupportedByModel(attachment: Attachment, modelName: string): boolean {
  const supportInfo = LITELLM_FILE_TYPE_SUPPORT[modelName as keyof typeof LITELLM_FILE_TYPE_SUPPORT];
  if (!supportInfo) return false;
  
  const mimeType = attachment.mimeType.toLowerCase();
  const allSupportedTypes: readonly string[] = [
    ...supportInfo.images,
    ...(('videos' in supportInfo) ? supportInfo.videos : []),
    ...(('audio' in supportInfo) ? supportInfo.audio : []),
    ...(('documents' in supportInfo) ? supportInfo.documents : [])
  ];
  
  return allSupportedTypes.includes(mimeType);
}



/**
 * Check if file content is valid UTF-8 text
 */
export function isValidTextContent(buffer: Buffer): boolean {
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
export function convertAttachmentToText(attachment: Attachment): string {
  if (!attachment.data) {
    throw new Error('Attachment missing data for text conversion');
  }
  
  const buffer = Buffer.from(attachment.data, 'base64');
  const content = buffer.toString('utf-8');
  const fileName = attachment.name || 'unnamed_file';
  
  return `File: ${fileName}\n${'='.repeat(50)}\n${content}`;
}