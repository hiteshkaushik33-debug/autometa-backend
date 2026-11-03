import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../../../packages/config/src';
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const paymentSchema = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  amount: z.number().int().positive(),
  currency: z.literal('INR'),
  status: z.string(),
  captured: z.boolean(),
  amount_refunded: z.number().int().min(0).default(0),
});
export type GatewayPayment = z.infer<typeof paymentSchema>;
export type GatewayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
};
export interface PaymentProvider {
  createOrder(amount: number, receipt: string): Promise<GatewayOrder>;
  payment(id: string): Promise<GatewayPayment>;
  orderPayments(id: string): Promise<GatewayPayment[]>;
}
export class PaymentProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function validSignature(
  body: Buffer | string,
  signature: string | undefined,
  secret: string,
) {
  if (!secret || !signature || !/^[a-fA-F0-9]{64}$/.test(signature))
    return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
export class RazorpayTestProvider implements PaymentProvider {
  constructor(private readonly config: Config) {}
  private async call(path: string, body?: unknown): Promise<unknown> {
    if (
      !this.config.RAZORPAY_KEY_ID.startsWith('rzp_test_') ||
      !this.config.RAZORPAY_KEY_SECRET
    )
      throw new PaymentProviderError('TEST_KEYS_REQUIRED');
    try {
      const response = await fetch('https://api.razorpay.com/v1/' + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          authorization:
            'Basic ' +
            Buffer.from(
              this.config.RAZORPAY_KEY_ID +
                ':' +
                this.config.RAZORPAY_KEY_SECRET,
            ).toString('base64'),
          'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok)
        throw new PaymentProviderError(
          response.status === 401
            ? 'GATEWAY_AUTH_FAILED'
            : response.status >= 500
              ? 'GATEWAY_UNAVAILABLE'
              : 'GATEWAY_REQUEST_REJECTED',
        );
      return await response.json();
    } catch (e) {
      if (e instanceof PaymentProviderError) throw e;
      throw new PaymentProviderError('GATEWAY_OUTCOME_UNKNOWN');
    }
  }
  async createOrder(amount: number, receipt: string) {
    const r = await this.call('orders', {
      amount,
      currency: 'INR',
      receipt,
      partial_payment: false,
    });
    const parsed = z
      .object({
        id: z.string().regex(/^order_[A-Za-z0-9]+$/),
        amount: z.number().int(),
        currency: z.string(),
        receipt: z.string(),
      })
      .safeParse(r);
    if (
      !parsed.success ||
      parsed.data.amount !== amount ||
      parsed.data.currency !== 'INR' ||
      parsed.data.receipt !== receipt
    )
      throw new PaymentProviderError('GATEWAY_RESPONSE_INVALID');
    return parsed.data;
  }
  async payment(id: string) {
    if (!/^pay_[A-Za-z0-9]{1,90}$/.test(id))
      throw new PaymentProviderError('PAYMENT_ID_INVALID');
    const p = paymentSchema.safeParse(await this.call('payments/' + id));
    if (!p.success || p.data.id !== id)
      throw new PaymentProviderError('GATEWAY_RESPONSE_INVALID');
    return p.data;
  }
  async orderPayments(id: string) {
    if (!/^order_[A-Za-z0-9]{1,90}$/.test(id))
      throw new PaymentProviderError('ORDER_ID_INVALID');
    const p = z
      .object({ items: z.array(paymentSchema) })
      .safeParse(await this.call('orders/' + id + '/payments'));
    if (!p.success) throw new PaymentProviderError('GATEWAY_RESPONSE_INVALID');
    return p.data.items;
  }
}
// In-memory provider is selected only for NODE_ENV=test. No public capture endpoint exists.
export class MockPaymentProvider implements PaymentProvider {
  readonly orders = new Map<string, GatewayOrder>();
  readonly payments = new Map<string, GatewayPayment>();
  async createOrder(amount: number, receipt: string) {
    const order = {
      id: 'order_' + randomUUID().replaceAll('-', ''),
      amount,
      currency: 'INR',
      receipt,
    };
    this.orders.set(order.id, order);
    return order;
  }
  capture(orderId: string, status = 'captured') {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const p: GatewayPayment = {
      id: 'pay_' + randomUUID().replaceAll('-', ''),
      order_id: orderId,
      amount: order.amount,
      currency: 'INR',
      status,
      captured: status === 'captured',
      amount_refunded: 0,
    };
    this.payments.set(p.id, p);
    return p;
  }
  async payment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new PaymentProviderError('PAYMENT_NOT_FOUND');
    return { ...p };
  }
  async orderPayments(id: string) {
    return [...this.payments.values()]
      .filter((p) => p.order_id === id)
      .map((p) => ({ ...p }));
  }
}
