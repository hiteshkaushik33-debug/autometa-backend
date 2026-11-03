import { Inject, Injectable } from '@nestjs/common';
import { InfrastructureService } from '../infrastructure.service';
import { AuthService } from '../security/auth.service';
import { digest } from '../security/crypto';
import { fail } from '../security/dto';
import { parseConfig } from '../../../packages/config/src';
@Injectable()
export class IntegrationKeyService {
  private readonly config = parseConfig(process.env);
  constructor(
    @Inject(InfrastructureService)
    private readonly infra: InfrastructureService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  async authenticate(authorization?: string) {
    if (!authorization?.startsWith('Bearer ') || authorization.length > 200)
      fail(401, 'INVALID_API_KEY', 'A valid server-side API key is required.');
    const key = await this.infra.database.apiKey.findUnique({
      where: { keyHash: digest(authorization.slice(7)) },
      include: { tenant: true },
    });
    if (!key || key.revokedAt)
      fail(401, 'INVALID_API_KEY', 'A valid server-side API key is required.');
    if (key.environment !== this.config.API_KEY_ENVIRONMENT)
      fail(
        401,
        'INVALID_API_KEY',
        'This key belongs to a different environment.',
      );
    if (
      key.tenant.status === 'SUSPENDED' ||
      (key.tenant.status === 'TRIAL' && key.tenant.trialEndsAt <= new Date())
    )
      fail(
        403,
        'TENANT_INACTIVE',
        'This business is suspended or its trial has expired.',
      );
    await this.auth.rate('integration:' + key.id, 60, 60);
    const used = await this.infra.database.apiKey.updateMany({
      where: { id: key.id, revokedAt: null },
      data: { lastUsedAt: new Date() },
    });
    if (!used.count)
      fail(401, 'INVALID_API_KEY', 'A valid server-side API key is required.');
    return key;
  }
}
