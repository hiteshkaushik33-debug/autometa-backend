import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { ApiError } from '../../packages/shared-types/src';
export function correlation(req: Request, res: Response, next: NextFunction) {
  const supplied = req.header('x-request-id');
  res.locals.requestId =
    supplied && /^[a-zA-Z0-9_-]{1,80}$/.test(supplied)
      ? supplied
      : randomUUID();
  res.setHeader('x-request-id', res.locals.requestId as string);
  const started = Date.now();
  res.on('finish', () =>
    console.log(
      JSON.stringify({
        service: 'api',
        requestId: res.locals.requestId,
        method: req.method,
        status: res.statusCode,
        durationMs: Date.now() - started,
      }),
    ),
  );
  next();
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const parserType =
      exception && typeof exception === 'object' && 'type' in exception
        ? exception.type
        : '';
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : parserType === 'entity.too.large'
          ? 413
          : parserType === 'entity.parse.failed'
            ? 400
            : 500;
    const raw =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const safe =
      raw &&
      typeof raw === 'object' &&
      'code' in raw &&
      'message' in raw &&
      typeof raw.code === 'string' &&
      /^[A-Z_]+$/.test(raw.code) &&
      typeof raw.message === 'string'
        ? (raw as { code: string; message: string })
        : undefined;
    const code =
      status === 404
        ? 'NOT_FOUND'
        : status === 400
          ? 'INVALID_REQUEST'
          : status === 401
            ? 'UNAUTHENTICATED'
            : status === 403
              ? 'FORBIDDEN'
              : status === 429
                ? 'RATE_LIMITED'
                : status === 413
                  ? 'PAYLOAD_TOO_LARGE'
                  : 'SERVICE_UNAVAILABLE';
    const body: ApiError = {
      success: false,
      error: safe ?? {
        code,
        message:
          status >= 500
            ? 'Service temporarily unavailable'
            : 'Request could not be processed',
      },
      requestId: (response.locals.requestId as string) ?? randomUUID(),
    };
    if (status === 429) response.setHeader('retry-after', '60');
    response.status(status).json(body);
  }
}
