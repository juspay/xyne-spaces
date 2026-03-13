import { Router } from 'express';
import { AppController } from '../controllers/appController';
import { authorize } from '@/middleware/authorize';
import { AccessType } from '@prisma/client';
import chatRoutes from './chat';
import fileRoutes from './files';
import ticketRoutes from './ticket';
import { authenticateApp } from '../middelware/authenticator';
import { uploadMultiple } from '@/middleware/upload';
import { authMiddleware } from '@/middleware/auth';

const router = Router();
const appController = new AppController();

router.post('/create', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.createApp);
router.post('/install/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.ADMIN), appController.installApp);

// Chat routes
router.use('/chat', authenticateApp, chatRoutes);

// File routes
router.use('/files', uploadMultiple, authenticateApp, fileRoutes);

// Ticket routes
router.use('/ticket', authenticateApp, ticketRoutes);


export default router;