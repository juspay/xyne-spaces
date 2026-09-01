import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  hashPasswordForAuth,
  isClientPasswordHash,
  verifyEmailPassword,
} from './passwordUtils';

// PY-JP-017 / API PY-JP-004 (user enumeration by login timing).
// The no-account login branch verifies the submitted password against
// DUMMY_PASSWORD_HASH. If that dummy took the fast sha256 (client-hash) branch
// while real accounts are stored as scrypt, an unknown email would answer in
// microseconds and a registered one in ~tens of ms — a timing oracle. These
// tests pin the dummy to the slow scrypt path with the same params as hashPassword.

async function timeMs(fn: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

describe('DUMMY_PASSWORD_HASH timing parity', () => {
  it('is not a client-hash shape, so it cannot take the fast sha256 branch', () => {
    expect(isClientPasswordHash(DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it('uses the same scrypt work parameters as hashPassword (ln=14,r=8,p=1)', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$scrypt\$ln=14,r=8,p=1\$[0-9a-f]+\$[0-9a-f]+$/);
    const realHash = await hashPassword('Passw0rd!parity');
    const dummyParams = DUMMY_PASSWORD_HASH.split('$')[2];
    const realParams = realHash.split('$')[2];
    expect(dummyParams).toBe(realParams);
  });

  it('verifies against the dummy in the same order of magnitude as a real scrypt hash', async () => {
    const realHash = await hashPassword('Passw0rd!parity');
    // warm up the scrypt path
    await verifyEmailPassword('warmup', realHash);
    await verifyEmailPassword('warmup', DUMMY_PASSWORD_HASH);

    const median = async (storedHash: string): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        samples.push(await timeMs(() => verifyEmailPassword('guess-does-not-match', storedHash)));
      }
      samples.sort((a, b) => a - b);
      return samples[2]!;
    };

    const tReal = await median(realHash);
    const tDummy = await median(DUMMY_PASSWORD_HASH);

    // A client-hash (sha256) compare is sub-millisecond; scrypt is tens of ms. The
    // dummy must land near the real scrypt cost, not near the sha256 cost.
    const tClientHash = await timeMs(async () =>
      verifyEmailPassword('guess', hashPasswordForAuth('anything')),
    );

    // Real and dummy must be within a small ratio of each other...
    const ratio = Math.max(tReal, tDummy) / Math.min(tReal, tDummy);
    expect(ratio).toBeLessThan(4);
    // ...and both must be clearly in the slow (scrypt) regime, far above a sha256 compare.
    expect(tDummy).toBeGreaterThan(tClientHash * 5);
    expect(tReal).toBeGreaterThan(tClientHash * 5);
  });
});
