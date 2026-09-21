import express from 'express';
import { BoardController } from '../controllers/boardController';

const router = express.Router();
const boardController = new BoardController();

// Create a new board with stages
router.post('/', boardController.createBoard);

// Give this board its own copy of a custom-fields form it currently shares with other
// boards, so editing its fields cannot change theirs.
router.post(
  '/:boardId/custom-fields/detach-shared-form',
  boardController.detachSharedCustomFieldsForm,
);

export default router;
