import { spawn } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  createHash,
} from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  statSync,
  readdirSync,
  unlinkSync,
  openSync,
  closeSync,
  readSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout, clearTimeout } from 'node:timers';
const root = '/backups',
  statusRoot = '/status',
  magic = Buffer.from('AUTOMETA1');
mkdirSync(root, { recursive: true, mode: 0o700 });
mkdirSync(statusRoot, { recursive: true, mode: 0o755 });
const rawKey = process.env.BACKUP_ENCRYPTION_KEY ?? '';
if (!/^[a-fA-F0-9]{64}$/.test(rawKey)) throw new Error('BACKUP_KEY_INVALID');
const key = Buffer.from(rawKey, 'hex');
const retention = Number(process.env.BACKUP_RETENTION_COUNT ?? 14),
  interval = Number(process.env.BACKUP_INTERVAL_SECONDS ?? 86400);
if (
  !Number.isInteger(retention) ||
  retention < 2 ||
  retention > 365 ||
  !Number.isInteger(interval) ||
  interval < 60 ||
  interval > 604800
)
  throw new Error('BACKUP_SCHEDULE_INVALID');
const namePattern = /^autometa-[0-9TZ-]+-[a-f0-9]{8}\.enc$/;
const log = (event, details = {}) =>
  console.log(JSON.stringify({ service: 'backups', event, ...details }));
function status(file, patch) {
  let old = {};
  try {
    old = JSON.parse(readFileSync(join(statusRoot, file), 'utf8'));
  } catch {
    /* No previous status on the first run. */
  }
  const temp = join(statusRoot, file + '.' + process.pid + '.tmp');
  writeFileSync(temp, JSON.stringify({ ...old, ...patch }), { mode: 0o644 });
  renameSync(temp, join(statusRoot, file));
}
function processRun(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (x) => {
      out += x.toString();
      if (out.length > 1000000) child.kill();
    });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 300000);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('DATABASE_TOOL_FAILED'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error('DATABASE_TOOL_FAILED'));
    });
  });
}
const sql = (database, text) =>
  processRun('psql', [
    '-X',
    '-A',
    '-t',
    '-v',
    'ON_ERROR_STOP=1',
    '--dbname',
    database,
    '--command',
    text,
  ]);
