import { PipeTransform, HttpException } from '@nestjs/common';
import { z } from 'zod';

export function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}
export class DtoPipe<T> implements PipeTransform {
  constructor(private readonly schema: z.ZodType<T>) {}
  transform(input: unknown): T {
    const value = this.schema.safeParse(input);
    if (!value.success)
      fail(400, 'INVALID_REQUEST', 'Check the submitted fields and try again.');
    return value.data;
  }
}
export const email = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase());
export const password = z.string().min(12).max(128);
export const loginDto = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
export const registerDto = z
  .object({ email, password, businessName: z.string().trim().min(2).max(200) })
  .strict();
export const tokenDto = z
  .object({ token: z.string().min(40).max(200) })
  .strict();
export const refreshDto = z
  .object({ refreshToken: z.string().min(40).max(200) })
  .strict();
export const resetDto = z
  .object({ token: z.string().min(40).max(200), password })
  .strict();
export const emailDto = z.object({ email }).strict();
export const profileDto = z
  .object({
    name: z.string().trim().min(2).max(200),
    timezone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
    website: z.union([
      z
        .url()
        .max(500)
        .refine((v) => /^https?:/.test(v)),
      z.literal(''),
    ]),
    description: z.string().max(2000),
  })
  .strict();
export const keyDto = z
  .object({
    name: z.string().trim().min(1).max(100),
    environment: z.enum(['development', 'production']),
  })
  .strict();
export const statusDto = z
  .object({ status: z.enum(['ACTIVE', 'SUSPENDED']) })
  .strict();
export const uuidDto = z.uuid();
