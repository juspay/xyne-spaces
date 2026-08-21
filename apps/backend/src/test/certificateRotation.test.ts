import express from 'express';
import request from 'supertest';

jest.mock('@/config/env', () => ({
  config: {
    mtlsServiceSecret: 'test-s2s-key',
    mtlsAuth: {
      url: 'https://mtls.example.test',
      ingressSharedSecret: 'test-ingress-key',
      requestTimeoutMs: 5000,
      rateLimitWindowMs: 60000,
      rateLimitMax: 100,
    },
  },
}));

jest.mock('@/middleware/auth', () => ({
  authMiddleware: {
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.user = {
        id: '11111111-1111-4111-8111-111111111111',
        googleId: 'google-user',
        email: 'test@example.com',
        name: 'Test User',
        workspaceId: 'workspace-id',
        role: 'user',
        orgRole: 'member',
        memberId: 'member-id',
      };
      next();
    },
  },
}));

import certificateRotationRoutes from '@/routes/certificateRotation';

const serial = '00aabbccddeeff112233445566778899';
const rotationId = '33333333-3333-4333-8333-333333333333';

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(certificateRotationRoutes);
  return instance;
}

describe('certificate rotation proxy', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects requests without ingress-verified certificate identity', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    const response = await request(app()).post('/re-enroll').send({
      csr: '-----BEGIN CERTIFICATE REQUEST-----\ntest\n-----END CERTIFICATE REQUEST-----',
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('CLIENT_CERTIFICATE_REQUIRED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards re-enrollment using token user and normalized ingress serial', async () => {
    const upstreamBody = {
      rotation_id: rotationId,
      certificate: 'leaf',
      ca_chain: 'chain',
      not_before: '2026-08-19T00:00:00.000Z',
      not_after: '2027-02-19T00:00:00.000Z',
      ack_deadline: '2026-08-19T01:00:00.000Z',
    };
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(upstreamBody), { status: 201, headers: { 'content-type': 'application/json' } }),
    );

    const response = await request(app())
      .post('/re-enroll')
      .set('x-mtls-ingress-key', 'test-ingress-key')
      .set('x-verified-client-cert-serial', serial.toUpperCase())
      .send({
        csr: '-----BEGIN CERTIFICATE REQUEST-----\ntest\n-----END CERTIFICATE REQUEST-----',
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(upstreamBody);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://mtls.example.test/internal/v1/certificate-rotations');
    expect(init?.headers).toEqual(expect.objectContaining({ 'x-s2s-key': 'test-s2s-key' }));
    expect(JSON.parse(String(init?.body))).toEqual({
      csr: '-----BEGIN CERTIFICATE REQUEST-----\ntest\n-----END CERTIFICATE REQUEST-----',
      user_email: 'test@example.com',
      current_certificate_serial: serial,
    });
  });

  it('requires ingress certificate identity but does not forward it for acknowledgment', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'acknowledged' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await request(app())
      .post('/cert-ack')
      .set('x-mtls-ingress-key', 'test-ingress-key')
      .set('x-verified-client-cert-serial', serial)
      .send({ rotation_id: rotationId });

    expect(response.status).toBe(200);
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      user_email: 'test@example.com',
    });
  });

  it('rejects invalid ingress secrets and certificate serials', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    const invalidSecret = await request(app())
      .post('/cert-ack')
      .set('x-mtls-ingress-key', 'wrong-ingress-key')
      .set('x-verified-client-cert-serial', serial)
      .send({ rotation_id: rotationId });
    const invalidSerial = await request(app())
      .post('/cert-ack')
      .set('x-mtls-ingress-key', 'test-ingress-key')
      .set('x-verified-client-cert-serial', 'aa:bb')
      .send({ rotation_id: rotationId });

    expect(invalidSecret.status).toBe(401);
    expect(invalidSerial.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects unknown body fields before proxying', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    const response = await request(app())
      .post('/cert-ack')
      .set('x-mtls-ingress-key', 'test-ingress-key')
      .set('x-verified-client-cert-serial', serial)
      .send({ rotation_id: rotationId, certificate_serial: serial });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ACK_REQUEST');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('preserves stable upstream errors', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_IN_RENEWAL_WINDOW', message: 'Too early' } }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await request(app())
      .post('/re-enroll')
      .set('x-mtls-ingress-key', 'test-ingress-key')
      .set('x-verified-client-cert-serial', serial)
      .send({ csr: 'csr' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('NOT_IN_RENEWAL_WINDOW');
  });
});
