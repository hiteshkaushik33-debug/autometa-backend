import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../packages/config/src';
import { recipientAllowed } from '../packages/email/src/provider';
const base = {
  DATABASE_URL: 'postgresql://local:local@localhost/db',
  REDIS_URL: 'redis://localhost:6379',
};
test('local defaults cannot send external notifications', () => {
  const config = parseConfig(base);
  assert.equal(config.MAIL_PROVIDER, 'mock');
  assert.equal(config.AI_PROVIDER, 'mock');
  assert.equal(config.TELEGRAM_PROVIDER, 'mock');
  assert.equal(
    parseConfig({ ...base, SMTP_SECURE: 'false' }).SMTP_SECURE,
    false,
  );
});
test('invalid settings fail without revealing secrets', () => {
  assert.throws(
    () => parseConfig({ ...base, DATABASE_URL: 'private-password' }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('DATABASE_URL') &&
      !error.message.includes('private-password'),
  );
  assert.throws(() => parseConfig({ ...base, SMTP_SECURE: 'yes' }));
  assert.throws(() => parseConfig({ ...base, MAIL_PROVIDER: 'gmail' }));
  assert.throws(() => parseConfig({ ...base, API_PORT: '0' }));
});
test('production builds can retain development integration keys and Razorpay test billing', () => {
  const c = parseConfig({
    ...base,
    NODE_ENV: 'production',
    API_KEY_ENVIRONMENT: 'development',
    BILLING_ENABLED: 'true',
    RAZORPAY_KEY_ID: 'rzp_test_fixture',
    RAZORPAY_KEY_SECRET: 'fixture',
  });
  assert.equal(c.API_KEY_ENVIRONMENT, 'development');
  assert.equal(c.BILLING_PROVIDER, 'razorpay_test');
  assert.throws(() =>
    parseConfig({
      ...base,
      NODE_ENV: 'production',
      BILLING_ENABLED: 'true',
      RAZORPAY_KEY_ID: 'rzp_live_fixture',
      RAZORPAY_KEY_SECRET: 'fixture',
    }),
  );
});
test('beta recipients are dynamic while the optional local allowlist remains enforced', () => {
  const c = parseConfig({
    ...base,
    NODE_ENV: 'production',
    MAIL_PROVIDER: 'gmail',
    SMTP_USER: 'sender@example.com',
    SMTP_APP_PASSWORD: 'fixture',
    EMAIL_TEST_MODE: 'false',
  });
  assert.equal(recipientAllowed(c, 'first@example.com'), true);
  assert.equal(recipientAllowed(c, 'second@example.com'), true);
  const restricted = {
    ...c,
    EMAIL_TEST_MODE: true,
    EMAIL_TEST_RECIPIENTS: 'first@example.com',
  };
  assert.equal(recipientAllowed(restricted, 'first@example.com'), true);
  assert.equal(recipientAllowed(restricted, 'second@example.com'), false);
});
