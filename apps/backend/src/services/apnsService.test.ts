jest.mock('@/config/env', () => ({
  config: { env: 'test', apns: {}, ssrf: { egressProxyUrl: '' } },
}));
jest.mock('@/utils/logger', () => {
  const log = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { logger: { ...log, child: () => log } };
});

import { apnsProxyFromUrl } from './apnsService';

describe('apnsProxyFromUrl', () => {
  it('returns nothing when no proxy is configured', () => {
    expect(apnsProxyFromUrl('')).toBeUndefined();
  });

  it('parses an http proxy with a port', () => {
    expect(apnsProxyFromUrl('http://proxy.prod.internal:3128')).toEqual({ host: 'proxy.prod.internal', port: 3128 });
  });

  it('defaults the port to 80', () => {
    expect(apnsProxyFromUrl('http://proxy.example')).toEqual({ host: 'proxy.example', port: 80 });
  });

  it('ignores a non-http proxy and an invalid URL', () => {
    expect(apnsProxyFromUrl('https://proxy.example:3129')).toBeUndefined();
    expect(apnsProxyFromUrl('not a url')).toBeUndefined();
  });
});
