import { useCallback, useEffect } from 'react';
import type { RemoteParticipant, Room } from 'livekit-client';
import { RoomEvent } from 'livekit-client';
import { z } from 'zod';
import { logger, Logger } from '../../../utils/logger';
import {
  addCallWhiteboardStroke,
  appendCallWhiteboardPoint,
  CALL_WHITEBOARD_TOPIC,
  completeCallWhiteboardStroke,
  getAllCallWhiteboardStrokes,
  getCallWhiteboardDeletedPages,
  getCallWhiteboardDeletedStrokes,
  getCallWhiteboardPages,
  getCallWhiteboardState,
  mergeCallWhiteboardState,
  sendCallWhiteboardEvent,
  type CallWhiteboardWireMessage,
} from '../../../stores/callWhiteboardStore';

interface CallWhiteboardSyncProps {
  room: Room | null;
}

const whiteboardPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const whiteboardPageSchema = z.object({
  id: z.string(),
  label: z.string(),
  order: z.number(),
  createdAt: z.number(),
  createdBy: z.string(),
});

const whiteboardStrokeSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  participantIdentity: z.string(),
  points: z.array(whiteboardPointSchema),
  color: z.string(),
  width: z.number(),
  tool: z.enum(['pen', 'eraser']),
  isComplete: z.boolean(),
});

const whiteboardBaseMessageSchema = {
  participantIdentity: z.string(),
  timestamp: z.number(),
};

const whiteboardMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('WHITEBOARD_STROKE_BEGIN'),
    ...whiteboardBaseMessageSchema,
    stroke: whiteboardStrokeSchema,
  }),
  z.object({
    type: z.literal('WHITEBOARD_STROKE_POINT'),
    ...whiteboardBaseMessageSchema,
    pageId: z.string(),
    strokeId: z.string(),
    point: whiteboardPointSchema,
  }),
  z.object({
    type: z.literal('WHITEBOARD_STROKE_END'),
    ...whiteboardBaseMessageSchema,
    pageId: z.string(),
    strokeId: z.string(),
    stroke: whiteboardStrokeSchema.optional(),
  }),
  z.object({
    type: z.literal('WHITEBOARD_CLEAR'),
    ...whiteboardBaseMessageSchema,
    pageId: z.string(),
  }),
  z.object({
    type: z.literal('WHITEBOARD_STROKE_DELETE'),
    ...whiteboardBaseMessageSchema,
    pageId: z.string(),
    strokeId: z.string(),
  }),
  z.object({
    type: z.literal('WHITEBOARD_PAGE_CREATE'),
    ...whiteboardBaseMessageSchema,
    page: whiteboardPageSchema,
    activePageId: z.string(),
  }),
  z.object({
    type: z.literal('WHITEBOARD_PAGE_SELECT'),
    ...whiteboardBaseMessageSchema,
    pageId: z.string(),
  }),
  z.object({
    type: z.literal('WHITEBOARD_PAGE_DELETE'),
    ...whiteboardBaseMessageSchema,
    participantName: z.string().optional(),
    savedBeforeDelete: z.boolean().optional(),
    pageId: z.string(),
    nextActivePageId: z.string(),
  }),
  z.object({
    type: z.literal('WHITEBOARD_VISIBILITY'),
    ...whiteboardBaseMessageSchema,
    isOpen: z.boolean(),
  }),
  z.object({
    type: z.literal('WHITEBOARD_SYNC_REQUEST'),
    ...whiteboardBaseMessageSchema,
  }),
  z.object({
    type: z.literal('WHITEBOARD_SYNC_STATE'),
    ...whiteboardBaseMessageSchema,
    pages: z.array(whiteboardPageSchema),
    activePageId: z.string(),
    isOpen: z.boolean(),
    strokes: z.array(whiteboardStrokeSchema),
    deletedPageIds: z.record(z.string(), z.number()).optional(),
    deletedStrokeIds: z.record(z.string(), z.number()).optional(),
  }),
]);

