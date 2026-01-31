import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { authMiddleware } from '../middleware/auth';
import { apiKeyService } from '../services/apiKeyService';
import { CreateApiKeyRequest } from '../types/express';

const router = Router();

/**
 * Get available API key scopes
 * GET /api/admin/api-keys/scopes
 */
router.get('/scopes', authMiddleware.authenticate, authMiddleware.requireAdmin, (_req: Request, res: Response) => {
  try {
    const scopes = apiKeyService.getAvailableScopes();
    res.json({
      scopes,
      totalCount: scopes.length
    });
  } catch (error) {
    logger.error('Error getting API key scopes:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to get available scopes'
    });
  }
});

/**
 * List all API keys
 * GET /api/admin/api-keys
 */
router.get('/', authMiddleware.authenticate, authMiddleware.requireAdmin, async (_req: Request, res: Response) => {
  try {
    const apiKeys = await apiKeyService.listApiKeys();
    res.json({
      apiKeys,
      totalCount: apiKeys.length,
      activeCount: apiKeys.filter(key => key.isActive).length
    });
  } catch (error) {
    logger.error('Error listing API keys:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to list API keys'
    });
  }
});

/**
 * Create a new API key
 * POST /api/admin/api-keys/create
 */
router.post('/create', authMiddleware.authenticate, authMiddleware.requireAdmin, async (req: Request, res: Response) => {
  try {
    const createRequest: CreateApiKeyRequest = req.body;

    // Validate required fields
    if (!createRequest.name || !createRequest.scopes || createRequest.scopes.length === 0) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Name and scopes are required'
      });
    }

    // Validate scopes
    const scopeValidation = apiKeyService.validateScopes(createRequest.scopes);
    if (!scopeValidation.valid) {
      return res.status(400).json({
        error: 'Invalid scopes',
        message: 'Invalid scopes provided',
        invalidScopes: scopeValidation.invalidScopes,
        validScopes: apiKeyService.getAvailableScopes().map(s => s.scope)
      });
    }

    // Validate expiration
    if (createRequest.expiresInDays && (createRequest.expiresInDays < 1 || createRequest.expiresInDays > 365)) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Expiration must be between 1 and 365 days'
      });
    }

    const apiKeyResponse = await apiKeyService.createApiKey(createRequest, req.user!.id);

    logger.info(`API key created: ${createRequest.name} by user ${req.user!.email}`);

    return res.status(201).json({
      message: 'API key created successfully',
      apiKey: apiKeyResponse,
      warning: 'Store this API key securely - it will not be shown again!'
    });

  } catch (error) {
    logger.error('Error creating API key:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Failed to create API key'
    });
  }
});

/**
 * Revoke an API key
 * DELETE /api/admin/api-keys/:keyId
 */
router.delete('/:keyId', authMiddleware.authenticate, authMiddleware.requireAdmin, async (req: Request, res: Response) => {
  try {
    const { keyId } = req.params;

    if (!keyId) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Key ID is required'
      });
    }

    const success = await apiKeyService.revokeApiKey(keyId, req.user!.id);

    if (!success) {
      return res.status(404).json({
        error: 'Not found',
        message: 'API key not found'
      });
    }

    logger.info(`API key revoked: ${keyId} by user ${req.user!.email}`);

    return res.json({
      message: 'API key revoked successfully',
      keyId
    });

  } catch (error) {
    logger.error('Error revoking API key:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Failed to revoke API key'
    });
  }
});

/**
 * Get API key configuration status
 * GET /api/admin/api-keys/status
 */
router.get('/status', authMiddleware.authenticate, authMiddleware.requireAdmin, async (_req: Request, res: Response) => {
  try {
    const apiKeys = await apiKeyService.listApiKeys();

    res.json({
      enabled: true, // Always enabled when using database
      totalKeys: apiKeys.length,
      databaseKeys: apiKeys.length,
      activeKeys: apiKeys.filter(key => key.isActive).length,
      configuration: {
        hasEnvironmentConfig: false,
        supportsDynamicCreation: true,
        supportsRevocation: true,
        note: 'API keys are stored in database with full CRUD support'
      }
    });
  } catch (error) {
    logger.error('Error getting API key status:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to get API key status'
    });
  }
});

/**
 * Test API key endpoint (for testing purposes)
 * GET /api/test/api-key
 */
router.get('/test', authMiddleware.authenticate, authMiddleware.requireScope('tickets:read'), (req: Request, res: Response) => {
  try {
    const user = req.user!;
    
    res.json({
      message: 'API key authentication test successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isApiKeyUser: user.isApiKeyUser,
        role: user.role,
        scopes: user.scopes
      },
      timestamp: new Date().toISOString(),
      endpoint: 'API Key Test'
    });
  } catch (error) {
    logger.error('Error in API key test:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'API key test failed'
    });
  }
});

export default router;