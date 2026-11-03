import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { parseConfig } from '../packages/config/src';
import { hashPassword } from '../api/src/security/crypto';
const config = parseConfig(process.env),
  db = new PrismaClient();
const base = config.API_BASE_URL;
const run = randomUUID().slice(0, 8),
  password = 'Local-Test-' + randomUUID();
const userIds: string[] = [],
  tenantIds: string[] = [];
type Tokens = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; tenantId: string; role: string };
};
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
  status = 200,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status,
    method +
      ' ' +
      path +
      ' expected ' +
      status +
      ' got ' +
      response.status +
      ' (' +
      (data.error?.code ?? '') +
      ')',
  );
  assert.ok(response.headers.get('x-request-id'));
  return data;
}
async function account(label: string) {
  const email = 'e2e-' + run + '-' + label + '@example.test';
  await request(
    '/auth/register',
    'POST',
    { email, password, businessName: 'Test ' + run + ' ' + label },
    undefined,
    202,
  );
  const persisted = await db.user.findUniqueOrThrow({ where: { email } });
  userIds.push(persisted.id);
  tenantIds.push(persisted.tenantId!);
  const result: Tokens = await request('/auth/login', 'POST', {
    email,
    password,
  });
  userIds.push(result.user.id);
  tenantIds.push(result.user.tenantId);
  await request('/business', 'GET', undefined, result.accessToken, 403);
  const inbox = await request(
    '/auth/development-inbox',
    'GET',
    undefined,
    result.accessToken,
  );
  const token = new URLSearchParams(
    new URL(inbox.messages[0].body).hash.slice(1),
  ).get('token');
  await request('/auth/verify-email', 'POST', { token });
  await request('/auth/verify-email', 'POST', { token }, undefined, 400);
  return { email, ...result };
}
async function main() {
  assert.equal(
    config.NODE_ENV,
    'development',
    'Account tests require development/mock mode',
  );
  assert.equal(config.MAIL_PROVIDER, 'mock');
  try {
    await request(
      '/auth/register',
      'POST',
      {
        email: 'e2e-' + run + '@example.test',
        password,
        businessName: 'Forged',
        role: 'SUPER_ADMIN',
      },
      undefined,
      400,
    );
    const a = await account('alpha'),
      b = await account('beta');
    await request('/admin/overview', 'GET', undefined, a.accessToken, 403);
    await request('/business', 'GET', undefined, a.accessToken + 'bad', 401);
    await request(
      '/business',
      'PATCH',
      {
        name: 'Alpha renamed',
        timezone: 'Asia/Kolkata',
        website: 'https://example.test',
        description: 'Alpha only',
      },
      a.accessToken,
    );
    await request(
      '/business',
      'PATCH',
      {
        name: 'Forged',
        timezone: 'UTC',
        website: '',
        description: '',
        tenantId: b.user.tenantId,
      },
      a.accessToken,
      400,
    );
    const ka = await request(
      '/api-keys',
      'POST',
      { name: 'Alpha key', environment: 'development' },
      a.accessToken,
      201,
    );
    const kb = await request(
      '/api-keys',
      'POST',
      { name: 'Beta key', environment: 'development' },
      b.accessToken,
      201,
    );
    await request('/api-keys/' + kb.key.id, 'DELETE', {}, a.accessToken, 404);
    await request(
      '/api-keys/' + kb.key.id + '/rotate',
      'POST',
      { name: 'Stolen', environment: 'development' },
      a.accessToken,
      404,
    );
    const own = await request('/api-keys', 'GET', undefined, a.accessToken);
    assert.equal(own.keys.length, 1);
    assert.equal(own.keys[0].id, ka.key.id);
    assert.ok(!JSON.stringify(own).includes(ka.secret));
    assert.ok(!JSON.stringify(own).includes('keyHash'));
    const stored = await db.apiKey.findUniqueOrThrow({
      where: { id: ka.key.id },
    });
    assert.notEqual(stored.keyHash, ka.secret);
    const productionKey = await request(
      '/api-keys',
      'POST',
      { name: 'Production environment key', environment: 'production' },
      a.accessToken,
      201,
    );
    await request('/usage', 'GET', undefined, productionKey.secret, 401);
    await request(
      '/api-keys/' + productionKey.key.id,
      'DELETE',
      {},
      a.accessToken,
    );
    const usage = await request('/usage', 'GET', undefined, ka.secret);
    assert.equal(usage.tenantId, a.user.tenantId);
    assert.equal(usage.environment, 'development');
    const rotated = await request(
      '/api-keys/' + ka.key.id + '/rotate',
      'POST',
      { name: 'Alpha rotated', environment: 'development' },
      a.accessToken,
      201,
    );
    await request('/usage', 'GET', undefined, ka.secret, 401);
    await request('/usage', 'GET', undefined, rotated.secret);
    const admin = await db.user.create({
      data: {
        email: 'e2e-' + run + '-admin@example.test',
        passwordHash: await hashPassword(password),
        role: 'SUPER_ADMIN',
        verifiedAt: new Date(),
      },
    });
    userIds.push(admin.id);
    const at: Tokens = await request('/auth/login', 'POST', {
      email: admin.email,
      password,
    });
    await request('/business', 'GET', undefined, at.accessToken, 403);
    const overview = await request(
      '/admin/overview',
      'GET',
      undefined,
      at.accessToken,
    );
    assert.ok(overview.metrics.total >= 2);
    assert.ok(!JSON.stringify(overview).includes('passwordHash'));
    assert.ok(!JSON.stringify(overview).includes('encryptedBody'));
    await request(
      '/admin/businesses/' + a.user.tenantId + '/status',
      'PATCH',
      { status: 'SUSPENDED' },
      at.accessToken,
    );
    await request('/usage', 'GET', undefined, rotated.secret, 403);
    await request(
      '/api-keys',
      'POST',
      { name: 'Denied', environment: 'production' },
      a.accessToken,
      403,
    );
    await request(
      '/admin/businesses/' + a.user.tenantId + '/status',
      'PATCH',
      { status: 'ACTIVE' },
      at.accessToken,
    );
    await request('/usage', 'GET', undefined, rotated.secret);
    const audit = await db.auditLog.findFirst({
      where: { tenantId: a.user.tenantId, action: 'tenant.suspended' },
    });
    assert.ok(audit);
    const refreshed: Tokens = await request('/auth/refresh', 'POST', {
      refreshToken: a.refreshToken,
    });
    await request(
      '/auth/refresh',
      'POST',
      { refreshToken: a.refreshToken },
      undefined,
      401,
    );
    await request('/business', 'GET', undefined, refreshed.accessToken, 401);
    // Concurrent refresh attempts must revoke the contested session family.
    const raceLogin: Tokens = await request('/auth/login', 'POST', {
      email: a.email,
      password,
    });
    const race = await Promise.all(
      [1, 2].map(() =>
        fetch(base + '/auth/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: raceLogin.refreshToken }),
        }),
      ),
    );
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 401]);
    const raceWinner = await race.find((r) => r.status === 200)!.json();
    await request('/auth/me', 'GET', undefined, raceWinner.accessToken, 401);
    await request(
      '/auth/forgot-password',
      'POST',
      { email: b.email },
      undefined,
      202,
    );
    const mailbox = await request(
      '/auth/development-inbox',
      'GET',
      undefined,
      b.accessToken,
    );
    const reset = mailbox.messages.find((m: { subject: string }) =>
      m.subject.includes('Reset'),
    );
    assert.ok(reset);
    const resetToken = new URLSearchParams(
      new URL(reset.body).hash.slice(1),
    ).get('token');
    const newPassword = password + '-new';
    await request('/auth/reset-password', 'POST', {
      token: resetToken,
      password: newPassword,
    });
    await request(
      '/auth/reset-password',
      'POST',
      { token: resetToken, password: newPassword },
      undefined,
      400,
    );
    await request('/business', 'GET', undefined, b.accessToken, 401);
    await request(
      '/auth/login',
      'POST',
      { email: b.email, password },
      undefined,
      401,
    );
    const b2: Tokens = await request('/auth/login', 'POST', {
      email: b.email,
      password: newPassword,
    });
    await db.tenant.update({
      where: { id: b.user.tenantId },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });
    await request('/usage', 'GET', undefined, kb.secret, 403);
    await request('/auth/logout', 'POST', {}, b2.accessToken);
    await request('/auth/me', 'GET', undefined, b2.accessToken, 401);
    for (let i = 0; i < 2; i++)
      await request(
        '/auth/forgot-password',
        'POST',
        { email: b.email },
        undefined,
        202,
      );
    await request(
      '/auth/forgot-password',
      'POST',
      { email: b.email },
      undefined,
      429,
    );
    for (const [origin, mode, email, pass] of [
      [
        process.env.TEST_USERS_URL ?? config.WEB_ORIGIN,
        'users',
        b.email,
        newPassword,
      ],
      [
        process.env.TEST_ADMIN_URL ?? config.ADMIN_ORIGIN,
        'admin',
        admin.email,
        password,
      ],
    ]) {
      const r = await fetch(origin + '/api/platform/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: mode === 'users' ? config.WEB_ORIGIN : config.ADMIN_ORIGIN,
        },
        body: JSON.stringify({ email, password: pass }),
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(r.status, 200, 'BFF ' + mode + ' login');
      const payload = await r.json();
      assert.ok(!payload.accessToken && !payload.refreshToken);
      const cookies = r.headers.getSetCookie();
      assert.ok(cookies.length === 2);
      assert.ok(
        cookies.every(
          (v) => v.includes('HttpOnly') && v.includes('SameSite=Strict'),
        ),
      );
      const cookie = cookies.map((v) => v.split(';')[0]).join('; ');
      const csrf = await fetch(origin + '/api/platform/auth/logout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://untrusted.example',
          cookie,
        },
        body: '{}',
      });
      assert.equal(csrf.status, 403);
      const me = await fetch(origin + '/api/platform/auth/me', {
        headers: { cookie },
      });
      assert.equal(me.status, 200);
      const oldRefresh = cookies
        .find((v) => v.startsWith('autometa_' + mode + '_refresh='))!
        .split(';')[0]
        .slice(('autometa_' + mode + '_refresh=').length);
      const expiredCookie = cookie.replace(
        new RegExp('autometa_' + mode + '_access=[^;]+'),
        'autometa_' + mode + '_access=expired',
      );
      const renew = await fetch(origin + '/api/platform/auth/me', {
        headers: { cookie: expiredCookie },
      });
      assert.equal(renew.status, 200);
      assert.equal(renew.headers.getSetCookie().length, 2);
      await request(
        '/auth/refresh',
        'POST',
        { refreshToken: oldRefresh },
        undefined,
        401,
      );
    }
    console.log(
      'PASS: verification/reset, JWT and refresh rotation/replay, tenant isolation, API-key ownership/rotation/revocation, trial expiry, admin suspension/audit, BFF HttpOnly cookies/refresh and CSRF',
    );
  } finally {
    if (userIds.length) {
      await db.auditLog.deleteMany({
        where: {
          OR: [{ actorId: { in: userIds } }, { tenantId: { in: tenantIds } }],
        },
      });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (tenantIds.length)
      await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await db.$disconnect();
  }
}
const timer = setTimeout(() => {
  console.error('FAIL: account integration deadline');
  process.exit(1);
}, 180000);
void main()
  .catch((e) => {
    console.error(
      'FAIL: ' +
        (e instanceof Error ? e.message : 'Account integration failed'),
    );
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(timer));
