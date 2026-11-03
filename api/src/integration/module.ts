import {
  Module,
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Req,
  Inject,
  HttpCode,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';
import { InfrastructureModule } from '../infrastructure.module';
import { SecurityModule } from '../security/controllers';
import { AuthService } from '../security/auth.service';
import { DtoPipe, uuidDto } from '../security/dto';
import { eventBody, aliasBody, automationBody, suppressionBody } from './dto';
import { IntegrationKeyService } from './key.service';
import { EventsService } from './events.service';
import { MailManagementService } from './mail.service';
@Controller('events')
class EventsController {
  constructor(@Inject(EventsService) private readonly service: EventsService) {}
  @Post() @HttpCode(202) async ingest(
    @Req() r: Request,
    @Body(new DtoPipe(eventBody)) input: z.infer<typeof eventBody>,
  ) {
    return this.service.ingest(
      r.header('authorization'),
      r.header('idempotency-key'),
      input,
    );
  }
  @Get(':id') async receipt(
    @Req() r: Request,
    @Param('id', new DtoPipe(uuidDto)) id: string,
  ) {
    return this.service.receipt(r.header('authorization'), id);
  }
}
@Controller('leads')
class LeadsController {
  constructor(@Inject(EventsService) private readonly service: EventsService) {}
  @Post() @HttpCode(202) async ingest(
    @Req() r: Request,
    @Body(new DtoPipe(aliasBody)) input: z.infer<typeof aliasBody>,
  ) {
    return this.service.ingest(
      r.header('authorization'),
      r.header('idempotency-key'),
      { ...input, event: 'lead.created' },
    );
  }
}
@Controller('feedback')
class FeedbackController {
  constructor(@Inject(EventsService) private readonly service: EventsService) {}
  @Post() @HttpCode(202) async ingest(
    @Req() r: Request,
    @Body(new DtoPipe(aliasBody)) input: z.infer<typeof aliasBody>,
  ) {
    return this.service.ingest(
      r.header('authorization'),
      r.header('idempotency-key'),
      { ...input, event: 'feedback.submitted' },
    );
  }
}
@Controller('email')
class EmailController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MailManagementService)
    private readonly service: MailManagementService,
  ) {}
  @Get('overview') async overview(@Req() r: Request) {
    return this.service.overview(await this.auth.principal(r));
  }
  @Put('settings') async settings(
    @Req() r: Request,
    @Body(new DtoPipe(automationBody)) input: z.infer<typeof automationBody>,
  ) {
    return this.service.settings(await this.auth.principal(r), input);
  }
  @Get('messages/:id') async message(
    @Req() r: Request,
    @Param('id', new DtoPipe(uuidDto)) id: string,
  ) {
    return this.service.message(await this.auth.principal(r), id);
  }
  @Post('messages/:id/cancel') @HttpCode(200) async cancel(
    @Req() r: Request,
    @Param('id', new DtoPipe(uuidDto)) id: string,
  ) {
    return this.service.cancel(await this.auth.principal(r), id);
  }
  @Post('suppressions') async suppress(
    @Req() r: Request,
    @Body(new DtoPipe(suppressionBody)) input: z.infer<typeof suppressionBody>,
  ) {
    return this.service.suppress(await this.auth.principal(r), input.email);
  }
  @Delete('suppressions/:id') async unsuppress(
    @Req() r: Request,
    @Param('id', new DtoPipe(uuidDto)) id: string,
  ) {
    return this.service.unsuppress(await this.auth.principal(r), id);
  }
}
@Module({
  imports: [InfrastructureModule, SecurityModule],
  controllers: [
    EventsController,
    LeadsController,
    FeedbackController,
    EmailController,
  ],
  providers: [IntegrationKeyService, EventsService, MailManagementService],
})
export class IntegrationModule {}
