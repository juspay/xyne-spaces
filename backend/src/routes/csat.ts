import { Router } from 'express';
import { csatController } from '@/controllers/csatController';
import { verifyApiSupportCsatRequest } from '@/middleware/apiSupportCsatAuth';

// CSAT satisfaction survey — PUBLIC routes, no auth middleware, but both
// require a signed token (see csatTokenService). GET only renders the
// star-rating + comment form (never records anything, so an email
// link-scanner prefetch is harmless) — the Good/Bad email links land here.
// POST is the only place a rating actually gets recorded, driven by the
// form's submit.
const router = Router();

// API-support flow — X-Api-Key auth instead of the per-ticket email token, for
// any external system posting CSAT results on tickets it owns.
// Must be registered before the generic '/:ticketId' routes below, otherwise
// Express would match "external" as a ticketId.
router.post('/external/:ticketId', verifyApiSupportCsatRequest, csatController.recordExternal);

router.get('/:ticketId', csatController.showForm);
router.post('/:ticketId', csatController.record);

export default router;
