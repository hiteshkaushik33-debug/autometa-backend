import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import type { Request } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiExceptionFilter, correlation } from './http';
import { parseConfig } from '../../packages/config/src';

export async function createApiApp() {
  const config = parseConfig(process.env);
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: false,
  });
  app.use(correlation);
  app.use(helmet());
  app.use(
    json({
      limit: '64kb',
      verify: (req, _res, buf) => {
        if (req.url?.split('?')[0] === '/api/v1/billing/razorpay/webhook')
          (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.enableCors({
    origin: [config.WEB_ORIGIN, config.ADMIN_ORIGIN],
    credentials: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
