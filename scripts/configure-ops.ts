import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
export function configureOps() {
  if (!existsSync('.env')) throw new Error('Create backend/.env first.');
  let source = readFileSync('.env', 'utf8');
  const env = parse(source);
  const key = env.BACKUP_ENCRYPTION_KEY || randomBytes(32).toString('hex');
  if (!/^[a-fA-F0-9]{64}$/.test(key))
    throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hexadecimal characters.');
  const token = env.MONITORING_TOKEN || randomBytes(32).toString('hex');
  if (token.length < 32)
    throw new Error('MONITORING_TOKEN must have at least 32 characters.');
  const fields = {
    BACKUP_ENCRYPTION_KEY: key,
    MONITORING_TOKEN: token,
    API_KEY_ENVIRONMENT: env.API_KEY_ENVIRONMENT ?? 'development',
  };
  for (const [name, value] of Object.entries(fields)) {
    const pattern = new RegExp('^' + name + '=.*$', 'm');
    source = pattern.test(source)
      ? source.replace(pattern, () => name + '=' + value)
      : source + '\n' + name + '=' + value + '\n';
  }
  writeFileSync('.env', source, { mode: 0o600 });
  mkdirSync('.local/monitoring', { recursive: true, mode: 0o700 });
  mkdirSync('.local/backups', { recursive: true, mode: 0o700 });
  mkdirSync('.local/backup-status', { recursive: true, mode: 0o755 });
  writeFileSync('.local/monitoring/token', token, { mode: 0o644 });
  console.log(
    'Backup key and monitoring token configured privately. Keep the backup key and AUTH_JWT_SECRET in your separate recovery secret store.',
  );
}
if (require.main === module) configureOps();
