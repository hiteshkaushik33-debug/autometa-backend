import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { parseConfig } from '../../packages/config/src';

@Injectable()
export class InfrastructureService implements OnModuleInit, OnModuleDestroy {
  private readonly config = parseConfig(process.env);
  readonly database = new PrismaClient({
    datasources: { db: { url: this.config.DATABASE_URL } },
  });
  readonly redis = new Redis(this.config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    commandTimeout: 3000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3000),
  });

  constructor() {
    this.redis.on('error', () => {
      /* Health route reports only sanitized availability. */
    });
  }
  async onModuleInit() {
    await this.database.$connect();
    await this.redis.connect();
  }
  async ready() {
    await Promise.all([this.database.$queryRaw`SELECT 1`, this.redis.ping()]);
  }
  async onModuleDestroy() {
    await Promise.allSettled([this.database.$disconnect(), this.redis.quit()]);
  }
}
