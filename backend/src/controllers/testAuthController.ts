import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { UserService } from '@/services/userService';
import { UserSessionService } from '@/services/userSessionService';
import { jwtService } from '@/services/jwtService';
import { DatabaseClient } from '@/database/client';
import { AccessType, AuthProvider } from '@prisma/client';

/**
 * Test-only authentication endpoints that bypass Google OAuth.
 * @security NEVER expose in production!
 */
export class TestAuthController {
    private userService: UserService;
    private userSessionService: UserSessionService;

    // Auto-incrementing user index - starts from timestamp to avoid collisions after server restart
    private static userIndex = Date.now();

    // Shared org and workspace for all test users (created on first login)
    private static testOrgId: string | null = null;
    private static testWorkspaceId: string | null = null;

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
            const enableDevAuth = process.env.ENABLE_DEV_AUTH === 'true' && process.env.NODE_ENV === 'development';
            if (!config.isTestEnv && !enableDevAuth) {
                logger.error(`[${requestId}] Test login attempted in non-test environment!`);
                res.status(403).json({
                    error: 'Forbidden',
                    message: 'Test authentication is only available in test environment',
                });
                return;
            }

            const isAdmin = req.body.isAdmin === true || req.query.isAdmin === 'true';

            let testUserData;
            if (enableDevAuth && process.env.DEFAULT_ADMIN_EMAIL) {
                const adminEmail = process.env.DEFAULT_ADMIN_EMAIL;
                const emailUser = adminEmail.split('@')[0];
                const name = emailUser.split(/[.\-_]/).map((part: string) =>
                    part.charAt(0).toUpperCase() + part.slice(1)
                ).join(' ');
                testUserData = {
                    googleId: `dev-admin-${adminEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
                    email: adminEmail,
                    name: name || 'Sandbox Admin',
                    picture: `https://ui-avatars.com/api/?name=Sandbox+Admin&background=random`,
                };
            } else {
                TestAuthController.userIndex++;
                testUserData = TestAuthController.generateTestUser(TestAuthController.userIndex);
            }

            let organization: any;
            let workspace: any;
            let user: any;
            let isNewUser = true;
            const db = DatabaseClient.getInstance();

            // Recover org/workspace IDs from DB if lost after server restart
            if (!TestAuthController.testOrgId) {
                const existingOrg = await db.organization.findUnique({
                    where: { name: 'Test Org' },
                });
                if (existingOrg) {
                    const existingWorkspace = await db.workspace.findFirst({
                        where: { orgId: existingOrg.orgId },
                    });
                    if (existingWorkspace) {
                        TestAuthController.testOrgId = existingOrg.orgId;
                        TestAuthController.testWorkspaceId = existingWorkspace.id;
                        logger.info(`[${requestId}] Recovered test org/workspace IDs from DB after restart`);
                    }
                }
            }

