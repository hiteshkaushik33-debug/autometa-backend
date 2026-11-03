import { createApiApp } from './bootstrap';
import { parseConfig } from '../../packages/config/src';
async function bootstrap() {
  const config = parseConfig(process.env);
  const app = await createApiApp();
  await app.listen(config.API_PORT, '0.0.0.0');
  console.log(
    JSON.stringify({
      service: 'api',
      status: 'listening',
      port: config.API_PORT,
    }),
  );
}
void bootstrap().catch(() => {
  console.error(
    JSON.stringify({
      service: 'api',
      code: 'STARTUP_FAILED',
      message: 'Check configuration and database/Redis availability',
    }),
  );
  process.exitCode = 1;
});
