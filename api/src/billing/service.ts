import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { InfrastructureService } from '../infrastructure.service';
import { AuthService, type Principal } from '../security/auth.service';
import { fail } from '../security/dto';
import { digest } from '../security/crypto';
import { parseConfig } from '../../../packages/config/src';
import { lockedAccount } from '../../../packages/email/src/credits';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type GatewayPayment,
  validSignature,
  PaymentProviderError,
} from './provider';
export const packs = [
  { id: 'starter', amountPaise: 10000 },
  { id: 'growth', amountPaise: 50000 },
  { id: 'scale', amountPaise: 100000 },
] as const;
const topUpSelect = {
  id: true,
  packId: true,
  amountPaise: true,
  currency: true,
  status: true,
  providerOrderId: true,
  providerPaymentId: true,
  refundedPaise: true,
  disputed: true,
  paidAt: true,
  createdAt: true,
  errorCode: true,
} as const;
@Injectable()
export class BillingService {
  readonly config = parseConfig(process.env);
  constructor(
    @Inject(InfrastructureService)
    private readonly infra: InfrastructureService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: PaymentProvider,
  ) {}
  private enabled() {
    if (!this.config.BILLING_ENABLED)
      fail(503, 'BILLING_DISABLED', 'Prepaid billing is not enabled.');
  }
  async overview(p: Principal) {
    const tenant = await this.auth.requireTenant(p);
    const [account, ledger, topups, waiting] = await Promise.all([
      this.infra.database.creditAccount.findUnique({
        where: { tenantId: tenant.id },
      }),
      this.infra.database.creditLedger.findMany({
        where: { tenantId: tenant.id },
        take: 50,
        orderBy: { createdAt: 'desc' },
      }),
      this.infra.database.creditTopUp.findMany({
        where: { tenantId: tenant.id },
        take: 30,
        orderBy: { createdAt: 'desc' },
        select: topUpSelect,
      }),
      this.infra.database.outboundEmail.count({
        where: { tenantId: tenant.id, status: 'WAITING_CREDITS' },
      }),
    ]);
    return {
      success: true,
      enabled: this.config.BILLING_ENABLED,
      mode: 'test',
      currency: 'INR',
      packs,
      emailPricePaise: this.config.BILLING_EMAIL_PRICE_PAISE,
      lowBalanceThresholdPaise: this.config.BILLING_LOW_BALANCE_PAISE,
      balance: {
        availablePaise: account?.availablePaise ?? 0,
        reservedPaise: account?.reservedPaise ?? 0,
        blocked: account?.blocked ?? false,
      },
      waitingEmails: waiting,
      ledger,
      topups,
      webhookConfigured: !!this.config.RAZORPAY_WEBHOOK_SECRET,
    };
  }
  async create(p: Principal, packId: string, idempotencyKey: string) {
    this.enabled();
    const tenant = await this.auth.requireTenant(p);
    if (tenant.status === 'SUSPENDED')
      fail(403, 'TENANT_INACTIVE', 'This workspace is suspended.');
    const pack = packs.find((x) => x.id === packId);
    if (!pack) fail(400, 'INVALID_PACK', 'Choose a listed credit pack.');
    await this.auth.rate('billing-order:' + tenant.id, 10, 60);
    const { order, fresh } = await this.infra.database.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Tenant" WHERE "id"=${tenant.id}::uuid FOR UPDATE`,
        );
        const previous = await tx.creditTopUp.findUnique({
          where: {
            tenantId_idempotencyKey: { tenantId: tenant.id, idempotencyKey },
          },
        });
        if (previous) {
          if (previous.packId !== packId)
            fail(
              409,
              'IDEMPOTENCY_CONFLICT',
              'This request ID was used for another pack.',
            );
          return { order: previous, fresh: false };
        }
        return {
          order: await tx.creditTopUp.create({
            data: {
              tenantId: tenant.id,
              packId,
              idempotencyKey,
              amountPaise: pack.amountPaise,
            },
          }),
          fresh: true,
        };
      },
    );
    if (!fresh) {
      if (!order.providerOrderId)
        fail(
          409,
          'ORDER_NOT_READY',
          'Order creation is pending or requires review. Do not retry payment for an uncertain order.',
        );
      return this.checkout(
        order.id,
        order.providerOrderId,
        order.amountPaise,
        order.status,
      );
    }
    try {
      const remote = await this.gateway.createOrder(
        order.amountPaise,
        order.id,
      );
      await this.infra.database.creditTopUp.update({
        where: { id: order.id },
        data: { providerOrderId: remote.id, status: 'CREATED' },
      });
      return this.checkout(order.id, remote.id, order.amountPaise, 'CREATED');
    } catch (e) {
      const code =
        e instanceof PaymentProviderError
          ? e.code
          : 'ORDER_PERSISTENCE_UNCERTAIN';
      await this.infra.database.creditTopUp.updateMany({
        where: { id: order.id, status: 'CREATING' },
        data: { status: 'CREATION_UNKNOWN', errorCode: code },
      });
      fail(
        503,
        'GATEWAY_UNAVAILABLE',
        'Could not confirm checkout creation. Refresh payment history before trying again.',
      );
    }
  }
  private checkout(
    id: string,
    providerOrderId: string,
    amountPaise: number,
    status: string,
  ) {
    return {
      success: true,
      topUpId: id,
      providerOrderId,
      amountPaise,
      currency: 'INR',
      keyId: this.config.RAZORPAY_KEY_ID,
      status,
      mode: 'test',
    };
  }
  async resume(p: Principal, id: string) {
    this.enabled();
    const tenant = await this.auth.requireTenant(p);
    if (tenant.status === 'SUSPENDED')
      fail(403, 'TENANT_INACTIVE', 'This workspace is suspended.');
    const order = await this.infra.database.creditTopUp.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!order?.providerOrderId) fail(404, 'NOT_FOUND', 'Checkout not found.');
    if (order.status !== 'CREATED')
      fail(
        409,
        'ORDER_NOT_PAYABLE',
        'This order cannot be paid again. Check payment history.',
      );
    return this.checkout(
      order.id,
      order.providerOrderId,
      order.amountPaise,
      order.status,
    );
  }
  async verify(
    p: Principal,
    input: { topUpId: string; paymentId: string; signature: string },
  ) {
    this.enabled();
    const tenant = await this.auth.requireTenant(p);
    await this.auth.rate('billing-verify:' + tenant.id, 30, 60);
    const order = await this.infra.database.creditTopUp.findFirst({
      where: { id: input.topUpId, tenantId: tenant.id },
    });
    if (!order?.providerOrderId)
      fail(404, 'NOT_FOUND', 'Payment order not found.');
    if (
      !validSignature(
        order.providerOrderId + '|' + input.paymentId,
        input.signature,
        this.config.RAZORPAY_KEY_SECRET,
      )
    )
      fail(400, 'INVALID_SIGNATURE', 'Payment verification failed.');
    const payment = await this.fetchPayment(input.paymentId);
    return this.applyPayment(payment, undefined, order.id);
  }
  private async fetchPayment(id: string) {
    try {
      return await this.gateway.payment(id);
    } catch {
      fail(
        503,
        'GATEWAY_UNAVAILABLE',
        'Payment status could not be confirmed. Use Check status again shortly.',
      );
    }
  }
  async reconcile(p: Principal, id: string) {
    this.enabled();
    const tenant = await this.auth.requireTenant(p);
    await this.auth.rate('billing-reconcile:' + tenant.id, 30, 60);
    const order = await this.infra.database.creditTopUp.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!order?.providerOrderId)
      fail(404, 'NOT_FOUND', 'Payment order not found.');
    let payment: GatewayPayment | undefined;
    if (order.providerPaymentId)
      payment = await this.fetchPayment(order.providerPaymentId);
    else {
      try {
        const list = await this.gateway.orderPayments(order.providerOrderId);
        payment = list.find(
          (x) => x.captured && ['captured', 'refunded'].includes(x.status),
        );
      } catch {
        fail(
          503,
          'GATEWAY_UNAVAILABLE',
          'Payment status could not be confirmed.',
        );
      }
    }
    if (!payment)
      return {
        success: true,
        credited: false,
        status: 'PENDING',
        message: 'No captured payment confirmed yet.',
      };
    return this.applyPayment(payment, undefined, order.id);
  }
  private async applyPayment(
    payment: GatewayPayment,
    event?: { id: string; hash: string; type: string },
    expectedId?: string,
  ) {
    const order = await this.infra.database.creditTopUp.findUnique({
      where: { providerOrderId: payment.order_id },
    });
    if (!order) {
      if (event) return { success: true, ignored: true };
      fail(404, 'NOT_FOUND', 'Payment order not found.');
    }
    if (expectedId && order.id !== expectedId)
      fail(400, 'PAYMENT_MISMATCH', 'Payment does not match the stored order.');
    if (
      payment.amount !== order.amountPaise ||
      payment.currency !== order.currency ||
      payment.amount_refunded > payment.amount
    )
      fail(
        400,
        'PAYMENT_MISMATCH',
        'Payment amount or currency does not match.',
      );
    if (!payment.captured || !['captured', 'refunded'].includes(payment.status))
      return {
        success: true,
        credited: false,
        status: 'PENDING',
        message: 'Payment is not captured yet.',
      };
    return this.infra.database.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "CreditTopUp" WHERE "id"=${order.id}::uuid FOR UPDATE`,
      );
      const current = await tx.creditTopUp.findUniqueOrThrow({
        where: { id: order.id },
      });
      if (current.providerPaymentId && current.providerPaymentId !== payment.id)
        fail(
          409,
          'PAYMENT_MISMATCH',
          'Another payment is already recorded for this order.',
        );
      if (event) {
        const old = await tx.paymentWebhook.findUnique({
          where: { eventId: event.id },
        });
        if (old) {
          if (old.payloadHash !== event.hash)
            fail(409, 'WEBHOOK_CONFLICT', 'Conflicting event identity.');
          return {
            success: true,
            credited: !!current.paidAt,
            status: current.status,
            duplicate: true,
          };
        }
      }
      await lockedAccount(tx, current.tenantId);
      if (!current.paidAt) {
        await tx.creditAccount.update({
          where: { tenantId: current.tenantId },
          data: { availablePaise: { increment: current.amountPaise } },
        });
        await tx.creditLedger.create({
          data: {
            tenantId: current.tenantId,
            kind: 'TOP_UP',
            amountPaise: current.amountPaise,
            reference: 'topup:' + current.id,
            description: 'Razorpay test credit purchase',
          },
        });
        await tx.tenant.updateMany({
          where: { id: current.tenantId, status: 'TRIAL' },
          data: { status: 'ACTIVE' },
        });
        await tx.auditLog.create({
          data: {
            tenantId: current.tenantId,
            actorId: 'payment-provider',
            resourceId: current.id,
            action: 'billing.top_up_verified',
          },
        });
      }
      const refund = Math.max(current.refundedPaise, payment.amount_refunded);
      if (refund > current.refundedPaise) {
        const delta = refund - current.refundedPaise;
        await tx.creditAccount.update({
          where: { tenantId: current.tenantId },
          data: { availablePaise: { decrement: delta } },
        });
        await tx.creditLedger.create({
          data: {
            tenantId: current.tenantId,
            kind: 'REFUND',
            amountPaise: -delta,
            reference: 'refund:' + current.id + ':' + refund,
            description: 'Verified gateway refund deducted from usage credits',
          },
        });
      }
      const disputed =
        current.disputed || !!event?.type.startsWith('payment.dispute.');
      if (disputed)
        await tx.creditAccount.update({
          where: { tenantId: current.tenantId },
          data: { blocked: true },
        });
      const status = disputed
        ? 'REVIEW'
        : refund === current.amountPaise
          ? 'REFUNDED'
          : refund > 0
            ? 'PARTIALLY_REFUNDED'
            : 'PAID';
      await tx.creditTopUp.update({
        where: { id: current.id },
        data: {
          providerPaymentId: payment.id,
          paidAt: current.paidAt ?? new Date(),
          refundedPaise: refund,
          disputed,
          status,
          errorCode: null,
        },
      });
      if (event)
        await tx.paymentWebhook.create({
          data: {
            eventId: event.id,
            payloadHash: event.hash,
            eventType: event.type,
          },
        });
      return {
        success: true,
        credited: true,
        status,
        duplicate: !!current.paidAt,
      };
    });
  }
  async webhook(
    raw: Buffer,
    signature: string | undefined,
    eventId: string | undefined,
  ) {
    this.enabled();
    if (!validSignature(raw, signature, this.config.RAZORPAY_WEBHOOK_SECRET))
      fail(400, 'INVALID_SIGNATURE', 'Webhook verification failed.');
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      fail(400, 'INVALID_REQUEST', 'Invalid JSON.');
    }
    const parsed = z
      .object({
        event: z.string().max(100),
        payload: z.object({
          payment: z
            .object({ entity: z.object({ id: z.string() }) })
            .optional(),
          refund: z
            .object({ entity: z.object({ payment_id: z.string() }) })
            .optional(),
          dispute: z
            .object({ entity: z.object({ payment_id: z.string() }) })
            .optional(),
        }),
      })
      .safeParse(body);
    if (!parsed.success) fail(400, 'INVALID_REQUEST', 'Invalid payment event.');
    const type = parsed.data.event;
    if (
      !['payment.captured', 'order.paid', 'refund.processed'].includes(type) &&
      !type.startsWith('payment.dispute.')
    )
      return { success: true, ignored: true };
    const paymentId =
      parsed.data.payload.payment?.entity.id ??
      parsed.data.payload.refund?.entity.payment_id ??
      parsed.data.payload.dispute?.entity.payment_id;
    if (!paymentId || !/^pay_[A-Za-z0-9]{1,90}$/.test(paymentId))
      fail(400, 'INVALID_REQUEST', 'Payment identifier missing.');
    const hash = digest(raw.toString('utf8'));
    const id =
      eventId && /^[A-Za-z0-9_:-]{1,160}$/.test(eventId) ? eventId : hash;
    const payment = await this.fetchPayment(paymentId);
    return this.applyPayment(payment, { id, hash, type });
  }
  async admin(p: Principal) {
    this.auth.requireAdmin(p);
    const [accounts, topups, totals] = await Promise.all([
      this.infra.database.creditAccount.findMany({
        take: 50,
        orderBy: { updatedAt: 'desc' },
        include: { tenant: { select: { name: true } } },
      }),
      this.infra.database.creditTopUp.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { name: true } } },
      }),
      this.infra.database.creditAccount.aggregate({
        _sum: { availablePaise: true, reservedPaise: true },
      }),
    ]);
    return {
      success: true,
      mode: 'test',
      enabled: this.config.BILLING_ENABLED,
      accounts,
      topups,
      totals: totals._sum,
    };
  }
}
