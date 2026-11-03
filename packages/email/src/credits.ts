import { Prisma } from '@prisma/client';
export async function lockedAccount(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  await tx.$executeRaw(
    Prisma.sql`INSERT INTO "CreditAccount" ("tenantId","updatedAt") VALUES (${tenantId}::uuid,NOW()) ON CONFLICT ("tenantId") DO NOTHING`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "tenantId" FROM "CreditAccount" WHERE "tenantId"=${tenantId}::uuid FOR UPDATE`,
  );
  return tx.creditAccount.findUniqueOrThrow({ where: { tenantId } });
}
export async function reserveEmailCredit(
  tx: Prisma.TransactionClient,
  email: {
    id: string;
    tenantId: string | null;
    billingCostPaise: number | null;
  },
) {
  const cost = email.billingCostPaise ?? 0;
  if (!cost) return 'reserved' as const;
  if (!email.tenantId) throw new Error('BILLABLE_TENANT_REQUIRED');
  const account = await lockedAccount(tx, email.tenantId);
  const old = await tx.emailCreditHold.findUnique({
    where: { emailId: email.id },
  });
  if (old) {
    if (old.state !== 'HELD' || old.amountPaise !== cost)
      throw new Error('CREDIT_STATE_INVALID');
    return account.blocked
      ? ('blocked' as const)
      : account.availablePaise < 0
        ? ('insufficient' as const)
        : ('reserved' as const);
  }
  if (account.blocked) return 'blocked' as const;
  if (account.availablePaise < cost) return 'insufficient' as const;
  await tx.creditAccount.update({
    where: { tenantId: email.tenantId },
    data: {
      availablePaise: { decrement: cost },
      reservedPaise: { increment: cost },
    },
  });
  await tx.emailCreditHold.create({
    data: { emailId: email.id, tenantId: email.tenantId, amountPaise: cost },
  });
  await tx.creditLedger.create({
    data: {
      tenantId: email.tenantId,
      kind: 'RESERVE',
      amountPaise: -cost,
      reservedDeltaPaise: cost,
      reference: 'reserve:' + email.id,
      description: 'Reserved for outbound email',
    },
  });
  return 'reserved' as const;
}
export async function settleEmailCredit(
  tx: Prisma.TransactionClient,
  emailId: string,
  tenantId: string | null,
  outcome: 'CAPTURE' | 'RELEASE',
) {
  if (!tenantId) return;
  const hold = await tx.emailCreditHold.findUnique({ where: { emailId } });
  if (!hold || hold.tenantId !== tenantId || hold.state !== 'HELD') return;
  await lockedAccount(tx, tenantId);
  const updated = await tx.emailCreditHold.updateMany({
    where: { emailId, tenantId, state: 'HELD' },
    data: { state: outcome === 'CAPTURE' ? 'CAPTURED' : 'RELEASED' },
  });
  if (!updated.count) return;
  await tx.creditAccount.update({
    where: { tenantId },
    data: {
      reservedPaise: { decrement: hold.amountPaise },
      ...(outcome === 'RELEASE'
        ? { availablePaise: { increment: hold.amountPaise } }
        : {}),
    },
  });
  await tx.creditLedger.create({
    data: {
      tenantId,
      kind: outcome === 'CAPTURE' ? 'CHARGE' : 'RELEASE',
      amountPaise: outcome === 'RELEASE' ? hold.amountPaise : 0,
      reservedDeltaPaise: -hold.amountPaise,
      reference: outcome.toLowerCase() + ':' + emailId,
      description:
        outcome === 'CAPTURE'
          ? 'Outbound email accepted by provider'
          : 'Unused email reservation released',
    },
  });
}