export function CallWhiteboardSync({ room }: CallWhiteboardSyncProps): null {
  const participantIdentity = room?.localParticipant.identity ?? 'unknown';

  const publishWhiteboardEvent = useCallback(
    (message: CallWhiteboardWireMessage): void => {
      if (!room) return;
      const reliable = message.type !== 'WHITEBOARD_STROKE_POINT';
      void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), {
        reliable,
        topic: CALL_WHITEBOARD_TOPIC,
      });
    },
    [room],
  );

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ): void => {
      if (topic !== CALL_WHITEBOARD_TOPIC) return;

      let rawMessage: unknown;
      const payloadText = new TextDecoder().decode(payload);
      try {
        rawMessage = JSON.parse(payloadText);
      } catch (error) {
        logger.warn(Logger.Event.FRONTEND_ERROR, {
          feature: 'call-whiteboard',
          reason: 'invalid-whiteboard-message',
          error: error instanceof Error ? error.message : String(error),
          payloadPreview: payloadText.slice(0, 100),
        });
        return;
      }

      const parsedMessage = whiteboardMessageSchema.safeParse(rawMessage);
      if (!parsedMessage.success) {
        logger.warn(Logger.Event.FRONTEND_ERROR, {
          feature: 'call-whiteboard',
          reason: 'invalid-whiteboard-message-structure',
          error: parsedMessage.error.message,
          payloadPreview: payloadText.slice(0, 100),
        });
        return;
      }

      const message = parsedMessage.data as CallWhiteboardWireMessage;
      const senderIdentity = participant?.identity;
      if (!senderIdentity) return;
      if (message.participantIdentity !== senderIdentity) {
        logger.warn(Logger.Event.FRONTEND_ERROR, {
          feature: 'call-whiteboard',
          reason: 'whiteboard-sender-identity-mismatch',
          claimedIdentity: message.participantIdentity,
          senderIdentity,
        });
        return;
      }
      if (senderIdentity === participantIdentity) return;

      switch (message.type) {
        case 'WHITEBOARD_STROKE_BEGIN':
          addCallWhiteboardStroke({
            ...message.stroke,
            participantIdentity: senderIdentity,
          });
          break;
        case 'WHITEBOARD_STROKE_POINT':
          appendCallWhiteboardPoint(message.strokeId, message.point, message.pageId);
          break;
        case 'WHITEBOARD_STROKE_END':
          completeCallWhiteboardStroke(
            message.strokeId,
            message.pageId,
            message.stroke
              ? {
                  ...message.stroke,
                  participantIdentity: senderIdentity,
                }
              : undefined,
          );
          break;
        case 'WHITEBOARD_CLEAR':
          sendCallWhiteboardEvent({ type: 'clear', pageId: message.pageId });
          break;
        case 'WHITEBOARD_STROKE_DELETE':
          sendCallWhiteboardEvent({
            type: 'deleteStroke',
            pageId: message.pageId,
            strokeId: message.strokeId,
            timestamp: message.timestamp,
          });
          break;
        case 'WHITEBOARD_PAGE_CREATE':
          sendCallWhiteboardEvent({
            type: 'addPage',
            page: {
              ...message.page,
              createdBy: senderIdentity,
            },
            activate: true,
            timestamp: message.timestamp,
          });
          break;
        case 'WHITEBOARD_PAGE_SELECT':
          sendCallWhiteboardEvent({
            type: 'selectPage',
            pageId: message.pageId,
            timestamp: message.timestamp,
          });
          break;
        case 'WHITEBOARD_PAGE_DELETE':
          sendCallWhiteboardEvent({
            type: 'deletePage',
            pageId: message.pageId,
            nextActivePageId: message.nextActivePageId,
            timestamp: message.timestamp,
            deletedBy: participant.name || senderIdentity,
            ...(message.savedBeforeDelete && { savedBeforeDelete: true }),
          });
          break;
        case 'WHITEBOARD_VISIBILITY':
          sendCallWhiteboardEvent({
            type: 'setOpen',
            isOpen: message.isOpen,
            timestamp: message.timestamp,
          });
          break;
        case 'WHITEBOARD_SYNC_REQUEST': {
          const whiteboardState = getCallWhiteboardState();
          publishWhiteboardEvent({
            type: 'WHITEBOARD_SYNC_STATE',
            participantIdentity,
            pages: getCallWhiteboardPages(),
            activePageId: whiteboardState.activePageId,
            isOpen: whiteboardState.isOpen,
            strokes: getAllCallWhiteboardStrokes(),
            deletedPageIds: getCallWhiteboardDeletedPages(),
            deletedStrokeIds: getCallWhiteboardDeletedStrokes(),
            timestamp: Date.now(),
          });
          break;
        }
        case 'WHITEBOARD_SYNC_STATE':
          mergeCallWhiteboardState({
            incomingPages: message.pages,
            incomingStrokes: message.strokes,
            activePageId: message.activePageId,
            ...(message.deletedPageIds && { deletedPageIds: message.deletedPageIds }),
            ...(message.deletedStrokeIds && { deletedStrokeIds: message.deletedStrokeIds }),
            timestamp: message.timestamp,
          });
          sendCallWhiteboardEvent({
            type: 'setOpen',
            isOpen: message.isOpen,
            timestamp: message.timestamp,
          });
          break;
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    publishWhiteboardEvent({
      type: 'WHITEBOARD_SYNC_REQUEST',
      participantIdentity,
      timestamp: Date.now(),
    });

    return (): void => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [participantIdentity, publishWhiteboardEvent, room]);

  return null;
}
