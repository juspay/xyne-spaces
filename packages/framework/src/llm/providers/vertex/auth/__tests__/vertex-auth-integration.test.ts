import { VertexAuth } from '../vertex-auth.js';
import type { VertexAuthConfig } from '../../schemas.js';

describe('VertexAuth Integration Tests', () => {
  let vertexAuth: VertexAuth;
  
  // Skip tests if no credentials are provided
  const shouldSkipTests = !process.env['VERTEX_PROJECT_ID'];
  
  beforeEach(() => {
    if (shouldSkipTests) {
      return;
    }
    
    const config: VertexAuthConfig = {
      type: process.env['VERTEX_USE_ADC'] === 'true' ? 'adc' : 'service-account',
      projectId: process.env['VERTEX_PROJECT_ID']!,
      region: process.env['VERTEX_REGION'] || 'us-central1',
      ...(process.env['VERTEX_KEY_FILE'] && { keyFile: process.env['VERTEX_KEY_FILE'] })
    };
    
    vertexAuth = new VertexAuth(config);
  });

  describe('Service Account Authentication', () => {
    (shouldSkipTests ? it.skip : it)('should authenticate with valid service account', async () => {
      const result = await vertexAuth.authenticate();
      
      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token).not.toBe('stub-token'); // Ensure real token
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!['authMethod']).toBe(process.env['VERTEX_USE_ADC'] === 'true' ? 'adc' : 'service-account');
      expect(vertexAuth.isAuthenticated()).toBe(true);
    });

    (shouldSkipTests ? it.skip : it)('should get valid authorization header', async () => {
      await vertexAuth.authenticate();
      const header = await vertexAuth.getAuthorizationHeader();
      
      expect(header).toMatch(/^Bearer /);
      expect(header).not.toContain('stub-token');
      // Google access tokens typically start with 'ya29.'
      expect(header).toMatch(/Bearer ya29\./);
    });

    (shouldSkipTests ? it.skip : it)('should handle token refresh', async () => {
      await vertexAuth.authenticate();
      await vertexAuth.getToken();
      
      // Force token expiration by manipulating internal state
      // Note: This accesses private property for testing purposes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (vertexAuth as any).tokenExpiresAt = new Date(Date.now() - 1000);
      
      // Call refreshToken explicitly to force a refresh
      const refreshedToken = await vertexAuth.refreshToken();
      expect(refreshedToken).toBeDefined();
      // Token might be the same if Google returns cached token, but method should work
      expect(typeof refreshedToken).toBe('string');
      expect(refreshedToken.length).toBeGreaterThan(0);
      expect(refreshedToken).toMatch(/^ya29\./); // Verify it's a real Google token
    });

    (shouldSkipTests ? it.skip : it)('should validate project access', async () => {
      await vertexAuth.authenticate();
      const hasAccess = await vertexAuth.validateProjectAccess();
      
      expect(hasAccess).toBe(true);
    });

    (shouldSkipTests ? it.skip : it)('should validate credentials without full authentication', async () => {
      const isValid = await vertexAuth.validateCredentials();
      
      expect(isValid).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid service account gracefully', async () => {
      const invalidConfig: VertexAuthConfig = {
        type: 'service-account',
        projectId: 'invalid-project',
        region: 'us-central1',
        keyFile: 'invalid-key.json'
      };
      
      const invalidAuth = new VertexAuth(invalidConfig);
      
      await expect(invalidAuth.authenticate()).rejects.toThrow();
      expect(invalidAuth.isAuthenticated()).toBe(false);
    });

    it('should not expose credentials in error messages', async () => {
      const invalidConfig: VertexAuthConfig = {
        type: 'service-account',
        projectId: 'test-project',
        region: 'us-central1',
        credentials: { 
          type: 'service_account',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          private_key: 'secret-key-data-12345',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          client_email: 'test@example.com'
        }
      };

      const invalidAuth = new VertexAuth(invalidConfig);
      
      try {
        await invalidAuth.authenticate();
        // Should throw an error
        expect(true).toBe(false);
      } catch (error) {
        const errorMessage = (error as Error).message;
        expect(errorMessage).not.toContain('secret-key-data-12345');
        expect(errorMessage).not.toContain('private_key');
        // Basic error message should not contain sensitive data
        expect(errorMessage).toBeDefined();
      }
    });

    it('should handle missing credentials appropriately', async () => {
      const configWithoutCreds: VertexAuthConfig = {
        type: 'service-account',
        projectId: 'test-project',
        region: 'us-central1'
        // Missing keyFile and credentials
      };

      const auth = new VertexAuth(configWithoutCreds);
      
      await expect(auth.authenticate()).rejects.toThrow(
        'Service account authentication requires keyFile or credentials'
      );
    });
  });

  describe('Security Validation', () => {
    it('should sanitize error messages containing sensitive patterns', () => {
      const auth = new VertexAuth({
        type: 'service-account',
        projectId: 'test',
        region: 'us-central1',
        keyFile: 'test.json'
      });

      // Test the private sanitizeErrorMessage method
      const sensitiveMessage = 'Error: private_key="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg..." token="ya29.a0ARrdaM-abc123"';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const sanitized = (auth as any).sanitizeErrorMessage(sensitiveMessage);
      
      expect(sanitized).not.toContain('BEGIN PRIVATE KEY');
      expect(sanitized).not.toContain('ya29.a0ARrdaM-abc123');
      expect(sanitized).toContain('[REDACTED]');
    });

    it('should prevent token exposure in logs during authentication', async () => {
      // This test ensures tokens aren't accidentally logged
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      try {
        const invalidAuth = new VertexAuth({
          type: 'service-account',
          projectId: 'invalid',
          region: 'us-central1',
          keyFile: 'invalid.json'
        });
        
        try {
          await invalidAuth.authenticate();
        } catch {
          // Expected to fail
        }
        
        // Check that no sensitive data was logged
        const allLogs = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
        expect(allLogs).not.toMatch(/ya29\.[a-zA-Z0-9_-]+/); // Google tokens
        expect(allLogs).not.toMatch(/private_key/i);
        
      } finally {
        logSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });
});
