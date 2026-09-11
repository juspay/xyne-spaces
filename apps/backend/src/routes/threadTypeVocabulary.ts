import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { ThreadTypeVocabularyController } from '@/controllers/threadTypeVocabularyController';

const router = Router();
const controller = new ThreadTypeVocabularyController();

// Every member reads it — the thread-tag picker is built from it. Approved names only.
router.get('/', controller.getVocabulary);

// The review queue. Admin-gated, and not merely because the screen is: its thread counts are
// taken with the per-user permission filter off, so it reports usage across channels the
// caller cannot open.
router.get('/review', authMiddleware.requireAdminOrOwner, controller.getReview);

// The caller's own undecided proposals, so their chip can show as under review. Not admin
// gated: it is their own list, and it is the only way the author learns the name is pending.
router.get('/mine', controller.myPendingNames);

// Admins only: an entry's description is the classifier's instruction for that type, so a
// write changes how every thread in the workspace is classified from the next pass on.
//
// PATCH adds/removes individual types — the form to reach for from a script. PUT replaces
// the whole list, for when the vocabulary is kept as a checked-in JSON file.
router.patch('/', authMiddleware.requireAdminOrOwner, controller.patchVocabulary);

// Deciding a proposal. Approval is a PATCH/PUT of the entry itself — four fields have to be
// authored, so it cannot be a one-click verb. Turning one down needs no entry, only a reason.
// Copies the starting vocabulary in. Nothing seeds implicitly, so a fresh workspace has no
// types until an admin asks for them or authors their own.
router.post('/seed', authMiddleware.requireAdminOrOwner, controller.seedVocabulary);

router.post('/reject', authMiddleware.requireAdminOrOwner, controller.rejectCandidates);
router.post('/reconsider', authMiddleware.requireAdminOrOwner, controller.reconsiderCandidates);
router.put('/', authMiddleware.requireAdminOrOwner, controller.updateVocabulary);

export default router;