async function sha(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const fingerprintSql = `SELECT COALESCE((SELECT "id"::text||':'||md5("encryptedBody") FROM "OutboundEmail" ORDER BY "createdAt","id" LIMIT 1),'none')`;
async function once() {
  const file =
    'autometa-' +
    new Date().toISOString().replace(/[.:]/g, '-') +
    '-' +
    randomBytes(4).toString('hex') +
    '.enc';
  const path = join(root, file),
    temp = path + '.tmp';
  let child;
  try {
    const iv = randomBytes(12),
      header = Buffer.concat([magic, iv]);
    writeFileSync(temp, header, { mode: 0o600 });
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(header);
    child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.resume();
    const exit = new Promise((resolve, reject) => {
      child.on('error', () => reject(new Error('PG_DUMP_FAILED')));
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error('PG_DUMP_FAILED')),
      );
    });
    const timer = setTimeout(() => child.kill(), 300000);
    try {
      await Promise.all([
        pipeline(
          child.stdout,
          cipher,
          createWriteStream(temp, { flags: 'a', mode: 0o600 }),
        ),
        exit,
      ]);
    } finally {
      clearTimeout(timer);
    }
    appendFileSync(temp, cipher.getAuthTag());
    renameSync(temp, path);
    const manifest = {
      version: 1,
      file,
      createdAt: new Date().toISOString(),
      sha256: await sha(path),
      cipher: 'AES-256-GCM',
      encryptedMailFingerprint: await sql(
        process.env.PGDATABASE,
        fingerprintSql,
      ),
      bytes: statSync(path).size,
    };
    writeFileSync(path + '.json', JSON.stringify(manifest), { mode: 0o600 });
    status('backup.json', {
      ok: true,
      lastSuccess: Date.now(),
      file,
      bytes: manifest.bytes,
    });
    log('backup_succeeded', { file, bytes: manifest.bytes });
    const keep = retention;
    const files = readdirSync(root)
      .filter((x) => namePattern.test(x) && existsSync(join(root, x + '.json')))
      .sort()
      .reverse();
    for (const old of files.slice(keep)) {
      unlinkSync(join(root, old));
      unlinkSync(join(root, old + '.json'));
    }
    return file;
  } catch {
    child?.kill();
    if (existsSync(temp)) unlinkSync(temp);
    if (existsSync(path) && !existsSync(path + '.json')) unlinkSync(path);
    status('backup.json', {
      ok: false,
      lastFailure: Date.now(),
      code: 'BACKUP_FAILED',
    });
    log('backup_failed');
    throw new Error('BACKUP_FAILED');
  }
}
function latest() {
  const files = readdirSync(root)
    .filter((x) => namePattern.test(x) && existsSync(join(root, x + '.json')))
    .sort()
    .reverse();
  if (!files[0]) throw new Error('NO_BACKUP');
  return files[0];
}
async function decrypt(file) {
  if (basename(file) !== file || !namePattern.test(file))
    throw new Error('BACKUP_NAME_INVALID');
  const path = join(root, file);
  const metadata = JSON.parse(readFileSync(path + '.json', 'utf8'));
  if (
    metadata.file !== file ||
    metadata.version !== 1 ||
    (await sha(path)) !== metadata.sha256
  )
    throw new Error('BACKUP_INTEGRITY_FAILED');
  const size = statSync(path).size,
    header = Buffer.alloc(magic.length + 12),
    tag = Buffer.alloc(16),
    fd = openSync(path, 'r');
  try {
    readSync(fd, header, 0, header.length, 0);
    readSync(fd, tag, 0, 16, size - 16);
  } finally {
    closeSync(fd);
  }
  if (
    size <= header.length + 16 ||
    !header.subarray(0, magic.length).equals(magic)
  )
    throw new Error('BACKUP_FORMAT_INVALID');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    header.subarray(magic.length),
  );
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const plain = '/tmp/autometa-restore-' + randomUUID() + '.dump';
  try {
    await pipeline(
      createReadStream(path, { start: header.length, end: size - 17 }),
      decipher,
      createWriteStream(plain, { flags: 'wx', mode: 0o600 }),
    );
    await processRun('pg_restore', ['--list', plain]);
    return { plain, metadata };
  } catch {
    if (existsSync(plain)) unlinkSync(plain);
    throw new Error('BACKUP_AUTHENTICATION_FAILED');
  }
}
async function restore(file, recoverTarget) {
  let plain,
    target,
    created = false;
  const verifyOnly = !recoverTarget;
  try {
    const decrypted = await decrypt(file);
    plain = decrypted.plain;
    target =
      recoverTarget ??
      'autometa_restore_check_' + randomBytes(8).toString('hex');
    if (
      !/^(autometa_restore_check|autometa_recovered)_[a-f0-9]{8,32}$/.test(
        target,
      ) ||
      target === process.env.PGDATABASE
    )
      throw new Error('SAFE_NEW_DATABASE_REQUIRED');
    await processRun('createdb', ['--maintenance-db=postgres', target]);
    created = true;
    await processRun('pg_restore', [
      '--exit-on-error',
      '--no-owner',
      '--no-acl',
      '--dbname',
      target,
      plain,
    ]);
    const checks = JSON.parse(
      await sql(
        target,
        `SELECT json_build_object('migrations',(SELECT count(*) FROM "_prisma_migrations"),'tenants',(SELECT count(*) FROM "Tenant"),'ledgerMismatch',(SELECT count(*) FROM "CreditAccount" a WHERE a."availablePaise" != COALESCE((SELECT sum(l."amountPaise") FROM "CreditLedger" l WHERE l."tenantId"=a."tenantId"),0) OR a."reservedPaise" != COALESCE((SELECT sum(l."reservedDeltaPaise") FROM "CreditLedger" l WHERE l."tenantId"=a."tenantId"),0)),'holdMismatch',(SELECT count(*) FROM "CreditAccount" a WHERE a."reservedPaise" != COALESCE((SELECT sum(h."amountPaise") FROM "EmailCreditHold" h WHERE h."tenantId"=a."tenantId" AND h."state"='HELD'),0)))`,
      ),
    );
    if (
      checks.migrations < 1 ||
      checks.ledgerMismatch !== 0 ||
      checks.holdMismatch !== 0 ||
      (await sql(target, fingerprintSql)) !==
        decrypted.metadata.encryptedMailFingerprint
    )
      throw new Error('RESTORE_VERIFICATION_FAILED');
    if (!verifyOnly)
      await sql(
        target,
        `BEGIN; UPDATE "Session" SET "revokedAt"=now() WHERE "revokedAt" IS NULL; UPDATE "OutboundEmail" SET "status"='UNKNOWN',"errorCode"='RESTORE_REVIEW_REQUIRED',"leaseUntil"=NULL WHERE "status" IN ('QUEUED','RETRY','SENDING','WAITING_CREDITS'); UPDATE "EmailAttempt" SET "outcome"='UNKNOWN',"safeCode"='RESTORE_REVIEW_REQUIRED',"finishedAt"=now() WHERE "outcome"='SENDING'; UPDATE "EmailOutbox" SET "publishedAt"=now(),"leaseUntil"=NULL WHERE "publishedAt" IS NULL; COMMIT;`,
      );
    status('restore.json', {
      ok: true,
      lastSuccess: Date.now(),
      file,
      mode: verifyOnly ? 'isolated_drill' : 'new_database_recovery',
    });
    log(verifyOnly ? 'restore_drill_succeeded' : 'recovery_database_ready', {
      file,
      target,
      checks,
      quarantined: !verifyOnly,
    });
  } catch {
    status('restore.json', {
      ok: false,
      lastFailure: Date.now(),
      code: 'RESTORE_FAILED',
    });
    log('restore_failed');
    throw new Error('RESTORE_FAILED');
  } finally {
    if (plain && existsSync(plain)) unlinkSync(plain);
    if (created && verifyOnly)
      await processRun('dropdb', ['--if-exists', target]);
  }
}
const mode = process.argv[2] ?? 'loop';
try {
  if (mode === 'once') await once();
  else if (mode === 'verify')
    await restore(
      process.argv.find((x) => x.startsWith('--file='))?.slice(7) ?? latest(),
    );
  else if (mode === 'recover') {
    const target = process.argv
      .find((x) => x.startsWith('--target='))
      ?.slice(9);
    if (!target) throw new Error('NEW_RECOVERY_TARGET_REQUIRED');
    await restore(
      process.argv.find((x) => x.startsWith('--file='))?.slice(7) ?? latest(),
      target,
    );
  } else if (mode === 'loop') {
    for (;;) {
      let succeeded = false;
      try {
        const file = await once();
        succeeded = true;
        let last = 0;
        try {
          last =
            JSON.parse(readFileSync(join(statusRoot, 'restore.json'), 'utf8'))
              .lastSuccess ?? 0;
        } catch {
          /* No previous restore drill on the first run. */
        }
        if (Date.now() - last > 7 * 86400000) await restore(file);
      } catch {
        /* Failure is observable in status metadata and logs; retry shortly. */
      }
      await new Promise((r) =>
        setTimeout(r, succeeded ? interval * 1000 : 300000),
      );
    }
  } else throw new Error('UNKNOWN_OPERATION');
} catch {
  process.exitCode = 1;
}
