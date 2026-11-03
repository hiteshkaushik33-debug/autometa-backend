import { Injectable, Inject } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { Prisma, TokenPurpose, User } from '@prisma/client';
import { InfrastructureService } from '../infrastructure.service';
import { parseConfig } from '../../../packages/config/src';
import {
  digest,
  opaqueToken,
  hashPassword,
  verifyPassword,
  unseal,
} from './crypto';
import { fail } from './dto';
import { EmailService } from './email.service';

export type Principal = Pick<
  User,
  'id' | 'email' | 'role' | 'tenantId' | 'verifiedAt'
> & { sessionId: string };
export const userView = (
  u: Pick<User, 'id' | 'email' | 'role' | 'tenantId' | 'verifiedAt'>,
) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  tenantId: u.tenantId,
  verified: !!u.verifiedAt,
});
@Injectable()
export class AuthService {
  private readonly config = parseConfig(process.env);
  mailRuntime() {
    return {
      provider: this.config.MAIL_PROVIDER,
      testMode: this.config.EMAIL_TEST_MODE,
    };
  }
  private readonly secret: string;
  private readonly dummyHash: Promise<string>;
  constructor(
    @Inject(InfrastructureService) readonly infra: InfrastructureService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {
    if (!this.config.AUTH_JWT_SECRET)
      throw new Error('AUTH_JWT_SECRET is required');
    this.secret = this.config.AUTH_JWT_SECRET;
    this.dummyHash = hashPassword(opaqueToken());
  }
  async rate(bucket: string, limit = 20, seconds = 900) {
    const result = await this.infra.redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
      1,
      'auth:' + digest(bucket),
      seconds,
    );
    if (Number(result) > limit)
      fail(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }
  private sign(userId: string, sessionId: string) {
    return jwt.sign({ sid: sessionId }, this.secret, {
      subject: userId,
      issuer: 'autometa',
      audience: 'autometa-dashboard',
      algorithm: 'HS256',
      expiresIn: 900,
    });
  }
  private async session(user: User) {
    const raw = opaqueToken();
    const session = await this.infra.database.session.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 86400_000),
        credentials: { create: { tokenHash: digest(raw) } },
      },
    });
    return {
      success: true,
      user: userView(user),
      accessToken: this.sign(user.id, session.id),
      refreshToken: raw,
    };
  }
  async register(input: {
    email: string;
    password: string;
    businessName: string;
  }) {
    const passwordHash = await hashPassword(input.password);
    const raw = opaqueToken();
    try {
      await this.infra.database.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: input.businessName },
        });
        const user = await tx.user.create({
          data: { email: input.email, passwordHash, tenantId: tenant.id },
        });
        await tx.accountToken.create({
          data: {
            userId: user.id,
            tokenHash: digest(raw),
            purpose: 'VERIFY',
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
        await this.email.queue(
          tx,
          user.id,
          'Verify your Autometa email',
          this.config.WEB_ORIGIN + '/verify#token=' + raw,
        );
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            tenantId: tenant.id,
            resourceId: tenant.id,
            action: 'tenant.registered',
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(
          409,
          'ACCOUNT_EXISTS',
          'An account with this email already exists.',
        );
      throw error;
    }
    return {
      success: true,
      message:
        'Account created. Check your email, or your development inbox in mock mode, to verify.',
    };
  }
  async login(input: { email: string; password: string }) {
    await this.rate('login-email:' + input.email, 10);
    const user = await this.infra.database.user.findUnique({
      where: { email: input.email },
    });
    const valid = await verifyPassword(
      user?.passwordHash ?? (await this.dummyHash),
      input.password,
    );
    if (!user || !valid)
      fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    return this.session(user);
  }
  async principal(req: Request, verified = true): Promise<Principal> {
    const bearer = req.header('authorization');
    if (!bearer?.startsWith('Bearer '))
      fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    let sub: string, sid: string;
    try {
      const payload = jwt.verify(bearer.slice(7), this.secret, {
        algorithms: ['HS256'],
        issuer: 'autometa',
        audience: 'autometa-dashboard',
        maxAge: '15m',
      });
      if (
        typeof payload === 'string' ||
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string'
      )
        throw new Error();
      sub = payload.sub;
      sid = payload.sid;
    } catch {
      fail(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.');
    }
    const session = await this.infra.database.session.findFirst({
      where: {
        id: sid,
        userId: sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
    if (!session)
      fail(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.');
    if (verified && !session.user.verifiedAt)
      fail(403, 'EMAIL_UNVERIFIED', 'Verify your email before continuing.');
    return {
      ...userView(session.user),
      verifiedAt: session.user.verifiedAt,
      sessionId: sid,
    } as Principal;
  }
  async requireTenant(p: Principal, active = false) {
    if (p.role !== 'TENANT_ADMIN' || !p.tenantId)
      fail(403, 'FORBIDDEN', 'Business access required.');
    const tenant = await this.infra.database.tenant.findUnique({
      where: { id: p.tenantId },
    });
    if (!tenant) fail(403, 'FORBIDDEN', 'Business access required.');
    if (
      active &&
      (tenant.status === 'SUSPENDED' ||
        (tenant.status === 'TRIAL' && tenant.trialEndsAt <= new Date()))
    )
      fail(
        403,
        'TENANT_INACTIVE',
        'This business is suspended or its trial has expired.',
      );
    return tenant;
  }
  requireAdmin(p: Principal) {
    if (p.role !== 'SUPER_ADMIN')
      fail(403, 'FORBIDDEN', 'Administrator access required.');
  }
  async refresh(raw: string) {
    const credential = await this.infra.database.refreshCredential.findUnique({
      where: { tokenHash: digest(raw) },
      include: { session: { include: { user: true } } },
    });
    if (
      !credential ||
      credential.session.revokedAt ||
      credential.session.expiresAt <= new Date()
    )
      fail(401, 'UNAUTHENTICATED', 'Sign in again.');
    if (credential.usedAt) {
      await this.infra.database.session.update({
        where: { id: credential.sessionId },
        data: { revokedAt: new Date() },
      });
      fail(401, 'TOKEN_REUSED', 'Session revoked. Sign in again.');
    }
    const next = opaqueToken();
    const won = await this.infra.database.$transaction(async (tx) => {
      const result = await tx.refreshCredential.updateMany({
        where: {
          id: credential.id,
          usedAt: null,
          session: { revokedAt: null, expiresAt: { gt: new Date() } },
        },
        data: { usedAt: new Date() },
      });
      if (result.count !== 1) return false;
      await tx.refreshCredential.create({
        data: { sessionId: credential.sessionId, tokenHash: digest(next) },
      });
      return true;
    });
    if (!won) {
      await this.infra.database.session.update({
        where: { id: credential.sessionId },
        data: { revokedAt: new Date() },
      });
      fail(401, 'TOKEN_REUSED', 'Session revoked. Sign in again.');
    }
    return {
      success: true,
      user: userView(credential.session.user),
      accessToken: this.sign(credential.session.userId, credential.sessionId),
      refreshToken: next,
    };
  }
  async logout(p: Principal) {
    await this.infra.database.session.updateMany({
      where: { id: p.sessionId, userId: p.id },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }
  async challenge(userId: string, purpose: TokenPurpose) {
    const raw = opaqueToken();
    await this.infra.database.$transaction(async (tx) => {
      await tx.accountToken.updateMany({
        where: { userId, purpose, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.accountToken.create({
        data: {
          userId,
          purpose,
          tokenHash: digest(raw),
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
      await tx.mockEmail.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      await this.email.queue(
        tx,
        userId,
        purpose === 'VERIFY'
          ? 'Verify your Autometa email'
          : 'Reset your Autometa password',
        this.config.WEB_ORIGIN +
          (purpose === 'VERIFY' ? '/verify#token=' : '/reset-password#token=') +
          raw,
      );
    });
  }
  async forgot(email: string) {
    const user = await this.infra.database.user.findUnique({
      where: { email },
    });
    if (user) await this.challenge(user.id, 'RESET');
    return {
      success: true,
      message: 'If the account exists, a reset email has been prepared.',
    };
  }
  async consume(raw: string, purpose: TokenPurpose, password?: string) {
    const token = await this.infra.database.accountToken.findUnique({
      where: { tokenHash: digest(raw) },
    });
    if (
      !token ||
      token.purpose !== purpose ||
      token.usedAt ||
      token.expiresAt <= new Date()
    )
      fail(400, 'INVALID_TOKEN', 'This link is invalid or expired.');
    const passwordHash = password ? await hashPassword(password) : undefined;
    await this.infra.database.$transaction(async (tx) => {
      const won = await tx.accountToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (!won.count)
        fail(400, 'INVALID_TOKEN', 'This link is invalid or expired.');
      await tx.user.update({
        where: { id: token.userId },
        data:
          purpose === 'VERIFY' ? { verifiedAt: new Date() } : { passwordHash },
      });
      if (purpose === 'RESET')
        await tx.session.updateMany({
          where: { userId: token.userId },
          data: { revokedAt: new Date() },
        });
      await tx.auditLog.create({
        data: {
          actorId: token.userId,
          action:
            purpose === 'VERIFY'
              ? 'auth.email_verified'
              : 'auth.password_reset',
          resourceId: token.userId,
        },
      });
    });
    return { success: true };
  }
  async inbox(p: Principal) {
    if (
      this.config.NODE_ENV !== 'development' ||
      this.config.MAIL_PROVIDER !== 'mock'
    )
      fail(404, 'NOT_FOUND', 'Not found.');
    const messages = await this.infra.database.mockEmail.findMany({
      where: { userId: p.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return {
      success: true,
      provider: 'mock',
      messages: messages.map((m) => ({
        id: m.id,
        subject: m.subject,
        body: unseal(m.encryptedBody, this.secret),
        createdAt: m.createdAt,
      })),
    };
  }
}
