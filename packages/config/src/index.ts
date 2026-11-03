import 'dotenv/config';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_KEY_ENVIRONMENT: z.enum(['development', 'production']).optional(),
  MONITORING_TOKEN: z.string().default(''),
  BACKUP_STATUS_DIRECTORY: z.string().default('/backup-status'),
  AUTH_JWT_SECRET: z.string().min(64).max(256).optional(),
  ADMIN_ORIGIN: z.url().default('http://localhost:3200'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_BASE_URL: z.url().default('http://localhost:4000/api/v1'),
  INTERNAL_API_BASE_URL: z.url().default('http://localhost:4000/api/v1'),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  REDIS_URL: z.string().regex(/^rediss?:\/\//),
  MAIL_PROVIDER: z.enum(['mock', 'gmail']).default('mock'),
  EMAIL_TEST_MODE: booleanString.default(true),
  EMAIL_FOLLOW_UP_ENABLED: booleanString.default(false),
  EMAIL_FOLLOW_UP_DELAY_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(604800)
    .default(300),
  EMAIL_TEST_RECIPIENTS: z.string().default(''),
  EMAIL_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).max(500).default(10),
  EMAIL_TENANT_PER_MINUTE: z.coerce.number().int().min(1).max(100).default(5),
  EMAIL_GLOBAL_PER_DAY: z.coerce.number().int().min(1).default(100),
  EMAIL_TENANT_PER_DAY: z.coerce.number().int().min(1).default(20),
  EVENTS_TENANT_PER_DAY: z.coerce.number().int().min(1).default(1000),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: booleanString.default(true),
  SMTP_USER: z.string().default(''),
  SMTP_APP_PASSWORD: z.string().default(''),
  MAIL_FROM: z.email().default('platform@example.test'),
  AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  TELEGRAM_PROVIDER: z.enum(['mock', 'telegram']).default('mock'),
  BILLING_ENABLED: booleanString.default(false),
  BILLING_PROVIDER: z.enum(['razorpay_test', 'mock']).default('razorpay_test'),
  BILLING_CHARGE_MOCK_EMAILS: booleanString.default(false),
  BILLING_EMAIL_PRICE_PAISE: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(100),
  BILLING_LOW_BALANCE_PAISE: z.coerce
    .number()
    .int()
    .min(0)
    .max(1000000)
    .default(500),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
});

export function parseConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Never include submitted values, URLs containing credentials, or Zod's full error.
    throw new Error(
      `Invalid configuration fields: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  if (
    result.data.MAIL_PROVIDER === 'gmail' &&
    (!result.data.SMTP_USER || !result.data.SMTP_APP_PASSWORD)
  ) {
    throw new Error(
      'Gmail configuration requires SMTP_USER and SMTP_APP_PASSWORD',
    );
  }
  if (result.data.NODE_ENV !== 'production' && !result.data.EMAIL_TEST_MODE)
    throw new Error('EMAIL_TEST_MODE must remain true outside production');
  if (
    result.data.BILLING_PROVIDER === 'mock' &&
    result.data.NODE_ENV !== 'test'
  )
    throw new Error('Mock billing requires NODE_ENV=test');
  if (result.data.BILLING_CHARGE_MOCK_EMAILS && result.data.NODE_ENV !== 'test')
    throw new Error('Mock charging requires NODE_ENV=test');
  if (
    result.data.BILLING_ENABLED &&
    result.data.BILLING_PROVIDER === 'razorpay_test' &&
    (!result.data.RAZORPAY_KEY_ID.startsWith('rzp_test_') ||
      !result.data.RAZORPAY_KEY_SECRET)
  )
    throw new Error(
      'Razorpay test billing requires test keys in RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET',
    );
  if (
    result.data.EMAIL_TEST_RECIPIENTS.split(',')
      .filter((x) => x.trim())
      .some((x) => !z.email().safeParse(x.trim()).success)
  )
    throw new Error('Invalid configuration field: EMAIL_TEST_RECIPIENTS');
  return {
    ...result.data,
    API_KEY_ENVIRONMENT:
      result.data.API_KEY_ENVIRONMENT ??
      (result.data.NODE_ENV === 'production' ? 'production' : 'development'),
  };
}

export type Config = ReturnType<typeof parseConfig>;
