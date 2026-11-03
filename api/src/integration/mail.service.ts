import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { InfrastructureService } from '../infrastructure.service';
import { AuthService, Principal } from '../security/auth.service';
import { digest, seal, unseal } from '../security/crypto';
import { fail } from '../security/dto';
import { parseConfig } from '../../../packages/config/src';
import { emailQuotaKey, utcDay } from '../../../packages/email/src/store';
import { settleEmailCredit } from '../../../packages/email/src/credits';
import type { automationBody } from './dto';
import type { z } from 'zod';
@Injectable()
export class MailManagementService {
  private readonly config = parseConfig(process.env);
  constructor(
    @Inject(InfrastructureService)
    private readonly infra: InfrastructureService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  private runtime() {
    return {
      provider: this.config.MAIL_PROVIDER,
      sender: this.config.MAIL_FROM,
      testMode: this.config.EMAIL_TEST_MODE,
      tenantDailyMaximum: this.config.EMAIL_TENANT_PER_DAY,
      inboundEnabled: false,
      followUpAvailable: this.config.EMAIL_FOLLOW_UP_ENABLED,
      followUpDelayMinutes: this.config.EMAIL_FOLLOW_UP_DELAY_SECONDS / 60,
    };
  }
  async overview(p: Principal) {
    const tenant = await this.auth.requireTenant(p);
    const [settings, emails, events, suppressions, counter] = await Promise.all(
      [
        this.infra.database.emailAutomation.upsert({
          where: { tenantId: tenant.id },
          create: {
            tenantId: tenant.id,
            dailyLimit: this.config.EMAIL_TENANT_PER_DAY,
          },
          update: {},
        }),
        this.infra.database.outboundEmail.findMany({
          where: { tenantId: tenant.id },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: {
            id: true,
            recipient: true,
            subject: true,
            status: true,
            errorCode: true,
            provider: true,
            attemptCount: true,
            createdAt: true,
            acceptedAt: true,
            purpose: true,
            scheduledAt: true,
          },
        }),
        this.infra.database.integrationEvent.findMany({
          where: { tenantId: tenant.id },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: {
            id: true,
            externalEventId: true,
            eventType: true,
            emailDecision: true,
            createdAt: true,
            contact: { select: { name: true, email: true } },
          },
        }),
        this.infra.database.emailSuppression.findMany({
          where: { tenantId: tenant.id },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.infra.database.usageCounter.findUnique({
          where: { key: emailQuotaKey(this.config.MAIL_PROVIDER, tenant.id) },
        }),
      ],
    );
    return {
      success: true,
      runtime: this.runtime(),
      settings,
      emails,
      events,
      suppressions: suppressions.map((s) => ({
        id: s.id,
        email: unseal(
          s.encryptedAddress,
          this.config.AUTH_JWT_SECRET!,
          'suppression',
        ),
        reason: s.reason,
        createdAt: s.createdAt,
      })),
      quota: {
        day: utcDay(),
        reserved: counter?.quantity ?? 0,
        limit: Math.min(settings.dailyLimit, this.config.EMAIL_TENANT_PER_DAY),
      },
    };
  }
  async settings(p: Principal, input: z.infer<typeof automationBody>) {
    const tenant = await this.auth.requireTenant(p, true);
    if (input.followUpEnabled && !this.config.EMAIL_FOLLOW_UP_ENABLED)
      fail(
        400,
        'FOLLOW_UP_DISABLED',
        'Follow-ups are disabled by the platform operator.',
      );
    if (input.dailyLimit > this.config.EMAIL_TENANT_PER_DAY)
      fail(
        400,
        'INVALID_REQUEST',
        'The daily limit exceeds the platform allowance.',
      );
    await this.infra.database.$transaction(async (tx) => {
      await tx.emailAutomation.upsert({
        where: { tenantId: tenant.id },
        create: { tenantId: tenant.id, ...input },
        update: input,
      });
      if (!input.enabled || input.followUpEnabled === false) {
        const pending = await tx.outboundEmail.findMany({
          where: {
            tenantId: tenant.id,
            purpose: 'FOLLOW_UP',
            status: { in: ['QUEUED', 'RETRY', 'WAITING_CREDITS'] },
          },
          select: { id: true },
        });
        for (const email of pending) {
          const result = await tx.outboundEmail.updateMany({
            where: {
              id: email.id,
              tenantId: tenant.id,
              purpose: 'FOLLOW_UP',
              status: { in: ['QUEUED', 'RETRY', 'WAITING_CREDITS'] },
            },
            data: { status: 'SUPPRESSED', errorCode: 'FOLLOW_UP_DISABLED' },
          });
          if (result.count)
            await settleEmailCredit(tx, email.id, tenant.id, 'RELEASE');
        }
      }
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId: p.id,
          resourceId: tenant.id,
          action: 'email.automation_updated',
        },
      });
    });
    return { success: true };
  }
  async message(p: Principal, id: string) {
    const tenant = await this.auth.requireTenant(p);
    const m = await this.infra.database.outboundEmail.findFirst({
      where: { id, tenantId: tenant.id },
      include: { attempts: { orderBy: { number: 'asc' } } },
    });
    if (!m) fail(404, 'NOT_FOUND', 'Email not found.');
    return {
      success: true,
      email: {
        id: m.id,
        recipient: m.recipient,
        sender: m.sender,
        subject: m.subject,
        text: unseal(
          m.encryptedBody,
          this.config.AUTH_JWT_SECRET!,
          'outbound-email',
        ),
        status: m.status,
        purpose: m.purpose,
        scheduledAt: m.scheduledAt,
        errorCode: m.errorCode,
        provider: m.provider,
        providerMessageId: m.providerMessageId,
        acceptedAt: m.acceptedAt,
        createdAt: m.createdAt,
        attempts: m.attempts.map((a) => ({
          number: a.number,
          outcome: a.outcome,
          safeCode: a.safeCode,
          startedAt: a.startedAt,
          finishedAt: a.finishedAt,
        })),
      },
    };
  }
  async cancel(p: Principal, id: string) {
    const tenant = await this.auth.requireTenant(p);
    await this.infra.database.$transaction(async (tx) => {
      const updated = await tx.outboundEmail.updateMany({
        where: {
          id,
          tenantId: tenant.id,
          purpose: 'FOLLOW_UP',
          status: { in: ['QUEUED', 'RETRY', 'WAITING_CREDITS'] },
        },
        data: { status: 'SUPPRESSED', errorCode: 'FOLLOW_UP_CANCELLED' },
      });
      if (!updated.count) {
        const exists = await tx.outboundEmail.findFirst({
          where: { id, tenantId: tenant.id },
        });
        if (!exists) fail(404, 'NOT_FOUND', 'Email not found.');
        fail(
          409,
          'CANNOT_CANCEL',
          'Only a pending follow-up can be cancelled.',
        );
      }
      await settleEmailCredit(tx, id, tenant.id, 'RELEASE');
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId: p.id,
          resourceId: id,
          action: 'email.follow_up_cancelled',
        },
      });
    });
    return { success: true };
  }
  async suppress(p: Principal, email: string) {
    const tenant = await this.auth.requireTenant(p);
    await this.infra.database.$transaction(async (tx) => {
      await tx.emailSuppression.upsert({
        where: {
          tenantId_emailHash: { tenantId: tenant.id, emailHash: digest(email) },
        },
        create: {
          tenantId: tenant.id,
          emailHash: digest(email),
          encryptedAddress: seal(
            email,
            this.config.AUTH_JWT_SECRET!,
            'suppression',
          ),
          reason: 'MANUAL_OPT_OUT',
        },
        update: { reason: 'MANUAL_OPT_OUT' },
      });
      await tx.contact.updateMany({
        where: { tenantId: tenant.id, email },
        data: { transactionalAllowed: false },
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId: p.id,
          resourceId: tenant.id,
          action: 'email.recipient_suppressed',
        },
      });
    });
    return { success: true };
  }
  async unsuppress(p: Principal, id: string) {
    const tenant = await this.auth.requireTenant(p, true);
    await this.infra.database.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const result = await tx.emailSuppression.deleteMany({
          where: { id, tenantId: tenant.id },
        });
        if (!result.count) fail(404, 'NOT_FOUND', 'Suppression not found.');
        await tx.auditLog.create({
          data: {
            tenantId: tenant.id,
            actorId: p.id,
            resourceId: id,
            action: 'email.suppression_removed',
          },
        });
      },
    );
    return { success: true };
  }
}
