import {
  Controller,
  Get,
  Header,
  Inject,
  Module,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { InfrastructureModule } from './infrastructure.module';
import { InfrastructureService } from './infrastructure.service';
import { parseConfig } from '../../packages/config/src';
@Controller('health')
class MetricsController {
  private readonly config = parseConfig(process.env);
  constructor(
    @Inject(InfrastructureService)
    private readonly infra: InfrastructureService,
  ) {}
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(@Req() r: Request) {
    const actual = Buffer.from(r.header('authorization') ?? ''),
      expected = Buffer.from('Bearer ' + this.config.MONITORING_TOKEN);
    if (
      !this.config.MONITORING_TOKEN ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new UnauthorizedException();
    const [
      states,
      oldest,
      credits,
      workers,
      usersUp,
      adminUp,
      backup,
      restore,
    ] = await Promise.all([
      this.infra.database.outboundEmail.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.infra.database.emailOutbox.findFirst({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.infra.database.creditAccount.count({ where: { blocked: true } }),
      this.infra.redis.keys('autometa:worker:*'),
      this.check('http://web:3000'),
      this.check('http://admin:3000'),
      this.status('backup.json'),
      this.status('restore.json'),
    ]);
    const lines = [
      'autometa_api_up 1',
      'autometa_worker_up ' + Number(workers.length > 0),
      'autometa_frontend_up{portal="users"} ' + usersUp,
      'autometa_frontend_up{portal="admin"} ' + adminUp,
      'autometa_outbox_oldest_age_seconds ' +
        (oldest
          ? Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1000)
          : 0),
      'autometa_billing_accounts_blocked ' + credits,
      'autometa_backup_last_success_timestamp_seconds ' +
        (backup.lastSuccess ?? 0) / 1000,
      'autometa_backup_last_run_success ' + Number(backup.ok === true),
      'autometa_restore_last_success_timestamp_seconds ' +
        (restore.lastSuccess ?? 0) / 1000,
    ];
    for (const status of [
      'QUEUED',
      'SENDING',
      'RETRY',
      'WAITING_CREDITS',
      'UNKNOWN',
      'FAILED',
      'SUPPRESSED',
      'SMTP_ACCEPTED',
      'MOCK_ACCEPTED',
    ])
      lines.push(
        'autometa_email_messages{status="' +
          status +
          '"} ' +
          (states.find((s) => s.status === status)?._count ?? 0),
      );
    return lines.join('\n') + '\n';
  }
  private async check(url: string) {
    try {
      return Number(
        (
          await fetch(url, {
            signal: AbortSignal.timeout(2000),
            redirect: 'error',
          })
        ).ok,
      );
    } catch {
      return 0;
    }
  }
  private async status(
    file: string,
  ): Promise<{ lastSuccess?: number; ok?: boolean }> {
    try {
      const x = JSON.parse(
        await readFile(join(this.config.BACKUP_STATUS_DIRECTORY, file), 'utf8'),
      );
      return {
        lastSuccess:
          typeof x.lastSuccess === 'number' && Number.isFinite(x.lastSuccess)
            ? x.lastSuccess
            : 0,
        ok: x.ok === true,
      };
    } catch {
      return {};
    }
  }
}
@Module({ imports: [InfrastructureModule], controllers: [MetricsController] })
export class MonitoringModule {}
