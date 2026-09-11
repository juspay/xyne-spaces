import { randomUUID } from 'node:crypto';
import { redisService } from '@/services/redisService';

const PREFIX = 'sdlc:admission';
const PERMIT_TTL_MS = 15 * 60 * 1000;

const REGISTER_PENDING_LUA = `
local added = redis.call('SADD', KEYS[1], ARGV[2])
if added == 1 and not redis.call('ZSCORE', KEYS[2], ARGV[1]) then
  redis.call('ZADD', KEYS[2], redis.call('INCR', KEYS[3]), ARGV[1])
end
return added
`;

const UNREGISTER_PENDING_LUA = `
redis.call('SREM', KEYS[1], ARGV[2])
if redis.call('SCARD', KEYS[1]) == 0 then redis.call('ZREM', KEYS[2], ARGV[1]) end
return 1
`;

const ACQUIRE_LUA = `
local global_key = KEYS[1]
local repo_key = KEYS[2]
local pending_repos_key = KEYS[3]
local pending_jobs_key = KEYS[4]
local permit_key = KEYS[5]
local sequence_key = KEYS[6]
local now = tonumber(ARGV[1])
local global_limit = tonumber(ARGV[2])
local repo_limit = tonumber(ARGV[3])
local expires_at = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local permit_id = ARGV[6]
local repo_id = ARGV[7]
local job_id = ARGV[8]

redis.call('ZREMRANGEBYSCORE', global_key, '-inf', now)
redis.call('ZREMRANGEBYSCORE', repo_key, '-inf', now)

local next_repo = redis.call('ZRANGE', pending_repos_key, 0, 0)[1]
if next_repo and next_repo ~= repo_id then return 0 end
if redis.call('ZCARD', global_key) >= global_limit then return 0 end
if redis.call('ZCARD', repo_key) >= repo_limit then
  redis.call('ZADD', pending_repos_key, redis.call('INCR', sequence_key), repo_id)
  return 0
end

redis.call('SREM', pending_jobs_key, job_id)
if redis.call('SCARD', pending_jobs_key) == 0 then
  redis.call('ZREM', pending_repos_key, repo_id)
else
  redis.call('ZADD', pending_repos_key, redis.call('INCR', sequence_key), repo_id)
end
redis.call('ZADD', global_key, expires_at, permit_id)
redis.call('ZADD', repo_key, expires_at, permit_id)
redis.call('HSET', permit_key, 'permitId', permit_id, 'repoId', repo_id, 'jobId', job_id)
redis.call('PEXPIRE', permit_key, ttl)
return 1
`;

const RELEASE_LUA = `
local repo_id = redis.call('HGET', KEYS[2], 'repoId')
redis.call('ZREM', KEYS[1], ARGV[1])
if repo_id then redis.call('ZREM', '${PREFIX}:repo:' .. repo_id .. ':active', ARGV[1]) end
redis.call('DEL', KEYS[2])
return 1
`;

const RENEW_LUA = `
local repo_id = redis.call('HGET', KEYS[2], 'repoId')
if not repo_id then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('ZADD', '${PREFIX}:repo:' .. repo_id .. ':active', ARGV[2], ARGV[1])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
return 1
`;

const RESTORE_LUA = `
redis.call('ZADD', KEYS[1], ARGV[4], ARGV[1])
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1])
redis.call('HSET', KEYS[3], 'permitId', ARGV[1], 'repoId', ARGV[2], 'jobId', ARGV[3])
redis.call('PEXPIRE', KEYS[3], ARGV[5])
return 1
`;

export interface SdlcAdmissionPermit {
  permitId: string;
  repoId: string;
}

const globalKey = `${PREFIX}:global:active`;
const pendingReposKey = `${PREFIX}:pending:repos`;
const pendingSequenceKey = `${PREFIX}:pending:sequence`;
const repoActiveKey = (repoId: string) => `${PREFIX}:repo:${repoId}:active`;
const repoPendingKey = (repoId: string) => `${PREFIX}:repo:${repoId}:pending`;
const permitKey = (permitId: string) => `${PREFIX}:permit:${permitId}`;

class SdlcAdmissionController {
  async registerPending(repoId: string, jobId: string): Promise<void> {
    await redisService.getClient().eval(
      REGISTER_PENDING_LUA,
      3,
      repoPendingKey(repoId),
      pendingReposKey,
      pendingSequenceKey,
      repoId,
      jobId,
    );
  }

  async unregisterPending(repoId: string, jobId: string): Promise<void> {
    await redisService.getClient().eval(
      UNREGISTER_PENDING_LUA,
      2,
      repoPendingKey(repoId),
      pendingReposKey,
      repoId,
      jobId,
    );
  }

  async tryAcquire(input: {
    repoId: string;
    jobId: string;
    globalLimit: number;
    repoLimit: number;
  }): Promise<SdlcAdmissionPermit | null> {
    const permitId = randomUUID();
    const now = Date.now();
    const acquired = await redisService.getClient().eval(
      ACQUIRE_LUA,
      6,
      globalKey,
      repoActiveKey(input.repoId),
      pendingReposKey,
      repoPendingKey(input.repoId),
      permitKey(permitId),
      pendingSequenceKey,
      String(now),
      String(input.globalLimit),
      String(input.repoLimit),
      String(now + PERMIT_TTL_MS),
      String(PERMIT_TTL_MS),
      permitId,
      input.repoId,
      input.jobId,
    );
    return Number(acquired) === 1 ? { permitId, repoId: input.repoId } : null;
  }

  async release(permitId: string | null | undefined): Promise<void> {
    if (!permitId) return;
    await redisService.getClient().eval(
      RELEASE_LUA,
      2,
      globalKey,
      permitKey(permitId),
      permitId,
    );
  }

  async renew(permitId: string | null | undefined): Promise<void> {
    if (!permitId) return;
    await redisService.getClient().eval(
      RENEW_LUA,
      2,
      globalKey,
      permitKey(permitId),
      permitId,
      String(Date.now() + PERMIT_TTL_MS),
      String(PERMIT_TTL_MS),
    );
  }

  async restore(input: {
    permitId: string | null | undefined;
    repoId: string;
    jobId: string;
  }): Promise<void> {
    if (!input.permitId) return;
    await redisService.getClient().eval(
      RESTORE_LUA,
      3,
      globalKey,
      repoActiveKey(input.repoId),
      permitKey(input.permitId),
      input.permitId,
      input.repoId,
      input.jobId,
      String(Date.now() + PERMIT_TTL_MS),
      String(PERMIT_TTL_MS),
    );
  }
}

export const sdlcAdmission = new SdlcAdmissionController();
