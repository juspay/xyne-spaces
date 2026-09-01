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

  it('verifies in uniform time across all stored-hash forms and the no-account path', async () => {
    // Stored hashes are a mix of two forms in production:
    //   register flow -> client sha256 hash (fast branch)
    //   reset/change  -> scrypt hash        (slow branch)
    // Login must cost the same for both, and for a missing account (dummy), or the
    // latency reveals the stored form and/or whether the email is registered.
    const shaAccount = hashPasswordForAuth('Passw0rd!parity'); // register-flow account
    const scryptAccount = await hashPassword('Passw0rd!parity'); // reset/change account
    expect(isClientPasswordHash(shaAccount)).toBe(true);
    expect(isClientPasswordHash(scryptAccount)).toBe(false);

    // warm up
    await verifyEmailPassword('warmup', shaAccount);
    await verifyEmailPassword('warmup', scryptAccount);
    await verifyEmailPassword('warmup', DUMMY_PASSWORD_HASH);

    const median = async (storedHash: string): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < 7; i++) {
        samples.push(await timeMs(() => verifyEmailPassword('guess-does-not-match', storedHash)));
      }
      samples.sort((a, b) => a - b);
      return samples[3]!;
    };

    const tSha = await median(shaAccount); // register-flow account
    const tScrypt = await median(scryptAccount); // reset/change account
    const tNone = await median(DUMMY_PASSWORD_HASH); // no such account

    // All three must land within a small ratio of one another — no timing oracle for
    // existence OR stored-hash format. (Was ~100x apart before the scrypt-pad fix.)
    const times = [tSha, tScrypt, tNone];
    const ratio = Math.max(...times) / Math.min(...times);
    expect(ratio).toBeLessThan(2);
  });
});
