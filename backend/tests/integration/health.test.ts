import request from 'supertest';
import { App } from '../../src/app';

describe('Health Check API', () => {
  let app: App;

  beforeAll(() => {
    app = new App();
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app.app)
        .get('/api/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('status', 'OK');
      expect(response.body.data).toHaveProperty('timestamp');
      expect(response.body.data).toHaveProperty('uptime');
      expect(response.body.data).toHaveProperty('version');
      expect(response.body.data).toHaveProperty('environment');
      expect(response.body.data).toHaveProperty('memory');
    });
  });

  describe('GET /api/health/readiness', () => {
    it('should return readiness status', async () => {
      const response = await request(app.app)
        .get('/api/health/readiness')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('status', 'ready');
    });
  });

  describe('GET /api/health/liveness', () => {
    it('should return liveness status', async () => {
      const response = await request(app.app)
        .get('/api/health/liveness')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('status', 'alive');
      expect(response.body.data).toHaveProperty('pid');
    });
  });
});