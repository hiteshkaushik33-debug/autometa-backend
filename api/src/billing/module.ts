import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { InfrastructureModule } from '../infrastructure.module';
import { SecurityModule } from '../security/controllers';
import { AuthService } from '../security/auth.service';
import { DtoPipe, uuidDto, fail } from '../security/dto';
import { parseConfig } from '../../../packages/config/src';
import { BillingService } from './service';
import {
  PAYMENT_PROVIDER,
  MockPaymentProvider,
  RazorpayTestProvider,
} from './provider';
const orderDto = z
  .object({
    packId: z.enum(['starter', 'growth', 'scale']),
    requestId: z.uuid(),
  })
  .strict();
const verifyDto = z
  .object({
    topUpId: z.uuid(),
    paymentId: z.string().regex(/^pay_[A-Za-z0-9]{1,90}$/),
    signature: z.string().regex(/^[a-fA-F0-9]{64}$/),
  })
  .strict();
@Controller('billing')
class BillingController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}
  @Get('overview') async overview(@Req() r: Request) {
    return this.billing.overview(await this.auth.principal(r));
  }
  @Post('topups') @HttpCode(201) async create(
    @Req() r: Request,
    @Body(new DtoPipe(orderDto)) body: z.infer<typeof orderDto>,
  ) {
    return this.billing.create(
      await this.auth.principal(r),
      body.packId,
      body.requestId,
    );
  }
  @Post('verify') @HttpCode(200) async verify(
    @Req() r: Request,
    @Body(new DtoPipe(verifyDto)) body: z.infer<typeof verifyDto>,
  ) {
    return this.billing.verify(await this.auth.principal(r), body);
  }
  @Post('topups/:id/reconcile') @HttpCode(200) async reconcile(
    @Req() r: Request,
    @Param('id', new DtoPipe(uuidDto)) id: string,
  ) {
    return this.billing.reconcile(await this.auth.principal(r), id);
  }
  @Get('topups/:id/checkout') async checkout(
    @Req() r: Request,
    @Param('id', new DtoPipe(uuidDto)) id: string,
  ) {
    return this.billing.resume(await this.auth.principal(r), id);
  }
  @Post('razorpay/webhook') @HttpCode(200) async webhook(
    @Req() r: Request & { rawBody?: Buffer },
  ) {
    if (!r.rawBody) fail(400, 'INVALID_REQUEST', 'Raw body required.');
    return this.billing.webhook(
      r.rawBody,
      r.header('x-razorpay-signature'),
      r.header('x-razorpay-event-id'),
    );
  }
}
@Controller('admin/billing')
class BillingAdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}
  @Get() async overview(@Req() r: Request) {
    return this.billing.admin(await this.auth.principal(r));
  }
}
@Module({
  imports: [InfrastructureModule, SecurityModule],
  controllers: [BillingController, BillingAdminController],
  providers: [
    BillingService,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: () => {
        const config = parseConfig(process.env);
        return config.NODE_ENV === 'test' && config.BILLING_PROVIDER === 'mock'
          ? new MockPaymentProvider()
          : new RazorpayTestProvider(config);
      },
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
