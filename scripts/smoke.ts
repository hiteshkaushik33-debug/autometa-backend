import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { parseConfig } from '../packages/config/src';
import { HEALTH_QUEUE } from '../packages/shared-types/src';

async function main() {
  const config = parseConfig(process.env);
  const database = new PrismaClient();
  const connection = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    connectTimeout: 3000,
    retryStrategy: () => null,
  });
  connection.on('error', () => {});
  const queue = new Queue(HEALTH_QUEUE, { connection });
  const events = new QueueEvents(HEALTH_QUEUE, { connection });
  events.on('error', () => {});
  try {
    await database.$queryRaw`SELECT 1`;
    await database.tenant.count();
    const ready = await fetch(config.API_BASE_URL + '/health/ready', {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(ready.status, 200);
    assert.equal(((await ready.json()) as { status: string }).status, 'ready');
    const missing = await fetch(config.API_BASE_URL + '/not-a-route', {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(missing.status, 404);
    assert.ok(missing.headers.get('x-request-id'));
    await events.waitUntilReady();
    const job = await queue.add(
      'probe',
      {},
      { jobId: randomUUID(), removeOnComplete: true, removeOnFail: 20 },
    );
    assert.deepEqual(await job.waitUntilFinished(events, 15000), {
      status: 'ok',
    });
    const web = await fetch(config.WEB_ORIGIN, {
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(web.status, 200);
    assert.match(await web.text(), /Your business/);
    const proxy = await fetch(config.WEB_ORIGIN + '/api/platform/auth/me', {
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(proxy.status, 401);
    console.log(
      'PASS: migration, database, API, Redis, worker round trip, frontend-to-backend connection',
    );
  } finally {
    await Promise.allSettled([
      events.close(),
      queue.close(),
      database.$disconnect(),
    ]);
    await connection.quit();
  }
}
const deadline = setTimeout(() => {
  console.error('FAIL: infrastructure smoke test timed out');
  process.exit(1);
}, 60000);
void main()
  .catch(() => {
    console.error(
      'FAIL: infrastructure smoke test; check services and configuration',
    );
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(deadline));
