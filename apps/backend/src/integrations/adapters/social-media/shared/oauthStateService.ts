import crypto from 'node:crypto';
import { redisService } from '@/services/redisService';

interface OAuthStateServiceOptions<TState> {
  prefix: string;
  purpose: string;
  ttlSeconds?: number;
  validate: (parsed: Partial<TState>) => boolean;
}

type BetterOmit<T, K extends string | number | symbol> = {
  [P in keyof T as P extends K ? never : P]: T[P];
};

interface OAuthStateService<TState> {
  create(input: BetterOmit<TState, 'purpose' | 'codeVerifier' | 'createdAt'>): Promise<{ state: string; codeChallenge: string }>;
  consume(state: string): Promise<TState | null>;
}

export function createOAuthStateService<TState extends { purpose: string; codeVerifier: string; createdAt: number }>(
  opts: OAuthStateServiceOptions<TState>,
): OAuthStateService<TState> {
  const ttl = opts.ttlSeconds ?? 10 * 60;

  function key(state: string): string {
    return `${opts.prefix}${state}`;
  }

  function parse(raw: string | null): TState | null {
    if (!raw) return null;
    try {
      const state = JSON.parse(raw) as Partial<TState>;
      if (
        state.purpose !== opts.purpose ||
        typeof state.codeVerifier !== 'string' ||
        typeof state.createdAt !== 'number' ||
        !opts.validate(state)
      ) {
        return null;
      }
      return state as TState;
    } catch {
      return null;
    }
  }

  return {
    async create(input) {
      const state = crypto.randomBytes(32).toString('base64url');
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      const value = {
        purpose: opts.purpose,
        ...input,
        codeVerifier,
        createdAt: Date.now(),
      } as unknown as TState;
      await redisService.set(key(state), JSON.stringify(value), ttl);
      return { state, codeChallenge };
    },

    async consume(state) {
      const raw = (await redisService.getClient().eval(
        `
          local value = redis.call('GET', KEYS[1])
          if value then redis.call('DEL', KEYS[1]) end
          return value
        `,
        1,
        key(state),
      )) as string | null;
      return parse(raw);
    },
  };
}
