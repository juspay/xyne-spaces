import express from 'express';
import { BoardController } from '../controllers/boardController';

const router = express.Router();
const boardController = new BoardController();

// Create a new board with stages
router.post('/', boardController.createBoard);

export default router;
