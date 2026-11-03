import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { parseConfig } from '../packages/config/src';
import { unseal } from '../api/src/security/crypto';
async function main() {
  const config = parseConfig(process.env);
  if (
    config.NODE_ENV !== 'development' ||
    config.MAIL_PROVIDER !== 'mock' ||
    !config.AUTH_JWT_SECRET
  )
    throw new Error();
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error();
  const db = new PrismaClient();
  try {
    const messages = await db.mockEmail.findMany({
      where: { user: { email }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    for (const message of messages)
      console.log(
        message.subject +
          '\n' +
          unseal(message.encryptedBody, config.AUTH_JWT_SECRET),
      );
    if (!messages.length) console.log('No unexpired local mock messages.');
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    'Development inbox requires mock/development mode and an account email argument.',
  );
  process.exitCode = 1;
});
