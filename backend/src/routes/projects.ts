import express from 'express';
import { ProjectController } from '../controllers/projectController';

const router = express.Router();
const projectController = new ProjectController();

// Create a new project
router.post('/', projectController.createProject);

// Get project-level daily recaps for the current user
router.get('/recap', projectController.getProjectRecap);

export default router;
