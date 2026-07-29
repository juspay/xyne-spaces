import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export interface MettleEmployeeDetails {
  assigned_emp_id: string | null;
  current_landmark: string | null;
  current_location: string | null;
  date_of_joining: string;
  designation: string;
  email: string;
  employee_status: string;
  employement_type: string | null;
  gender: string;
  in_office: string | null;
  last_seen_at: string | null;
  location: string | null;
  name: string;
  profile_pic_base64: string | null;
  project_manager_name: string;
  role: string | null;
  subteam_names: string[];
  team_name: string;
  work_mode: string | null;
}

export class MettleEmployeeDetailsService {
  private static instance: MettleEmployeeDetailsService;

  private constructor() {}

  public static getInstance(): MettleEmployeeDetailsService {
    if (!MettleEmployeeDetailsService.instance) {
      MettleEmployeeDetailsService.instance = new MettleEmployeeDetailsService();
    }
    return MettleEmployeeDetailsService.instance;
  }

  /**
   * Fetch employee details from Mettle API
   * @param email Employee email address
   * @returns Employee details or null if not found
   */
  async getEmployeeDetailsByEmail(email: string): Promise<MettleEmployeeDetails | null> {
    try {
      if (!config.mettleToken) {
        logger.error('METTLE_TOKEN not configured');
        throw new Error('Mettle token not configured');
      }

      if (!config.mettleApiBaseUrl) {
        logger.error('METTLE_API_BASE_URL not configured');
        throw new Error('Mettle API base URL not configured');
      }

      if (!email || typeof email !== 'string') {
        logger.error('Invalid email provided to getEmployeeDetailsByEmail');
        throw new Error('Invalid email provided');
      }

      const encodedEmail = encodeURIComponent(email.trim());
      const url = `${config.mettleApiBaseUrl}/api/employee/details?email=${encodedEmail}`;

      logger.info(`Fetching employee details from Mettle for email: ${email}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'mettleToken': config.mettleToken,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.warn(`Employee not found in Mettle for email: ${email}`);
          return null;
        }

        const errorText = await response.text();
        logger.error(
          `Mettle API error for email ${email}: ${response.status} - ${errorText}`
        );
        throw new Error(`Mettle API returned ${response.status}: ${errorText}`);
      }

      const employeeData = await response.json() as MettleEmployeeDetails;

      logger.info(`Successfully fetched employee details for email: ${email}`);
      return employeeData;
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error fetching employee details from Mettle: ${error.message}`);
      } else {
        logger.error('Unknown error fetching employee details from Mettle');
      }
      throw error;
    }
  }
}

export const mettleEmployeeDetailsService = MettleEmployeeDetailsService.getInstance();
