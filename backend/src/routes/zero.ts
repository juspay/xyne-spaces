import { handleGetQueries, handleGetQueriesFallback, handlePush, handlePushFallback, getZeroFallbackConfig, setZeroFallbackConfig } from "@/controllers/zeroController";
import { authMiddleware } from "@/middleware/auth";
import { Router } from "express";

const router = Router();

// Use authenticateZero middleware for Zero endpoints (no auto-refresh)
router.post('/push', authMiddleware.authenticateZero, handlePush);
router.post('/query', authMiddleware.authenticateZero, handleGetQueries);

// Fallback endpoints
router.post('/query-fallback', authMiddleware.authenticateZero, handleGetQueriesFallback);
router.post('/push-fallback', authMiddleware.authenticateZero, handlePushFallback);
router.get('/fallback-config', authMiddleware.authenticateZero, getZeroFallbackConfig);
// Writing the deployment-wide fallback config is an admin-only operation
router.post('/fallback-config', authMiddleware.authenticateZero, authMiddleware.requireAdmin, setZeroFallbackConfig);

export default router;