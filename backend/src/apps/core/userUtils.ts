import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { UserResponse } from '../types';

/**
 * Get user data by user ID
 * 
 * @param userId - User ID to fetch data for (required)
 * @returns User data with name, email, picture, userType, status, and joined date
 */
export async function getUserData(userId: string): Promise<UserResponse> {
  try {
    const user = await repositories.users.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      picture: user.picture,
      userType: user.userType,
      status: user.status,
      joined: user.createdAt,
    };
  } catch (error) {
    logger.error('[USER-UTILS] Error fetching user data:', error);
    throw error;
  }
}
