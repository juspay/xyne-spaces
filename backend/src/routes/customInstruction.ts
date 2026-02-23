import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getCustomInstruction,
  saveCustomInstruction,
  deleteCustomInstruction,
} from '../controllers/customInstructionController';

const router = Router();

router.get('/', authMiddleware.authenticate, getCustomInstruction);

router.put('/', authMiddleware.authenticate, saveCustomInstruction);

router.delete('/', authMiddleware.authenticate, deleteCustomInstruction);

export default router;
