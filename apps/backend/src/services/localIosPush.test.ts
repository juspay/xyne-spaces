import { execFile } from 'child_process';

import { sendLocalIosPush } from './localIosPush';

jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

jest.mock('child_process', () => ({
  exec: jest.fn(() => {
    throw new Error('exec (shell) must not be used');
  }),
  execFile: jest.fn(),
}));

const execFileMock = execFile as unknown as jest.Mock;

const VALID_UDID = '3F2A9C1E-5B7D-4E8A-9C21-7D4E5F6A8B90';
const INJECTED_UDID = `${VALID_UDID};touch /tmp/pwned;#`;

function mockSimulators(udids: string[]) {
  const devices = udids.map((udid, i) => ({ udid, state: 'Booted', name: `sim-${i}`, isAvailable: true }));
  execFileMock.mockImplementation(
    (_file: string, args: string[], cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
      const stdout =
        args[1] === 'list'
          ? JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-18-0': devices } })
          : '';
      cb(null, { stdout, stderr: '' });
    },
  );
}

const pushCalls = () => execFileMock.mock.calls.filter(([, args]) => args[1] === 'push');

const payloadInjection = '$(touch /tmp/pwned)`touch /tmp/pwned`';
const payload = { title: payloadInjection, message: payloadInjection, type: 'test', actionUrl: payloadInjection };

describe('sendLocalIosPush', () => {
  beforeEach(() => execFileMock.mockReset());

  it('pushes to a booted simulator via execFile with an argv array (no shell)', async () => {
    mockSimulators([VALID_UDID]);

    await sendLocalIosPush(payload, { extra: payloadInjection });

    expect(execFileMock).toHaveBeenCalledWith('xcrun', ['simctl', 'list', 'devices', '--json'], expect.any(Function));
    expect(pushCalls()).toHaveLength(1);
    const [file, args] = pushCalls()[0];
    expect(file).toBe('xcrun');
    expect(args.slice(0, 4)).toEqual(['simctl', 'push', VALID_UDID, 'net.juspay.xynespaces']);
    expect(args[4]).toMatch(/notification\.apns$/);
    // Payload content goes into the .apns file, never into the argv.
    expect(args.join(' ')).not.toContain('pwned');
  });

  it('skips a simulator whose UDID is not a UUID', async () => {
    mockSimulators([INJECTED_UDID, VALID_UDID]);

    await sendLocalIosPush(payload, {});

    expect(pushCalls()).toHaveLength(1);
    expect(pushCalls()[0][1][2]).toBe(VALID_UDID);
  });
});
