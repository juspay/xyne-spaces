import { Request, Response } from 'express';
import { WebhookReceiver, WebhookEvent } from 'livekit-server-sdk';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

class LiveKitWebhookController {
  private receiver: WebhookReceiver;

  constructor() {
    // Initialize webhook receiver with existing API credentials
    // LiveKit uses the same API secret for webhook signature verification
    this.receiver = new WebhookReceiver(
      config.livekit.apiKey,
      config.livekit.apiSecret
    );
    logger.info('[LiveKit Webhook] Controller initialized');
  }

  /**
   * POST /api/livekit/webhook
   * Receives webhooks from LiveKit server
   * 
   * LiveKit sends cryptographically signed webhooks for room events.
   * This is the authoritative source for room lifecycle events.
   */
  handleWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      // Verify webhook signature and parse event
      // Note: req.body is a Buffer from express.raw() middleware
      // WebhookReceiver.receive() expects the raw body as a string
      const event = await this.receiver.receive(
        req.body.toString('utf8'), 
        req.get('Authorization')
      );

      logger.info(`[LiveKit Webhook] Received event: ${event.event}`, {
        event: event.event,
        roomName: event.room?.name,
        roomSid: event.room?.sid,
        numParticipants: event.room?.numParticipants,
      });

      // Handle different event types
      switch (event.event) {
        case 'room_started':
          await this.handleRoomStarted(event);
          break;

        case 'room_finished':
          await this.handleRoomFinished(event);
          break;

        case 'participant_joined':
          await this.handleParticipantJoined(event);
          break;

        case 'participant_left':
          await this.handleParticipantLeft(event);
          break;

        default:
          logger.debug(`[LiveKit Webhook] Unhandled event type: ${event.event}`);
      }

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[LiveKit Webhook] Error processing webhook:', error);
      res.status(500).json({ error: 'Failed to process webhook' });
    }
  };

  /**
   * Handle room_started event
   */
  private async handleRoomStarted(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    logger.info(`[LiveKit Webhook] Room started: ${roomName}`, {
      sid: event.room?.sid,
      creationTime: event.room?.creationTime ? Number(event.room.creationTime) : undefined,
      metadata: event.room?.metadata,
      numParticipants: event.room?.numParticipants,
    });
  }

  /**
   * Handle room_finished event
   */
  private async handleRoomFinished(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    logger.info(`[LiveKit Webhook] Room finished: ${roomName}`, {
      sid: event.room?.sid,
      numParticipants: event.room?.numParticipants,
      metadata: event.room?.metadata,
    });
  }

  /**
   * Handle participant_joined event
   */
  private async handleParticipantJoined(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    const participant = event.participant;

    logger.info(`[LiveKit Webhook] Participant joined: ${participant?.identity} in room ${roomName}`, {
      sid: participant?.sid,
      name: participant?.name,
      metadata: participant?.metadata,
    });
  }

  /**
   * Handle participant_left event
   */
  private async handleParticipantLeft(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    const participant = event.participant;

    logger.info(`[LiveKit Webhook] Participant left: ${participant?.identity} from room ${roomName}`, {
      sid: participant?.sid,
      name: participant?.name,
      metadata: participant?.metadata,
    });
  }
}

export const livekitWebhookController = new LiveKitWebhookController();
