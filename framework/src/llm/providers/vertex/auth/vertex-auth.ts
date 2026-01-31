import { GoogleAuth, type GoogleAuthOptions } from 'google-auth-library';
import type { AuthProvider, AuthResult } from '../../../core/types/providers.js';
import type { VertexAuthConfig } from '../schemas.js';
import { logger } from '../../../../utils/logger.js';
import {
  LLMErrorClass,
  createProviderAuthError,
  isLLMErrorClass
} from '../../../core/errors/index.js';

/**
 * Vertex AI authentication provider
 * Supports multiple authentication methods: Service Account, ADC, and direct token
 */
export class VertexAuth implements AuthProvider {
  private auth: GoogleAuth;
  private currentToken: string | undefined;
  private tokenExpiresAt: Date | undefined;
  private readonly config: VertexAuthConfig;
  private readonly PROVIDER_NAME = 'vertex';

  // Default scopes for Vertex AI
  private readonly DEFAULT_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/generative-language'
  ];

  constructor(config: VertexAuthConfig) {
    this.config = config;
    this.auth = this.createGoogleAuth();
    
    logger.debug('Vertex auth initialized', {
      type: config.type,
      projectId: config.projectId,
      region: config.region
    });
  }

  /**
   * Authenticate with Vertex AI
   */
  public async authenticate(): Promise<AuthResult> {
    try {
      logger.debug('Starting Vertex authentication', {
        type: this.config.type,
        projectId: this.config.projectId
      });

      switch (this.config.type) {
        case 'service-account':
          return await this.authenticateWithServiceAccount();
        case 'adc':
          return await this.authenticateWithADC();
        case 'token':
          return await this.authenticateWithToken();
        default:
          throw new Error(`Unsupported auth type: ${String(this.config.type)}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      
      // Sanitize error message to avoid credential exposure
      const sanitizedMessage = this.sanitizeErrorMessage(errorMessage);
      
      logger.error('Vertex authentication failed', error as Error, {
        type: this.config.type,
        projectId: this.config.projectId
      });

      if (isLLMErrorClass(error)) {
        throw error;
      }

      throw new LLMErrorClass(createProviderAuthError(
        this.PROVIDER_NAME,
        sanitizedMessage,
        {
          authMethod: this.config.type,
          context: { projectId: this.config.projectId }
        }
      ));
    }
  }

  /**
   * Check if currently authenticated
   */
  public isAuthenticated(): boolean {
    if (!this.currentToken) {
      return false;
    }

    if (this.tokenExpiresAt && new Date() >= this.tokenExpiresAt) {
      logger.debug('Token expired, marking as unauthenticated');
      this.currentToken = undefined;
      this.tokenExpiresAt = undefined;
      return false;
    }

    return true;
  }

  /**
   * Get current access token
   */
  public async getToken(): Promise<string> {
    if (!this.isAuthenticated()) {
      const result = await this.authenticate();
      if (!result.success || !result.token) {
        throw new LLMErrorClass(createProviderAuthError(
          this.PROVIDER_NAME,
          'Failed to obtain access token',
          { authMethod: this.config.type }
        ));
      }
    }

    return this.currentToken!;
  }

  /**
   * Refresh the current token
   */
  public async refreshToken(): Promise<string> {
    logger.debug('Refreshing Vertex token');
    
    try {
      const token = await this.auth.getAccessToken();
      
      if (!token) {
        throw new Error('Failed to refresh token - no token returned');
      }

      this.currentToken = token;
      // Most Google tokens expire in 1 hour, set expiry to 55 minutes to be safe
      this.tokenExpiresAt = new Date(Date.now() + 55 * 60 * 1000);
      
      logger.debug('Token refreshed successfully', {
        expiresAt: this.tokenExpiresAt,
        projectId: this.config.projectId
      });

      return token;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Token refresh failed';
      const sanitizedMessage = this.sanitizeErrorMessage(errorMessage);
      
      throw new LLMErrorClass(createProviderAuthError(
        this.PROVIDER_NAME,
        sanitizedMessage,
        { authMethod: 'refresh' }
      ));
    }
  }

  /**
   * Validate credentials without full authentication
   */
  public async validateCredentials(): Promise<boolean> {
    try {
      // Try to get a token without storing it
      const tempAuth = this.createGoogleAuth();
      const token = await tempAuth.getAccessToken();
      return !!token;
    } catch {
      return false;
    }
  }

  /**
   * Get project ID from configuration
   */
  public getProjectId(): string {
    return this.config.projectId;
  }

  /**
   * Get region from configuration
   */
  public getRegion(): string {
    return this.config.region;
  }

  /**
   * Private authentication methods
   */
  private async authenticateWithServiceAccount(): Promise<AuthResult> {
    if (!this.config.keyFile && !this.config.credentials) {
      throw new Error('Service account authentication requires keyFile or credentials');
    }

    try {
      const token = await this.auth.getAccessToken();
      
      if (!token) {
        throw new Error('Failed to obtain access token from service account');
      }

      this.currentToken = token;
      this.tokenExpiresAt = new Date(Date.now() + 55 * 60 * 1000); // 55 minutes

      logger.debug('Service account authentication successful', {
        projectId: this.config.projectId,
        expiresAt: this.tokenExpiresAt
      });

      return {
        success: true,
        token,
        expiresAt: this.tokenExpiresAt,
        metadata: {
          authMethod: this.config.type,
          projectId: this.config.projectId
        }
      };
    } catch (error) {
      throw new Error(`Service account authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async authenticateWithADC(): Promise<AuthResult> {
    try {
      // Application Default Credentials
      const token = await this.auth.getAccessToken();
      
      if (!token) {
        throw new Error('Failed to obtain access token using Application Default Credentials');
      }

      this.currentToken = token;
      this.tokenExpiresAt = new Date(Date.now() + 55 * 60 * 1000);

      logger.debug('ADC authentication successful', {
        projectId: this.config.projectId,
        expiresAt: this.tokenExpiresAt
      });

      return {
        success: true,
        token,
        expiresAt: this.tokenExpiresAt,
        metadata: {
          authMethod: this.config.type,
          projectId: this.config.projectId
        }
      };
    } catch (error) {
      throw new Error(`ADC authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async authenticateWithToken(): Promise<AuthResult> {
    if (!this.config.token) {
      throw new Error('Token authentication requires a token');
    }

    this.currentToken = this.config.token;
    // For direct tokens, we don't know the expiry, so assume it's valid for 1 hour
    this.tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    logger.debug('Direct token authentication successful', {
      projectId: this.config.projectId,
      expiresAt: this.tokenExpiresAt
    });

    return {
      success: true,
      token: this.config.token,
      expiresAt: this.tokenExpiresAt,
      metadata: {
        authMethod: this.config.type,
        projectId: this.config.projectId
      }
    };
  }

  /**
   * Create Google Auth instance based on configuration
   */
  private createGoogleAuth(): GoogleAuth {
    const authOptions: GoogleAuthOptions = {
      scopes: this.config.scopes || this.DEFAULT_SCOPES,
      projectId: this.config.projectId
    };

    // Configure based on auth type
    switch (this.config.type) {
      case 'service-account':
        if (this.config.keyFile) {
          authOptions.keyFile = this.config.keyFile;
        } else if (this.config.credentials) {
          authOptions.credentials = this.config.credentials;
        }
        break;
      case 'adc':
        // No additional configuration needed for ADC
        break;
      case 'token':
        // Direct token will be handled separately
        break;
    }

    return new GoogleAuth(authOptions);
  }

  /**
   * Create authorization header for API requests
   */
  public async getAuthorizationHeader(): Promise<string> {
    const token = await this.getToken();
    return `Bearer ${token}`;
  }

  /**
   * Validate project ID access
   */
  public async validateProjectAccess(): Promise<boolean> {
    try {
      await this.auth.getClient();
      const projectId = await this.auth.getProjectId();
      
      if (projectId !== this.config.projectId) {
        logger.warn('Project ID mismatch', {
          configured: this.config.projectId,
          detected: projectId
        });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Project access validation failed', error as Error);
      return false;
    }
  }

  /**
   * Sanitize error messages to prevent credential exposure
   */
  private sanitizeErrorMessage(message: string): string {
    // Remove potential sensitive data patterns
    const sensitivePatterns = [
      /private_key["\s:=]+[^"\s,}]*/gi,
      /client_secret["\s:=]+[^"\s,}]*/gi,
      /token["\s:=]+[^"\s,}]*/gi,
      /key["\s:=]+[^"\s,}]*/gi,
      /bearer\s+[^\s]*/gi,
      /ya29\.[a-zA-Z0-9_-]*/gi, // Google access tokens
      /"[A-Za-z0-9+/]{20,}={0,2}"/g // Base64 encoded data
    ];

    let sanitized = message;
    for (const pattern of sensitivePatterns) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }

    return sanitized;
  }
}