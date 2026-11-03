import 'dotenv/config';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { hashPassword, opaqueToken } from '../api/src/security/crypto';
import { parseConfig } from '../packages/config/src';

async function main() {
  const config = parseConfig(process.env);
  const db = new PrismaClient();
  try {
    const email =
      process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
      (config.NODE_ENV === 'development' ? 'admin@autometa.local' : undefined);
    const password =
      process.env.SUPER_ADMIN_PASSWORD ??
      (config.NODE_ENV === 'development' ? opaqueToken() : undefined);
    if (!email || !password || password.length < 16)
      throw new Error(
        'Set SUPER_ADMIN_EMAIL and a password of at least 16 characters.',
      );
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== 'SUPER_ADMIN')
        throw new Error('Refusing to promote an existing business account.');
      console.log('Admin already exists. No password or role changed.');
      return;
    }
    if (
      config.NODE_ENV === 'development' &&
      existsSync('.local/admin-credentials.txt')
    )
      throw new Error(
        'Existing credentials file must be reviewed before provisioning another admin.',
      );
    const passwordHash = await hashPassword(password);
    await db.$transaction(async (tx) => {
      const admin = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: 'SUPER_ADMIN',
          verifiedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: 'trusted-bootstrap',
          resourceId: admin.id,
          action: 'admin.provisioned',
        },
      });
    });
    if (config.NODE_ENV === 'development') {
      mkdirSync('.local', { recursive: true });
      writeFileSync(
        '.local/admin-credentials.txt',
        'Admin URL: ' +
          config.ADMIN_ORIGIN +
          '\nEmail: ' +
          email +
          '\nPassword: ' +
          password +
          '\n',
        { mode: 0o600, flag: 'wx' },
      );
      console.log(
        'Admin created. Credentials are in .local/admin-credentials.txt (never committed).',
      );
    } else console.log('Admin provisioned using supplied server environment.');
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    'Admin bootstrap failed. Check configuration, uniqueness and existing credentials file.',
  );
  process.exitCode = 1;
});
