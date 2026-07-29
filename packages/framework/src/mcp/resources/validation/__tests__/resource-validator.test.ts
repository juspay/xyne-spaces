/**
 * Tests for ResourceValidator
 */

import { ResourceValidator } from '../resource-validator.js';
import type { MCPResource, MCPResourceResult } from '../../../core/types/framework.js';
import type { CatalogEntry, ValidationRule } from '../../types/index.js';

// Mock logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('ResourceValidator', () => {
  let validator: ResourceValidator;

  const mockResource: MCPResource = {
    uri: 'file:///test.txt',
    name: 'test.txt',
    description: 'A test file',
    mimeType: 'text/plain'
  };

  const mockCatalogEntry: CatalogEntry = {
    resource: mockResource,
    metadata: {
      uri: 'file:///test.txt',
      name: 'test.txt',
      serverName: 'server1',
      discoveredAt: new Date()
    }
  };

  const mockResourceContent: MCPResourceResult = {
    contents: [{ uri: 'text', text: 'Hello, world!' }],
    mimeType: 'text/plain'
  };

  beforeEach(() => {
    validator = new ResourceValidator();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateResource', () => {
    it('should validate a valid resource successfully', () => {
      const result = validator.validateResource(mockCatalogEntry, mockResourceContent);

      expect(result.valid).toBe(true);
      expect(result.uri).toBe('file:///test.txt');
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.rulePassed).toBeGreaterThan(0);
      expect(result.rulesFailed).toBe(0);
      expect(result.validatedAt).toBeInstanceOf(Date);
    });

    it('should detect invalid URI format', () => {
      const invalidResource: MCPResource = {
        uri: '', // Invalid empty URI
        name: 'test.txt',
        mimeType: 'text/plain'
      };

      const entry: CatalogEntry = {
        resource: invalidResource,
        metadata: {
          uri: '',
          serverName: 'server1',
          discoveredAt: new Date()
        }
      };

      const result = validator.validateResource(entry);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain('URI is required');
      expect(result.errors[0]?.severity).toBe('high');
    });

    it('should detect invalid MIME type format', () => {
      const invalidResource: MCPResource = {
        uri: 'file:///test.txt',
        name: 'test.txt',
        mimeType: 'invalid-mime-type' // Invalid MIME type
      };

      const entry: CatalogEntry = {
        resource: invalidResource,
        metadata: {
          uri: 'file:///test.txt',
          serverName: 'server1',
          discoveredAt: new Date()
        }
      };

      const result = validator.validateResource(entry);

      expect(result.valid).toBe(true); // Should be valid but with warnings
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.message).toContain('Invalid MIME type');
      expect(result.warnings[0]?.severity).toBe('low');
    });

    it('should validate resource size limits', () => {
      const largeContent = 'x'.repeat(60 * 1024 * 1024); // 60MB content
      const largeResourceContent: MCPResourceResult = {
        contents: [{ uri: 'text', text: largeContent }],
        mimeType: 'text/plain'
      };

      const result = validator.validateResource(mockCatalogEntry, largeResourceContent);

      expect(result.valid).toBe(true); // Valid but with warnings
      expect(result.warnings.some(w => w.message?.includes('size'))).toBe(true);
    });

    it('should validate JSON content integrity', () => {
      const jsonResource: MCPResource = {
        uri: 'file:///config.json',
        name: 'config.json',
        mimeType: 'application/json'
      };

      const invalidJsonContent: MCPResourceResult = {
        contents: [{ uri: 'text', text: '{ invalid json }' }],
        mimeType: 'application/json'
      };

      const entry: CatalogEntry = {
        resource: jsonResource,
        metadata: {
          uri: 'file:///config.json',
          serverName: 'server1',
          discoveredAt: new Date()
        }
      };

      const result = validator.validateResource(entry, invalidJsonContent);

      expect(result.valid).toBe(true); // Valid but with warnings
      expect(result.warnings.some(w => w.message?.includes('Invalid JSON content'))).toBe(true);
    });

    it('should detect security issues in URI', () => {
      const dangerousResource: MCPResource = {
        uri: 'javascript:alert("xss")',
        name: 'dangerous.js',
        mimeType: 'application/javascript'
      };

      const entry: CatalogEntry = {
        resource: dangerousResource,
        metadata: {
          uri: 'javascript:alert("xss")',
          serverName: 'server1',
          discoveredAt: new Date()
        }
      };

      const result = validator.validateResource(entry);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain('Potentially dangerous URI scheme');
      expect(result.errors[0]?.severity).toBe('high');
    });

    it('should detect script content in resources', () => {
      const scriptContent: MCPResourceResult = {
        contents: [{ uri: 'text', text: '<script>alert("xss")</script>' }],
        mimeType: 'text/html'
      };

      const result = validator.validateResource(mockCatalogEntry, scriptContent);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain('potentially dangerous script elements');
      expect(result.errors[0]?.severity).toBe('high');
    });

    it('should use custom validation rules', () => {
      const customRule: ValidationRule = {
        name: 'custom_rule',
        description: 'Custom validation rule',
        validate: () => ({
          valid: false,
          message: 'Custom rule failed',
          severity: 'medium' as const
        })
      };

      const result = validator.validateResource(mockCatalogEntry, mockResourceContent, {
        rules: [customRule]
      });

      expect(result.valid).toBe(true); // Built-in rules pass, custom rule creates warning
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.message).toBe('Custom rule failed');
    });

    it('should handle validation rule exceptions', () => {
      const faultyRule: ValidationRule = {
        name: 'faulty_rule',
        description: 'Rule that throws an error',
        validate: () => {
          throw new Error('Rule implementation error');
        }
      };

      const result = validator.validateResource(mockCatalogEntry, mockResourceContent, {
        rules: [faultyRule]
      });

      expect(result.valid).toBe(true); // Should handle errors gracefully
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.message).toContain('encountered an error');
    });

    it('should respect strict mode', () => {
      const result = validator.validateResource(mockCatalogEntry, mockResourceContent, {
        strictMode: true
      });

      // Create a resource that will generate warnings (invalid MIME type in metadata)
      const resourceWithWarning: CatalogEntry = {
        resource: {
          uri: 'file:///test.txt',
          name: 'test.txt',
          mimeType: 'invalid-mime-type' // This will create a warning
        },
        metadata: {
          uri: 'file:///test.txt',
          serverName: 'server1',
          discoveredAt: new Date()
        }
      };

      const resultWithWarning = validator.validateResource(resourceWithWarning, mockResourceContent, {
        strictMode: true
      });

      expect(result.valid).toBe(true); // No warnings in this case
      expect(resultWithWarning.valid).toBe(false); // Warnings make it invalid in strict mode
    });
  });

  describe('validateBatch', () => {
    it('should validate multiple resources', () => {
      const entries: CatalogEntry[] = [
        mockCatalogEntry,
        {
          resource: {
            uri: 'file:///test2.txt',
            name: 'test2.txt',
            mimeType: 'text/plain'
          },
          metadata: {
            uri: 'file:///test2.txt',
            serverName: 'server1',
            discoveredAt: new Date()
          }
        }
      ];

      const results = validator.validateBatch(entries);

      expect(results.size).toBe(2);
      expect(results.get('file:///test.txt')?.valid).toBe(true);
      expect(results.get('file:///test2.txt')?.valid).toBe(true);
    });

    it('should handle validation failures in batch', () => {
      const entries: CatalogEntry[] = [
        mockCatalogEntry,
        {
          resource: {
            uri: '', // Invalid URI
            name: 'invalid.txt',
            mimeType: 'text/plain'
          },
          metadata: {
            uri: '',
            serverName: 'server1',
            discoveredAt: new Date()
          }
        }
      ];

      const results = validator.validateBatch(entries);

      expect(results.size).toBe(2);
      expect(results.get('file:///test.txt')?.valid).toBe(true);
      expect(results.get('')?.valid).toBe(false);
    });

    it('should handle exceptions during batch validation', () => {
      // Mock validateResource to throw for one entry
      const originalValidate = validator.validateResource;
      const validateSpy = jest.spyOn(validator, 'validateResource')
        .mockImplementationOnce(() => { throw new Error('Validation error'); })
        .mockImplementation(originalValidate.bind(validator));

      const entries: CatalogEntry[] = [mockCatalogEntry, { ...mockCatalogEntry, resource: { ...mockCatalogEntry.resource, uri: 'file:///test2.txt' }, metadata: { ...mockCatalogEntry.metadata, uri: 'file:///test2.txt' } }];

      const results = validator.validateBatch(entries);

      expect(results.size).toBe(2);
      expect(results.get('file:///test.txt')?.valid).toBe(false); // First call failed
      expect(results.get('file:///test2.txt')?.valid).toBe(true); // Second call succeeded
      
      validateSpy.mockRestore();
    });
  });

  describe('validateMetadata', () => {
    it('should validate required metadata fields', () => {
      const validMetadata = {
        uri: 'file:///test.txt',
        serverName: 'server1',
        discoveredAt: new Date()
      };

      const issues = validator.validateMetadata(validMetadata);

      expect(issues).toHaveLength(0);
    });

    it('should detect missing URI', () => {
      const invalidMetadata = {
        uri: '',
        serverName: 'server1',
        discoveredAt: new Date()
      };

      const issues = validator.validateMetadata(invalidMetadata);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toBe('URI is required');
      expect(issues[0]?.severity).toBe('high');
    });

    it('should detect missing server name', () => {
      const invalidMetadata = {
        uri: 'file:///test.txt',
        serverName: '',
        discoveredAt: new Date()
      };

      const issues = validator.validateMetadata(invalidMetadata);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toBe('Server name is required');
      expect(issues[0]?.severity).toBe('high');
    });

    it('should validate URI format in metadata', () => {
      const invalidMetadata = {
        uri: 'not-a-valid-uri',
        serverName: 'server1',
        discoveredAt: new Date()
      };

      const issues = validator.validateMetadata(invalidMetadata);

      // Should still pass basic URI validation for simple paths
      expect(issues).toHaveLength(0);
    });

    it('should validate MIME type format in metadata', () => {
      const invalidMetadata = {
        uri: 'file:///test.txt',
        serverName: 'server1',
        discoveredAt: new Date(),
        mimeType: 'invalid-mime-type'
      };

      const issues = validator.validateMetadata(invalidMetadata);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toBe('Invalid MIME type format');
      expect(issues[0]?.severity).toBe('low');
    });
  });

  describe('built-in validation rules', () => {
    it('should accept valid URIs', () => {
      const validUris = [
        'file:///test.txt',
        'http://example.com/resource',
        'https://api.example.com/data',
        '/relative/path',
        'resource-name'
      ];

      validUris.forEach(uri => {
        const resource: MCPResource = { ...mockResource, uri };
        const entry: CatalogEntry = {
          resource,
          metadata: { ...mockCatalogEntry.metadata, uri }
        };

        const result = validator.validateResource(entry);
        expect(result.valid).toBe(true);
      });
    });

    it('should accept valid MIME types', () => {
      const validMimeTypes = [
        'text/plain',
        'application/json',
        'image/png',
        'audio/mpeg',
        'video/mp4',
        'application/vnd.api+json'
      ];

      validMimeTypes.forEach(mimeType => {
        const resource: MCPResource = { ...mockResource, mimeType };
        const entry: CatalogEntry = {
          resource,
          metadata: mockCatalogEntry.metadata
        };

        const result = validator.validateResource(entry);
        expect(result.valid).toBe(true);
      });
    });

    it('should handle multi-part content for size validation', () => {
      const multiPartContent: MCPResourceResult = {
        contents: [
          { uri: 'text', text: 'Part 1 content' },
          { uri: 'text', text: 'Part 2 content' },
          { uri: 'blob', blob: 'binary data' }
        ],
        mimeType: 'multipart/mixed'
      };

      const result = validator.validateResource(mockCatalogEntry, multiPartContent);

      expect(result.valid).toBe(true);
      // Size should be calculated from text parts only
    });
  });
});