import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { parseConfig } from '../../packages/config/src';
import { HEALTH_QUEUE } from '../../packages/shared-types/src';
import { startEmailRuntime } from '../../packages/email/src/runtime';
import { hostname } from 'node:os';

async function bootstrap() {
  const config = parseConfig(process.env);
  const database = new PrismaClient({
    datasources: { db: { url: config.DATABASE_URL } },
  });
  await database.$connect();
  const connection = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    connectTimeout: 3000,
  });
  connection.on('error', () =>
    console.error(
      JSON.stringify({ service: 'worker', code: 'REDIS_UNAVAILABLE' }),
    ),
  );
  const worker = new Worker(
    HEALTH_QUEUE,
    async (job) => {
      if (job.name !== 'probe') throw new Error('Unsupported system job');
      await database.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    },
    { connection, concurrency: 1 },
  );
  worker.on('error', () =>
    console.error(
      JSON.stringify({ service: 'worker', code: 'QUEUE_UNAVAILABLE' }),
    ),
  );
  worker.on('failed', (job) =>
    console.error(
      JSON.stringify({ service: 'worker', code: 'JOB_FAILED', jobId: job?.id }),
    ),
  );
  await worker.waitUntilReady();
  const email = startEmailRuntime(database, connection, config);
  await email.worker.waitUntilReady();
  const heartbeatKey = 'autometa:worker:' + hostname();
  const heartbeat = async () => {
    try {
      await database.$queryRaw`SELECT 1`;
      await connection.set(heartbeatKey, Date.now(), 'EX', 30);
    } catch {
      /* TTL expiry reports an unhealthy worker. */
    }
  };
  await heartbeat();
  const heartbeatTimer = setInterval(() => void heartbeat(), 5000);
  console.log(
    JSON.stringify({ service: 'worker', status: 'ready', queue: HEALTH_QUEUE }),
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeatTimer);
    await connection.del(heartbeatKey).catch(() => {});
    await email.close();
    await worker.close();
    await Promise.allSettled([connection.quit(), database.$disconnect()]);
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
}
void bootstrap().catch(() => {
  console.error(JSON.stringify({ service: 'worker', code: 'STARTUP_FAILED' }));
  process.exitCode = 1;
});
