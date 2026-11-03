import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Req,
  HttpCode,
  Inject,
  Module,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { InfrastructureModule } from '../infrastructure.module';
import { AuthService, userView } from './auth.service';
import { PlatformService } from './platform.service';
import { EmailService } from './email.service';
import {
  DtoPipe,
  loginDto,
  registerDto,
  emailDto,
  refreshDto,
  tokenDto,
  resetDto,
  profileDto,
  keyDto,
  statusDto,
  uuidDto,
} from './dto';

@Controller('auth')
class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  private rate(req: Request, key: string, limit = 30) {
    return this.auth.rate(key + ':' + (req.ip ?? 'unknown'), limit, 60);
  }
  @Post('register')
  @HttpCode(202)
  async register(
    @Req() req: Request,
    @Body(new DtoPipe(registerDto)) body: z.infer<typeof registerDto>,
  ) {
    await this.rate(req, 'register', 10);
    return this.auth.register(body);
  }
  @Post('login')
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Body(new DtoPipe(loginDto)) body: z.infer<typeof loginDto>,
  ) {
    await this.rate(req, 'login');
    return this.auth.login(body);
  }
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Body(new DtoPipe(refreshDto)) body: z.infer<typeof refreshDto>,
  ) {
    await this.rate(req, 'refresh', 60);
    return this.auth.refresh(body.refreshToken);
  }
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request) {
    return this.auth.logout(await this.auth.principal(req, false));
  }
  @Get('me') async me(@Req() req: Request) {
    return {
      success: true,
      user: userView(await this.auth.principal(req, false)),
      mail: this.auth.mailRuntime(),
    };
  }
  @Get('development-inbox') async inbox(@Req() req: Request) {
    return this.auth.inbox(await this.auth.principal(req, false));
  }
  @Post('verify-email')
  @HttpCode(200)
  async verify(
    @Req() req: Request,
    @Body(new DtoPipe(tokenDto)) body: z.infer<typeof tokenDto>,
  ) {
    await this.rate(req, 'verify');
    return this.auth.consume(body.token, 'VERIFY');
  }
  @Post('resend-verification')
  @HttpCode(202)
  async resend(@Req() req: Request) {
    const p = await this.auth.principal(req, false);
    await this.auth.rate('resend:' + p.id, 3, 600);
    if (!p.verifiedAt) await this.auth.challenge(p.id, 'VERIFY');
    return { success: true };
  }
  @Post('forgot-password')
  @HttpCode(202)
  async forgot(
    @Req() req: Request,
    @Body(new DtoPipe(emailDto)) body: z.infer<typeof emailDto>,
  ) {
    await this.rate(req, 'forgot', 10);
    await this.auth.rate('forgot:' + body.email, 3, 600);
    return this.auth.forgot(body.email);
  }
  @Post('reset-password')
  @HttpCode(200)
  async reset(
    @Req() req: Request,
    @Body(new DtoPipe(resetDto)) body: z.infer<typeof resetDto>,
  ) {
    await this.rate(req, 'reset');
    return this.auth.consume(body.token, 'RESET', body.password);
  }
}
@Controller('business')
class BusinessController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PlatformService) private readonly platform: PlatformService,
  ) {}
  @Get() async overview(@Req() req: Request) {
    return this.platform.overview(await this.auth.principal(req));
  }
  @Patch() async profile(
    @Req() req: Request,
    @Body(new DtoPipe(profileDto)) body: z.infer<typeof profileDto>,
  ) {
    return this.platform.profile(await this.auth.principal(req), body);
  }
}
@Controller('api-keys')
class KeysController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PlatformService) private readonly platform: PlatformService,
  ) {}
  @Get() async list(@Req() req: Request) {
    const data = await this.platform.overview(await this.auth.principal(req));
    return { success: true, keys: data.keys };
  }
  @Post() async create(
    @Req() req: Request,
    @Body(new DtoPipe(keyDto)) body: z.infer<typeof keyDto>,
  ) {
    return this.platform.createKey(await this.auth.principal(req), body);
  }
  @Post(':id/rotate') async rotate(
    @Req() req: Request,
    @Param('id', new DtoPipe(uuidDto)) id: string,
    @Body(new DtoPipe(keyDto)) body: z.infer<typeof keyDto>,
  ) {
    return this.platform.createKey(await this.auth.principal(req), body, id);
  }
  @Delete(':id') async revoke(
    @Req() req: Request,
    @Param('id', new DtoPipe(uuidDto)) id: string,
  ) {
    return this.platform.revokeKey(await this.auth.principal(req), id);
  }
}
@Controller('admin')
class AdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PlatformService) private readonly platform: PlatformService,
  ) {}
  @Get('overview') async overview(
    @Req() req: Request,
    @Query('search') search?: string,
  ) {
    return this.platform.admin(
      await this.auth.principal(req),
      typeof search === 'string' ? search : '',
    );
  }
  @Patch('businesses/:id/status') async status(
    @Req() req: Request,
    @Param('id', new DtoPipe(uuidDto)) id: string,
    @Body(new DtoPipe(statusDto)) body: z.infer<typeof statusDto>,
  ) {
    return this.platform.changeStatus(
      await this.auth.principal(req),
      id,
      body.status,
    );
  }
}
@Controller('usage')
class UsageController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
  ) {}
  @Get() async usage(@Req() req: Request) {
    return this.platform.usage(req.header('authorization'));
  }
}
@Module({
  imports: [InfrastructureModule],
  controllers: [
    AuthController,
    BusinessController,
    KeysController,
    AdminController,
    UsageController,
  ],
  providers: [AuthService, EmailService, PlatformService],
  exports: [AuthService],
})
export class SecurityModule {}
