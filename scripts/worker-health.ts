import Redis from 'ioredis';
import { hostname } from 'node:os';
async function main() {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});
  try {
    const raw = await redis.get('autometa:worker:' + hostname());
    if (!raw || Date.now() - Number(raw) > 25000) process.exitCode = 1;
  } finally {
    await redis.quit().catch(() => {});
  }
}
void main().catch(() => {
  process.exitCode = 1;
});
