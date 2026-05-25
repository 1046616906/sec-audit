import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// BullMQ requires maxRetriesPerRequest: null on all connections it uses
const BULLMQ_OPTIONS = { maxRetriesPerRequest: null } as const;

declare global {
  // eslint-disable-next-line no-var
  var redisClient: Redis | undefined;
}

const redis: Redis = globalThis.redisClient ?? new Redis(REDIS_URL, BULLMQ_OPTIONS);

if (process.env.NODE_ENV !== "production") {
  globalThis.redisClient = redis;
}

export function createRedisClient(): Redis {
  return new Redis(REDIS_URL, BULLMQ_OPTIONS);
}

export { redis };
