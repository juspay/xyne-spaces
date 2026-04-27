import { Router } from 'express';
import { AppController } from '../controllers/appController';
import { ChatController } from '../controllers/chatController';
import { authorize } from '@/middleware/authorize';
import { AccessType } from '@prisma/client';
import chatRoutes from './chat';
import fileRoutes from './files';
import ticketRoutes from './ticket';
import userRoutes from './user';
import channelRoutes from './channel';
import userGroupRoutes from './usergroups';
import emailRoutes from './email';
import prCheckCallbackRouter from './prCheckCallback';
import { authenticateApp } from '../middelware/authenticator';
import { uploadMultiple, uploadConfig } from '@/middleware/upload';
import { authMiddleware } from '@/middleware/auth';

const router = Router();
const appController = new AppController();
const chatController = new ChatController();

router.post('/create', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.createApp);
router.post('/install/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.ADMIN), appController.installApp);
router.post('/configureWebhook/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.configureWebhook);
router.post('/regenerate-jwt/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.regenerateJwt);
router.post('/upload-picture/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), uploadConfig.single('picture'), appController.uploadBotPicture);

// User-initiated app action dispatch (user auth, not app token)
router.post('/chat/action', authMiddleware.authenticate, chatController.dispatchAction);

// Channel routes
router.use('/channel', authenticateApp, channelRoutes);

// Chat routes
router.use('/chat', authenticateApp, chatRoutes);

// File routes
router.use('/files', uploadMultiple, authenticateApp, fileRoutes);

// Ticket routes
router.use('/ticket', authenticateApp, ticketRoutes);

// User routes
router.use('/user', authenticateApp, userRoutes);

// Channel routes
router.use('/channel', authenticateApp, channelRoutes);

// User Group routes
router.use('/usergroups', authenticateApp, userGroupRoutes);

// Email routes
router.use('/email', authenticateApp, emailRoutes);

// PR check callback (called by dispatchAction when user clicks "Run PR Check" button)
// No auth needed here - dispatchAction is already authenticated and validates the request
router.use('/pr-check', prCheckCallbackRouter);

export default router;