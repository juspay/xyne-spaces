import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { UserService } from '@/services/userService';
import { UserSessionService } from '@/services/userSessionService';
import { jwtService } from '@/services/jwtService';
import { DatabaseClient } from '@/database/client';
import { AccessType } from '@prisma/client';

/**
 * Test-only authentication endpoints that bypass Google OAuth.
 * @security NEVER expose in production!
 */
export class TestAuthController {
    private userService: UserService;
    private userSessionService: UserSessionService;

    // Auto-incrementing user index - same counter pattern used in testing framework
    private static userIndex = 0;

    static generateTestUser(index: number) {
        return {
            googleId: `test-user-id-${index}`,
            email: `test-user-email-${index}@xyne-test.local`,
            name: `Test User ${index}`,
            picture: `https://ui-avatars.com/api/?name=User+${index}&background=random`,
        };
    }

    constructor() {
        this.userService = new UserService();
        this.userSessionService = new UserSessionService();
    }


    testLogin = async (req: Request, res: Response): Promise<void> => {
        const requestId = `TEST_LOGIN_${Date.now()}`;

        try {
            if (!config.isTestEnv) {
                logger.error(`[${requestId}] Test login attempted in non-test environment!`);
                res.status(403).json({
                    error: 'Forbidden',
                    message: 'Test authentication is only available in test environment',
                });
                return;
            }

            const isAdmin = req.body.isAdmin === true || req.query.isAdmin === 'true';

            logger.info(`[${requestId}] Test login initiated (isAdmin: ${isAdmin})`);

            TestAuthController.userIndex++;
            const testUserData = TestAuthController.generateTestUser(TestAuthController.userIndex);

            logger.info(`[${requestId}] Finding/creating test user: ${testUserData.email}`);
            const { user, isNewUser } = await this.userService.findOrCreateUser(testUserData);
            logger.info(`[${requestId}] User resolved: ${user.email} (ID: ${user.id}, isNew: ${isNewUser})`);

            if (isAdmin) {
                try {
                    const db = DatabaseClient.getInstance();
                    const defaultOrg = await db.organization.findUnique({
                        where: { name: 'default' }
                    });

                    if (defaultOrg) {
                        const existingMember = await db.orgMember.findUnique({
                            where: {
                                orgId_userId: {
                                    orgId: defaultOrg.orgId,
                                    userId: user.id
                                }
                            }
                        });

                        if (!existingMember) {
                            await db.orgMember.create({
                                data: {
                                    orgId: defaultOrg.orgId,
                                    userId: user.id,
                                    role: 'OWNER'
                                }
                            });
                            logger.info(`[${requestId}] Added user ${user.email} as OWNER of default organization`);
                        } else {
                            await db.orgMember.update({
                                where: {
                                    orgId_userId: {
                                        orgId: defaultOrg.orgId,
                                        userId: user.id
                                    }
                                },
                                data: {
                                    role: 'OWNER'
                                }
                            });
                            logger.info(`[${requestId}] Updated user ${user.email} to OWNER of default organization`);
                        }
                    } else {
                        logger.warn(`[${requestId}] Default organization not found`);
                    }

                   const essentialResources = [
                        { name: 'TICKETS', description: 'Ticket management endpoints' },
                        { name: 'KNOWLEDGE-BASE', description: 'Knowledge base management' },
                        { name: 'ANALYTICS', description: 'Analytics and reporting' },
                        { name: 'USER-GROUPS', description: 'User group management' },
                        { name: 'LISTPROJECTS', description: 'Project list view' },
                        { name: 'USERS', description: 'User management endpoints' },
                        { name: 'FORMS', description: 'Form management' },
                        { name: 'SUPPORT', description: 'Support ticket management' },
                        { name: 'PRODUCT-INSIGHTS', description: 'Product insights and analytics' },
                        { name: 'PROJECTS', description: 'Project board management' },
                    ];

                    for (const resourceData of essentialResources) {
                        const existingResource = await db.resource.findUnique({
                            where: { name: resourceData.name }
                        });

                        if (!existingResource) {
                            await db.resource.create({
                                data: resourceData
                            });
                            logger.info(`[${requestId}] Created essential resource: ${resourceData.name}`);
                        }
                    }

                    const resources = await db.resource.findMany();
                    for (const resource of resources) {
                        const existingAccess = await db.resourceAccess.findFirst({
                            where: {
                                userId: user.id,
                                resourceId: resource.id
                            }
                        });

                        if (!existingAccess) {
                            await db.resourceAccess.create({
                                data: {
                                    userId: user.id,
                                    resourceId: resource.id,
                                    accessType: AccessType.ADMIN
                                }
                            });
                            logger.info(`[${requestId}] Granted ADMIN access to resource ${resource.name} for user ${user.email}`);
                        } else if (existingAccess.accessType !== AccessType.ADMIN) {
                            await db.resourceAccess.update({
                                where: { id: existingAccess.id },
                                data: { accessType: AccessType.ADMIN }
                            });
                            logger.info(`[${requestId}] Updated access to ADMIN for resource ${resource.name} for user ${user.email}`);
                        }
                    }
                } catch (orgError) {
                    logger.error(`[${requestId}] Failed to add user to default organization or grant admin access:`, orgError);
                }
            }

            const customToken = jwtService.generateToken({
                sub: user.id,
                email: user.email,
                name: user.name,
                picture: testUserData.picture,
            });

            let sessionId = null;
            try {
                logger.info(`[${requestId}] Creating test user session`);

                const refreshTokenExpiry = new Date();
                refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

                const deviceInfo = JSON.stringify({
                    userAgent: req.headers['user-agent'] || 'Test Automation',
                    timestamp: new Date().toISOString(),
                    platform: 'test',
                });

                const refreshToken = `test-${randomBytes(32).toString('hex')}-${Date.now()}`;

                const session = await this.userSessionService.createSession({
                    userId: user.id,
                    refreshToken,
                    refreshTokenExpiry,
                    deviceInfo,
                    ipAddress: req.ip || '127.0.0.1',
                });

                sessionId = session.id;
                logger.info(`[${requestId}] Session created: ${sessionId}`);
            } catch (sessionError) {
                logger.error(`[${requestId}] Session creation failed:`, sessionError);
            }

            const cookieOptions = {
                httpOnly: true,
                secure: false,
                sameSite: 'strict' as const,
                path: '/',
            };

            res.cookie('google_access_token', customToken, {
                ...cookieOptions,
                maxAge: 24 * 60 * 60 * 1000,
            });

            if (sessionId) {
                res.cookie('user_session_id', sessionId, {
                    ...cookieOptions,
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                });
            }

            if (isNewUser) {
                res.cookie('is_new_user', 'true', {
                    httpOnly: false,
                    secure: false,
                    sameSite: 'strict',
                    path: '/',
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                });
            }

            logger.info(`[${requestId}] Test login successful for: ${user.email}`);

            res.status(200).json({
                success: true,
                message: 'Test login successful',
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    isNewUser,
                },
                sessionId,
            });
        } catch (error) {
            logger.error(`[${requestId}] Test login failed:`, error);

            res.status(500).json({
                error: 'Test login failed',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };

    testLogout = async (_req: Request, res: Response): Promise<void> => {
        const requestId = `TEST_LOGOUT_${Date.now()}`;

        try {
            logger.info(`[${requestId}] Test logout initiated`);

            res.clearCookie('google_access_token', { path: '/' });
            res.clearCookie('user_session_id', { path: '/' });
            res.clearCookie('is_new_user', { path: '/' });

            res.status(200).json({
                success: true,
                message: 'Test logout successful',
            });
        } catch (error) {
            logger.error(`[${requestId}] Test logout failed:`, error);

            res.status(500).json({
                error: 'Test logout failed',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };
}
