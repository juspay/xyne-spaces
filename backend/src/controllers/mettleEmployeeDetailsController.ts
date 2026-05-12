import { Request, Response } from 'express';
import { mettleEmployeeDetailsService } from '../services/mettleEmployeeDetailsService';
import { logger } from '../utils/logger';

export class MettleEmployeeDetailsController {
  private static instance: MettleEmployeeDetailsController;

  private constructor() {}

  public static getInstance(): MettleEmployeeDetailsController {
    if (!MettleEmployeeDetailsController.instance) {
      MettleEmployeeDetailsController.instance = new MettleEmployeeDetailsController();
    }
    return MettleEmployeeDetailsController.instance;
  }

  /**
   * Get employee details by email
   * Query params: email (required)
   */
  getEmployeeDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.query;

      // Validate email query parameter
      if (!email || typeof email !== 'string' || email.trim().length === 0) {
        res.status(400).json({
          error: 'Email query parameter is required and must be a non-empty string',
        });
        return;
      }

      const trimmedEmail = email.trim();

      logger.info(`Fetching employee details for email: ${trimmedEmail}`);

      const employeeDetails = await mettleEmployeeDetailsService.getEmployeeDetailsByEmail(
        trimmedEmail
      );

      if (!employeeDetails) {
        res.status(404).json({
          error: 'Employee not found in Mettle',
          email: trimmedEmail,
        });
        return;
      }

      const filteredResponse = {
        assigned_emp_id: employeeDetails.assigned_emp_id,
        current_landmark: employeeDetails.current_landmark,
        current_location: employeeDetails.current_location,
        email: employeeDetails.email,
        employee_status: employeeDetails.employee_status,
        in_office: employeeDetails.in_office,
        last_seen_at: employeeDetails.last_seen_at,
        location: employeeDetails.location,
        name: employeeDetails.name,
        work_mode: employeeDetails.work_mode,
      };

      res.status(200).json(filteredResponse);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error in getEmployeeDetails: ${error.message}`);
        res.status(500).json({
          error: 'Failed to fetch employee details',
          message: error.message,
        });
      } else {
        logger.error('Unknown error in getEmployeeDetails');
        res.status(500).json({
          error: 'Failed to fetch employee details',
        });
      }
    }
  };
}

export const mettleEmployeeDetailsController = MettleEmployeeDetailsController.getInstance();
