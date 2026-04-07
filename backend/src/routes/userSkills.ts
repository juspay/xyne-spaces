import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getUserSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  toggleSkillEnabled,
} from '../controllers/userSkillsController';

const router = Router();

// Get all skills for the authenticated user
router.get('/', authMiddleware.authenticate, getUserSkills);

// Create a new skill
router.post('/', authMiddleware.authenticate, createSkill);

// Update an existing skill (skillName is the unique identifier)
router.put('/:skillName', authMiddleware.authenticate, updateSkill);

// Delete a skill (skillName is the unique identifier)
router.delete('/:skillName', authMiddleware.authenticate, deleteSkill);

// Toggle skill enabled status (skillName is the unique identifier)
router.patch('/:skillName/enable', authMiddleware.authenticate, toggleSkillEnabled);

export default router;
