import { Router } from 'express';
import { RoomController } from '../controllers/roomController';

const router = Router();
const roomController = new RoomController();

router.post('/:roomId/curate', (req, res) => roomController.curateRoom(req, res));

export default router;
