import { configureOps } from './configure-ops';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
const source = existsSync('.env')
  ? readFileSync('.env', 'utf8')
  : readFileSync('.env.example', 'utf8');
const env = parse(source);
if (env.NODE_ENV !== 'development')
  throw new Error('Local configuration only supports development mode.');
if (env.AUTH_JWT_SECRET && env.AUTH_JWT_SECRET.length < 64)
  throw new Error('Existing AUTH_JWT_SECRET is too short; review it manually.');
let output = source;
if (!env.AUTH_JWT_SECRET) {
  const entry = 'AUTH_JWT_SECRET=' + randomBytes(32).toString('hex');
  output = /^AUTH_JWT_SECRET=.*$/m.test(output)
    ? output.replace(/^AUTH_JWT_SECRET=.*$/m, entry)
    : output + '\n' + entry + '\n';
}
mkdirSync('.local', { recursive: true });
writeFileSync('.env', output, { mode: 0o600 });
console.log(
  'Local environment ready. Secrets are stored only in backend/.env.',
);

configureOps();
