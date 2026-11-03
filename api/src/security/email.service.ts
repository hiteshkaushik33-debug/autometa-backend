import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { parseConfig } from '../../../packages/config/src';
import { enqueueEmail } from '../../../packages/email/src/store';
import { seal } from './crypto';
@Injectable()
export class EmailService {
  private readonly config = parseConfig(process.env);
  async queue(
    tx: Prisma.TransactionClient,
    userId: string,
    subject: string,
    body: string,
  ) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const expiresAt = new Date(Date.now() + 30 * 60000);
    await enqueueEmail(
      tx,
      {
        tenantId: user.tenantId,
        userId,
        purpose: 'AUTH',
        to: user.email,
        subject,
        text: body,
        expiresAt,
      },
      this.config,
    );
    if (this.config.MAIL_PROVIDER === 'mock')
      await tx.mockEmail.create({
        data: {
          userId,
          subject,
          encryptedBody: seal(body, this.config.AUTH_JWT_SECRET!),
          expiresAt,
        },
      });
  }
}
