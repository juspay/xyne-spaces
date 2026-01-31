import { handleGetQueries, handlePush } from "@/controllers/zeroController";
import { authMiddleware } from "@/middleware/auth";
import { Router } from "express";

const router = Router();

// Use authenticateZero middleware for Zero endpoints (no auto-refresh)
router.post('/push', authMiddleware.authenticateZero, handlePush);
router.post('/query', authMiddleware.authenticateZero, handleGetQueries);

export default router;