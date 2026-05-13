import { Router } from 'express';
   import { AccessType } from '@prisma/client';
   import { ChannelRecapToRecapBackfillController } from '@/controllers/channelRecapToRecapBackfillController';
   import { authMiddleware } from '@/middleware/auth';
   import { authorize } from '@/middleware/authorize';

   const router = Router();

   const recapBackfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

   /**
    * @route POST /api/admin/channel-recap-to-recap-backfill
    * @desc Backfill recaps from channel_recaps to the unified recaps table
    * @access TICKET-MIGRATION Admin only
    */
   router.post(
     '/',
     authMiddleware.authenticate,
     recapBackfillAdminAuth,
     ChannelRecapToRecapBackfillController.triggerBackfill
   );

   export default router;