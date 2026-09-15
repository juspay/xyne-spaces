/**
 * Internal-link host detection must be deployment-derived, not baked into
 * source: INTERNAL_HOSTS comes from FRONTEND_URL / BACKEND_URL (plus
 * INTERNAL_APP_HOSTS extras), so no deployment-specific hostnames live in the
 * repository.
 */
describe('urlUtils internal host detection (deployment-derived)', () => {
  const ENV_KEYS = ['FRONTEND_URL', 'BACKEND_URL', 'INTERNAL_APP_HOSTS'] as const;
  let saved: Record<string, string | undefined>;

  beforeAll(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const loadUrlUtils = () => {
    let mod: typeof import('./urlUtils');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('./urlUtils');
    });
    return mod!;
  };

  it('defaults to the public hosting domain + localhost variants only', () => {
    delete process.env.FRONTEND_URL;
    delete process.env.BACKEND_URL;
    delete process.env.INTERNAL_APP_HOSTS;
    const urlUtils = loadUrlUtils();

    expect(
      urlUtils.parseInternalUrl('https://xyne-spaces.web.app/chat/dir/ch1/conv1'),
    ).not.toBeNull();
    expect(
      urlUtils.parseInternalUrl('http://localhost:5173/chat/dir/ch1/conv1'),
    ).not.toBeNull();
    // Deployment-specific hostnames must NOT be recognized when not configured.
    expect(
      urlUtils.parseInternalUrl('https://spaces.xyne.juspay.net/chat/dir/ch1/conv1'),
    ).toBeNull();
  });

  it('derives internal hosts from FRONTEND_URL / BACKEND_URL', () => {
    process.env.FRONTEND_URL = 'https://spaces.example.com';
    process.env.BACKEND_URL = 'https://api.spaces.example.com';
    const urlUtils = loadUrlUtils();

    expect(
      urlUtils.parseInternalUrl('https://spaces.example.com/chat/dir/ch1/conv1'),
    ).not.toBeNull();
    expect(
      urlUtils.parseInternalUrl('https://api.spaces.example.com/chat/dir/ch1/conv1'),
    ).not.toBeNull();
    expect(
      urlUtils.extractInternalUrl('see https://spaces.example.com/chat/dir/ch1/conv2 now'),
    ).toBe('https://spaces.example.com/chat/dir/ch1/conv2');
  });

  it('honors INTERNAL_APP_HOSTS extras', () => {
    delete process.env.FRONTEND_URL;
    delete process.env.BACKEND_URL;
    process.env.INTERNAL_APP_HOSTS = 'spaces.extra.example, app.spaces.extra.example';
    const urlUtils = loadUrlUtils();

    expect(
      urlUtils.parseInternalUrl('https://spaces.extra.example/chat/dir/ch1/conv1'),
    ).not.toBeNull();
    expect(
      urlUtils.parseInternalUrl('https://app.spaces.extra.example/chat/dm/ch1/conv1'),
    ).not.toBeNull();
  });
});
