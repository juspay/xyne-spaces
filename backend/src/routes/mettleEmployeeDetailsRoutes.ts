import { Router } from 'express';
import { mettleEmployeeDetailsController } from '../controllers/mettleEmployeeDetailsController';

const router = Router();

/**
 * Mettle Employee Details Routes
 * These routes fetch employee information from external Mettle API
 */

// Get employee details by email
router.get('/details', mettleEmployeeDetailsController.getEmployeeDetails);

export default router;
