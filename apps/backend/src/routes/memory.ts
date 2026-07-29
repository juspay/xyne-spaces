import { Router} from 'express';
import multer from 'multer';
import { memoryController } from '@/controllers/memoryController';
import { documentController } from '@/controllers/documentController';
import { authMiddleware } from '@/middleware/auth';
import { authenticateUserOrApp } from '@/middleware/authenticateUserOrApp';
import { authorize } from '@/middleware/authorize';
import { validateZod } from '@/middleware/validation';
import { AccessType } from '@prisma/client';
import { z } from 'zod';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

/**
  * Validation schema for POST /memory/search
  */
const memorySearchSchema = z.object({
  query: z.string().nullable().optional(),
  docId: z.string().optional(),
  scope: z.enum(['my', 'all']).default('all'),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  docType: z.enum(['fact', 'sop']).optional(),
  tags: z.array(z.string()).optional(),
  repoUrl: z.string().optional(),
  includeSummary: z.boolean().default(true),
  includeQuery: z.boolean().default(true),
  commitId: z.string().optional(),
  sessionId: z.string().optional(),
  filePointers: z.string().optional(),
  ticketId: z.string().optional(),
  parentRef: z.string().optional(),
  reviewStatus: z.enum(['pending', 'verified', 'rejected']).optional(),
});

/**
  * Validation schema for PATCH /memory/:docId
  * Every update will create a new doc 
  * if only reviewStatus change no new document get created
  */
const memoryUpdateSchema = z.object({
  userQuery: z.string().optional(),
  chatSummary: z.array(z.string()).optional(),
  rawContent: z.string().optional(),
  tags: z.array(z.string()).optional(),
  filePointers: z.array(z.string()).optional(),
  commitId: z.string().optional(),
  reviewStatus: z.enum(['pending', 'verified', 'rejected']).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

/**
  * @route POST /api/memory/search
  * @desc Search documents in the memory schema
  * @access Private (requires authentication)
  * @body MemorySearchOptions
  *
  * Request body:
  * {
  *   "query": "deploy auth service",
  *   "scope": "my",
  *   "limit": 20,
  *   "offset": 0,
  *   "docType": "FACT",
  *   "tags": ["deployment", "auth"]
  * }
  */
router.post('/search', authMiddleware.authenticate, validateZod(memorySearchSchema), memoryController.searchMemoryDocuments);


router.post('/claw/search', authenticateUserOrApp, validateZod(memorySearchSchema), memoryController.searchMemoryDocuments);

/**
  * @route PATCH /api/memory/:docId
  * @desc Update a memory document (partial update)
  * @access Private (requires authentication)
  * @param docId - Document ID to update
  */
router.patch('/:docId', authMiddleware.authenticate, validateZod(memoryUpdateSchema), memoryController.updateMemoryDocument);

/**
  * @route DELETE /api/memory/:docId
  * @desc Delete a memory document
  * @access Private (requires authentication)
  * @param docId - Document ID to delete
  */
router.delete('/:docId', authMiddleware.authenticate, memoryController.deleteMemoryDocument);


/**
  * @route POST /api/memory/turn
  * @desc Buffer a single conversation turn in Redis
  * @access Private (requires authentication)
  * @body SessionRecordingPayload
  */
router.post('/turn', authMiddleware.authenticate, memoryController.bufferSessionTurn);

  /**
  * @route POST /api/memory/index
  * @desc Index a new document in the memory schema
  * @access Private (requires authentication)
  * @body VespaMemoryDocument
  */
router.post('/index', authMiddleware.authenticate, memoryController.indexMemoryDocument);

router.post('/claw/index', authenticateUserOrApp, memoryController.indexMemoryDocument);

/**
  * Validation schema for POST /memory/replaceSession
  * Backend derives: docId, userId, repoUrl, commitId, ticketId, chatSummary,
  * timestamps, agentUsed, modelUsed, parentRef, reviewStatus.
  * Caller sends only the agent-editable fields.
  */
const replaceSessionSchema = z.object({
  sessionId: z.string().min(1),
  reviewStatus: z.enum(['pending', 'verified', 'rejected']).default('pending'),
  docs: z.array(z.object({
    docType: z.enum(['fact', 'sop']),
    rawContent: z.string(),
    userQuery: z.string().optional().default(''),
    tags: z.array(z.string()).default([]),
    filePointers: z.array(z.string()).default([]),
  })).min(1),
});

/**
  * @route POST /api/memory/replaceSession
  * @desc Atomically replace all SOPs and Facts for a session.
  *       Inherits repoUrl/commitId/ticketId from one existing doc,
  *       deletes all current docs, then re-inserts the provided docs.
  * @access Private (requires authentication)
  */
router.post('/replaceSession', authMiddleware.authenticate, validateZod(replaceSessionSchema), memoryController.replaceSessionMemory);

/**
  * @route GET /api/memory/sessionHistory
  * @desc Get normalized session history for a given sessionId
  * @access Private (requires authentication)
  * @query sessionId - The session or workflow execution ID
  */
router.get('/sessionHistory', authMiddleware.authenticate, memoryController.getSessionHistory);

// ---------------------------------------------------------------------------
// Document Upload & Cleanup (admin-only for destructive operations)
// ---------------------------------------------------------------------------

const deleteBySessionIdsSchema = z.object({
  sessionIds: z
    .array(z.string().uuid())
    .min(1, 'At least one sessionId is required')
    .max(100, 'Maximum 100 sessionIds per request'),
});

/**
 * @route POST /api/memory/upload
 * @desc Upload one or more .txt/.md files to be async-ingested into Vespa memory.
 *       Body fields: files (multipart), repoUrl (optional string)
 * @access Private (requires authentication)
 */
router.post(
  '/upload',
  authMiddleware.authenticate,
  upload.array('files', 20),
  documentController.uploadDocuments,
);

/**
 * @route DELETE /api/memory/sessions
 * @desc Delete all Vespa memory documents for the given session IDs.
 * @access Private — requires MEMORY ADMIN permission
 * @body { sessionIds: string[] }
 */
router.delete(
  '/sessions',
  authMiddleware.authenticate,
  authorize('MEMORY', AccessType.ADMIN),
  validateZod(deleteBySessionIdsSchema),
  documentController.deleteBySessionIds,
);

/**
 * @route DELETE /api/memory/vespa-memory
 * @desc Cleanup — deletes ALL documents from the Vespa memory schema. Irreversible.
 * @access Private — requires MEMORY ADMIN permission
 */
router.delete(
  '/vespa-memory',
  authMiddleware.authenticate,
  authorize('MEMORY', AccessType.ADMIN),
  documentController.cleanupAllVespaMemory,
);

export default router;