import { randomUUID } from 'node:crypto';
import { parseConfig } from '../packages/config/src';
import {
  EmailService,
  createEmailProvider,
  ProviderError,
} from '../packages/email/src/provider';
async function main() {
  const config = parseConfig({ ...process.env, MAIL_PROVIDER: 'gmail' });
  const service = new EmailService(createEmailProvider(config));
  try {
    await service.verify();
    console.log(
      'PASS: Gmail SMTP connection authenticated; platform sender matches account policy.',
    );
    if (process.argv[2] === 'send') {
      const to = process.argv[3];
      if (!to) throw new ProviderError('TEST_RECIPIENT_REQUIRED', 'permanent');
      const result = await service.send({
        id: randomUUID(),
        to,
        subject: 'Autometa - authorized SMTP connection test',
        text: 'This is the authorized Autometa SMTP test. Gmail accepted submission if this message reaches your inbox. No ecommerce application files were changed. A separate queued contact-form test will follow once the integration is ready.',
      });
      console.log(
        'PASS: ' +
          result.status +
          ' (provider submission, not confirmed delivery).',
      );
    }
  } finally {
    service.close();
  }
}
void main().catch((e) => {
  console.error(
    'SMTP check failed: ' +
      (e instanceof ProviderError
        ? e.code
        : e instanceof Error &&
            (e.message.startsWith('Invalid configuration fields:') ||
              e.message.startsWith('Gmail configuration requires'))
          ? e.message
          : 'CONFIGURATION_OR_CONNECTIVITY'),
  );
  process.exitCode = 1;
});
