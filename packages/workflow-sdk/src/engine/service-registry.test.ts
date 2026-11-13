import { describe, it, expect } from 'vitest';
import { ServiceRegistry } from './service-registry.js';

// ─── Test service map for typed tests ───

interface TestServiceMap {
  logger: { info(msg: string): void };
  db: { query(sql: string): Promise<unknown[]> };
  mailer: { send(to: string, body: string): Promise<void> };
}

describe('ServiceRegistry', () => {
  describe('register', () => {
    it('registers a service and retrieves it', () => {
      const registry = new ServiceRegistry<TestServiceMap>();
      const logger = { info: (_msg: string) => {} };

      registry.register('logger', logger);

      expect(registry.get('logger')).toBe(logger);
    });

    it('throws when registering a service that already exists', () => {
      const registry = new ServiceRegistry<TestServiceMap>();
      const logger = { info: (_msg: string) => {} };

      registry.register('logger', logger);

      expect(() => registry.register('logger', logger)).toThrow(
        'Service "logger" is already registered',
      );
    });

    it('registers multiple services independently', () => {
      const registry = new ServiceRegistry<TestServiceMap>();
      const logger = { info: (_msg: string) => {} };
      const db = { query: async (_sql: string) => [] };

      registry.register('logger', logger);
      registry.register('db', db);

      expect(registry.get('logger')).toBe(logger);
      expect(registry.get('db')).toBe(db);
      expect(registry.size).toBe(2);
    });
  });

  describe('get', () => {
    it('throws with descriptive error when service is missing', () => {
      const registry = new ServiceRegistry<TestServiceMap>();
      const logger = { info: (_msg: string) => {} };
      registry.register('logger', logger);

      expect(() => registry.get('db')).toThrow(
        'Service "db" is not registered. Available: [logger]',
      );
    });

    it('throws on empty registry', () => {
      const registry = new ServiceRegistry<TestServiceMap>();

      expect(() => registry.get('logger')).toThrow(
        'Service "logger" is not registered. Available: []',
      );
    });
  });

  describe('replace', () => {
    it('replaces an existing service', () => {
      const registry = new ServiceRegistry<TestServiceMap>();
      const loggerV1 = { info: (_msg: string) => {} };
      const loggerV2 = { info: (_msg: string) => {} };

      registry.register('logger', loggerV1);
      expect(registry.get('logger')).toBe(loggerV1);

      registry.replace('logger', loggerV2);
      expect(registry.get('logger')).toBe(loggerV2);
    });

    it('throws when replacing a service that was never registered', () => {
      const registry = new ServiceRegistry<TestServiceMap>();

      expect(() =>
        registry.replace('logger', { info: (_msg: string) => {} }),
      ).toThrow('Service "logger" is not registered. Call register() first.');
    });
  });

  describe('has', () => {
    it('returns true for registered services', () => {
      const registry = new ServiceRegistry<TestServiceMap>();
      registry.register('logger', { info: (_msg: string) => {} });

      expect(registry.has('logger')).toBe(true);
    });

    it('returns false for unregistered services', () => {
      const registry = new ServiceRegistry<TestServiceMap>();

      expect(registry.has('logger')).toBe(false);
    });
  });

  describe('assertRegistered', () => {
    it('does not throw when all services are present', () => {
      const registry = new ServiceRegistry<TestServiceMap>();
      registry.register('logger', { info: (_msg: string) => {} });
      registry.register('db', { query: async (_sql: string) => [] });

      expect(() =>
        registry.assertRegistered(['logger', 'db']),
      ).not.toThrow();
    });

    it('throws listing all missing services', () => {
      const registry = new ServiceRegistry<TestServiceMap>();
      registry.register('logger', { info: (_msg: string) => {} });

      expect(() =>
        registry.assertRegistered(['logger', 'db', 'mailer']),
      ).toThrow('Missing required services: db, mailer');
    });

    it('does not throw for empty required list', () => {
      const registry = new ServiceRegistry<TestServiceMap>();

      expect(() => registry.assertRegistered([])).not.toThrow();
    });
  });

  describe('size and keys', () => {
    it('reports correct size', () => {
      const registry = new ServiceRegistry<TestServiceMap>();

      expect(registry.size).toBe(0);

      registry.register('logger', { info: (_msg: string) => {} });
      expect(registry.size).toBe(1);

      registry.register('db', { query: async (_sql: string) => [] });
      expect(registry.size).toBe(2);
    });

    it('iterates registered keys', () => {
      const registry = new ServiceRegistry<TestServiceMap>();
      registry.register('logger', { info: (_msg: string) => {} });
      registry.register('db', { query: async (_sql: string) => [] });

      const keys = [...registry.keys()];
      expect(keys).toContain('logger');
      expect(keys).toContain('db');
      expect(keys).toHaveLength(2);
    });
  });

  describe('untyped usage (default generic)', () => {
    it('works without specifying TServiceMap', () => {
      const registry = new ServiceRegistry();

      registry.register('anything', { foo: 'bar' });
      const result = registry.get('anything');

      expect(result).toEqual({ foo: 'bar' });
    });
  });
});
