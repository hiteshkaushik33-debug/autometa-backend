import { Injectable, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InfrastructureService } from '../infrastructure.service';
import { AuthService, Principal } from './auth.service';
import { digest, opaqueToken } from './crypto';
import { fail } from './dto';
import { parseConfig } from '../../../packages/config/src';

const keySelect = {
  id: true,
  name: true,
  prefix: true,
  environment: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;
@Injectable()
export class PlatformService {
  private readonly config = parseConfig(process.env);
  constructor(
    @Inject(InfrastructureService)
    private readonly infra: InfrastructureService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  async overview(p: Principal) {
    const tenant = await this.auth.requireTenant(p);
    const [keys, audit] = await Promise.all([
      this.infra.database.apiKey.findMany({
        where: { tenantId: tenant.id },
        select: keySelect,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.infra.database.auditLog.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
    ]);
    return {
      success: true,
      tenant,
      keys,
      audit,
      metrics: { activeKeys: keys.filter((k) => !k.revokedAt).length },
      capabilities: {
        events: true,
        billing: this.config.BILLING_ENABLED,
        liveEmail: this.config.MAIL_PROVIDER === 'gmail',
        automations: true,
      },
    };
  }
  async profile(
    p: Principal,
    input: {
      name: string;
      timezone: string;
      website: string;
      description: string;
    },
  ) {
    const tenant = await this.auth.requireTenant(p, true);
    await this.infra.database.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: tenant.id },
        data: { ...input, website: input.website || null },
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId: p.id,
          resourceId: tenant.id,
          action: 'business.profile_updated',
        },
      });
    });
    return { success: true };
  }
  async createKey(
    p: Principal,
    input: { name: string; environment: string },
    rotateId?: string,
  ) {
    const tenant = await this.auth.requireTenant(p, true);
    const prefix =
      input.environment === 'development' ? 'auto_dev_' : 'auto_live_';
    const secret = prefix + opaqueToken();
    const key = await this.infra.database.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Tenant" WHERE "id" = ${tenant.id}::uuid FOR UPDATE`,
      );
      const currentTenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenant.id },
      });
      if (
        currentTenant.status === 'SUSPENDED' ||
        (currentTenant.status === 'TRIAL' &&
          currentTenant.trialEndsAt <= new Date())
      )
        fail(403, 'TENANT_INACTIVE', 'This business is not active.');
      if (rotateId) {
        const old = await tx.apiKey.findFirst({
          where: { id: rotateId, tenantId: tenant.id, revokedAt: null },
        });
        if (!old) fail(404, 'NOT_FOUND', 'API key not found.');
        if (old.environment !== input.environment)
          fail(
            400,
            'INVALID_REQUEST',
            'Rotation must preserve the key environment.',
          );
        await tx.apiKey.update({
          where: { id: old.id },
          data: { revokedAt: new Date() },
        });
      }
      if (
        (await tx.apiKey.count({
          where: { tenantId: tenant.id, revokedAt: null },
        })) >= 10
      )
        fail(
          409,
          'KEY_LIMIT',
          'Revoke an existing key before creating another.',
        );
      const result = await tx.apiKey.create({
        data: {
          tenantId: tenant.id,
          name: input.name,
          environment: input.environment,
          prefix: secret.slice(0, 18),
          keyHash: digest(secret),
        },
        select: keySelect,
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId: p.id,
          resourceId: result.id,
          action: rotateId ? 'api_key.rotated' : 'api_key.created',
        },
      });
      return result;
    });
    return { success: true, key, secret };
  }
  async revokeKey(p: Principal, id: string) {
    const tenant = await this.auth.requireTenant(p, true);
    await this.infra.database.$transaction(async (tx) => {
      const result = await tx.apiKey.updateMany({
        where: { id, tenantId: tenant.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (!result.count) fail(404, 'NOT_FOUND', 'API key not found.');
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId: p.id,
          resourceId: id,
          action: 'api_key.revoked',
        },
      });
    });
    return { success: true };
  }
  async usage(authorization?: string) {
    if (!authorization?.startsWith('Bearer ') || authorization.length > 200)
      fail(401, 'INVALID_API_KEY', 'A valid server-side API key is required.');
    const key = await this.infra.database.apiKey.findUnique({
      where: { keyHash: digest(authorization.slice(7)) },
      include: { tenant: true },
    });
    if (!key || key.revokedAt)
      fail(401, 'INVALID_API_KEY', 'A valid server-side API key is required.');
    if (
      key.tenant.status === 'SUSPENDED' ||
      (key.tenant.status === 'TRIAL' && key.tenant.trialEndsAt <= new Date())
    )
      fail(
        403,
        'TENANT_INACTIVE',
        'This business is suspended or its trial has expired.',
      );
    if (key.environment !== this.config.API_KEY_ENVIRONMENT)
      fail(
        401,
        'INVALID_API_KEY',
        'This key belongs to a different environment.',
      );
    await this.auth.rate('integration:' + key.id, 60, 60);
    const result = await this.infra.database.apiKey.updateMany({
      where: { id: key.id, revokedAt: null },
      data: { lastUsedAt: new Date() },
    });
    if (!result.count)
      fail(401, 'INVALID_API_KEY', 'A valid server-side API key is required.');
    const credit = await this.infra.database.creditAccount.findUnique({
      where: { tenantId: key.tenantId },
    });
    return {
      success: true,
      tenantId: key.tenantId,
      environment: key.environment,
      subscription: {
        status: key.tenant.status,
        trialEndsAt: key.tenant.trialEndsAt,
      },
      capabilities: {
        events: true,
        automations: true,
        billing: this.config.BILLING_ENABLED,
      },
      billing: {
        enabled: this.config.BILLING_ENABLED,
        model: 'prepaid',
        mode: 'test',
        currency: 'INR',
        availablePaise: credit?.availablePaise ?? 0,
        reservedPaise: credit?.reservedPaise ?? 0,
        blocked: credit?.blocked ?? false,
        emailPricePaise: this.config.BILLING_EMAIL_PRICE_PAISE,
      },
      message:
        'API key verified. Enable email automation before submitting contact events.',
    };
  }
  async admin(p: Principal, search: string) {
    this.auth.requireAdmin(p);
    const where = search
      ? {
          name: {
            contains: search.slice(0, 100),
            mode: 'insensitive' as const,
          },
        }
      : {};
    const [
      total,
      active,
      trial,
      suspended,
      users,
      keys,
      businesses,
      audit,
      groups,
    ] = await Promise.all([
      this.infra.database.tenant.count(),
      this.infra.database.tenant.count({ where: { status: 'ACTIVE' } }),
      this.infra.database.tenant.count({ where: { status: 'TRIAL' } }),
      this.infra.database.tenant.count({ where: { status: 'SUSPENDED' } }),
      this.infra.database.user.count({ where: { role: 'TENANT_ADMIN' } }),
      this.infra.database.apiKey.count({ where: { revokedAt: null } }),
      this.infra.database.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          name: true,
          status: true,
          timezone: true,
          website: true,
          createdAt: true,
          trialEndsAt: true,
          _count: { select: { users: true, apiKeys: true } },
        },
      }),
      this.infra.database.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.infra.database.tenant.groupBy({ by: ['timezone'], _count: true }),
    ]);
    return {
      success: true,
      metrics: { total, active, trial, suspended, users, keys },
      businesses,
      audit,
      timezones: groups,
      capabilities: { billing: false, automations: true, reports: false },
    };
  }
  async changeStatus(p: Principal, id: string, status: 'ACTIVE' | 'SUSPENDED') {
    this.auth.requireAdmin(p);
    await this.infra.database.$transaction(async (tx) => {
      const exists = await tx.tenant.findUnique({ where: { id } });
      if (!exists) fail(404, 'NOT_FOUND', 'Business not found.');
      await tx.tenant.update({ where: { id }, data: { status } });
      await tx.auditLog.create({
        data: {
          actorId: p.id,
          tenantId: id,
          resourceId: id,
          action: status === 'ACTIVE' ? 'tenant.activated' : 'tenant.suspended',
        },
      });
    });
    return { success: true };
  }
}
