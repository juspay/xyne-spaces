import type Redis from 'ioredis';

/** Encrypts values written to Redis and decrypts them on read. Pass-through in the public build. */
export function wrapRedisWithEncryption(client: Redis): Redis {
  return client;
}
