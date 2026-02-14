import { Router } from 'express';
import { livekitWebhookController } from '@/controllers/livekitWebhookController';
import express from 'express';

const router = Router();

/**
 * LiveKit Webhook Routes
 * 
 * These routes receive cryptographically signed webhooks from LiveKit server.
 * No additional authentication middleware needed - signature verification 
 * happens in the controller using the existing LIVEKIT_API_SECRET.
 * 
 * Configure in LiveKit server config (livekit.yaml):
 * 
 * webhook:
 *   api_key: devkey  # Your LIVEKIT_API_KEY
 *   urls:
 *     - https://your-backend.com/api/livekit/webhook
 * 
 * IMPORTANT: Must use raw body for signature verification!
 * The SHA256 checksum is computed on the raw bytes, not parsed JSON.
 */

// Parse body as raw buffer (LiveKit sends 'application/webhook+json' content-type)
// This preserves the raw bytes needed for signature verification
router.use(express.raw({ type: 'application/webhook+json' }));

// POST /api/livekit/webhook
// Receives all webhook events from LiveKit server
router.post('/webhook', livekitWebhookController.handleWebhook);

export default router;