            if (!TestAuthController.testOrgId) {
                // First test login: create org + workspace + user
                logger.info(`[${requestId}] First test login - creating org, workspace, and user: ${testUserData.email}`);

                const orgName = `Test Org`;
                const workspaceName = `Test Workspace`;

                const result = await this.userService.createOrganizationWithUser(
                    {
                        providerUserId: testUserData.googleId,
                        email: testUserData.email,
                        name: testUserData.name,
                        picture: testUserData.picture,
                    },
                    orgName,
                    workspaceName,
                    'GOOGLE'
                );

                organization = result.organization;
                workspace = result.workspace;
                user = result.workspaceUser;

                // Store org and workspace IDs for subsequent logins
                TestAuthController.testOrgId = organization.orgId;
                TestAuthController.testWorkspaceId = workspace.id;
            } else {
                // Subsequent test logins: reuse existing org + workspace, just create a new user
                logger.info(`[${requestId}] Subsequent test login - adding user to existing org/workspace: ${testUserData.email}`);

                organization = await db.organization.findUnique({
                    where: { orgId: TestAuthController.testOrgId! }
                });
                workspace = await db.workspace.findUnique({
                    where: { id: TestAuthController.testWorkspaceId! }
                });

                // Fetch existing orgMember by email
                let orgMember = await db.orgMember.findUnique({
                    where: { email: testUserData.email },
                    select: { memberId: true }
                });

                // Create OrgMember if it doesn't exist
                if (!orgMember) {
                    orgMember = await db.orgMember.create({
                        data: {
                            orgId: TestAuthController.testOrgId!,
                            email: testUserData.email,
                            role: 'MEMBER',
                        },
                        select: { memberId: true }
                    });
                }

                // Create user in the existing workspace (or reuse if already exists)
                let existingUser = await db.user.findFirst({
                    where: { email: testUserData.email, workspaceId: TestAuthController.testWorkspaceId! },
                });
                if (existingUser) {
                    user = existingUser;
                    isNewUser = false;
                } else {
                    user = await db.user.create({
                        data: {
                            providerUserId: testUserData.googleId,
                            email: testUserData.email,
                            name: testUserData.name,
                            picture: testUserData.picture,
                            authProvider: 'GOOGLE' as AuthProvider,
                            workspace: { connect: { id: TestAuthController.testWorkspaceId! } },
                            role: 'MEMBER',
                            orgMemberId: orgMember.memberId,
                        },
                    });
                }
            }

            logger.info(`[${requestId}] Org ${organization.orgId}, workspace ${workspace.id}, user ${user.id}`);

            if (isAdmin) {
                try {
                    // Grant admin access to all resources for comprehensive testing

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

            // Email is globally unique in orgMember, single lookup is sufficient
            const orgMember = await db.orgMember.findUnique({
                where: { email: user.email },
            });
            if (!orgMember) {
                throw new Error(`User ${user.email} is not a member of any organization`);
            }
            
            const customToken = jwtService.generateToken({
                sub: user.id,
                email: user.email,
                name: user.name,
                picture: testUserData.picture,
                workspaceId: user.workspaceId,
                memberId: orgMember.memberId,
            });

            let sessionId = null;
            try {
                logger.info(`[${requestId}] Creating test user session`);

                const refreshTokenExpiry = new Date();
                refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + config.session.expiryDays);

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

            // Set workspace-scoped JWT token (matches authV2Middleware expectation)
            res.cookie(`xyne_ws_${user.workspaceId}_token`, customToken, {
                ...cookieOptions,
                maxAge: 24 * 60 * 60 * 1000,
            });

            // Set last workspace pointer so authV2Middleware can find the right token
            res.cookie('xyne_last_workspace', user.workspaceId, {
                ...cookieOptions,
                maxAge: 30 * 24 * 60 * 60 * 1000,
            });

            if (sessionId) {
                res.cookie('xyne_session', sessionId, {
                    ...cookieOptions,
                    maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
                });
            }

            if (isNewUser) {
                res.cookie('is_new_user', 'true', {
                    httpOnly: false,
                    secure: false,
                    sameSite: 'strict',
                    path: '/',
                    maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
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
                    workspaceId: user.workspaceId,
                    role: user.role,
                    orgRole: orgMember.role,
                    memberId: orgMember.memberId,
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

    testLogout = async (req: Request, res: Response): Promise<void> => {
        const requestId = `TEST_LOGOUT_${Date.now()}`;

        try {
            logger.info(`[${requestId}] Test logout initiated`);

            // Clear all workspace-scoped token cookies
            for (const cookieName of Object.keys(req.cookies || {})) {
                if (cookieName.startsWith('xyne_ws_') && cookieName.endsWith('_token')) {
                    res.clearCookie(cookieName, { path: '/' });
                }
            }
            res.clearCookie('xyne_last_workspace', { path: '/' });
            res.clearCookie('xyne_session', { path: '/' });
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
