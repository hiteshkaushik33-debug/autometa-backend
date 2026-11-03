import { MonitoringModule } from './monitoring';
import {
  Controller,
  Get,
  Inject,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InfrastructureModule } from './infrastructure.module';
import { IntegrationModule } from './integration/module';
import { BillingModule } from './billing/module';
import { SecurityModule } from './security/controllers';
import { InfrastructureService } from './infrastructure.service';
import type { HealthResponse } from '../../packages/shared-types/src';

@Controller('health')
class HealthController {
  constructor(
    @Inject(InfrastructureService)
    private readonly infrastructure: InfrastructureService,
  ) {}

  @Get('live')
  live() {
    return { success: true, status: 'alive' };
  }

  @Get('ready')
  async ready(): Promise<HealthResponse> {
    try {
      await this.infrastructure.ready();
    } catch {
      throw new ServiceUnavailableException('Infrastructure unavailable');
    }
    return {
      success: true,
      status: 'ready',
      services: { database: 'up', redis: 'up' },
    };
  }
}

@Module({
  imports: [
    InfrastructureModule,
    SecurityModule,
    IntegrationModule,
    BillingModule,
    MonitoringModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
