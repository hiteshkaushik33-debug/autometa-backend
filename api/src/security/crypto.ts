import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import * as argon2 from 'argon2';

export const opaqueToken = () => randomBytes(32).toString('base64url');
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const hashPassword = (value: string) =>
  argon2.hash(value, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
export const verifyPassword = (hash: string, value: string) =>
  argon2.verify(hash, value);
export function seal(body: string, secret: string, context = 'mock-mail') {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    createHash('sha256')
      .update(context + ':' + secret)
      .digest(),
    iv,
  );
  const data = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((x) => x.toString('base64url'))
    .join('.');
}
export function unseal(body: string, secret: string, context = 'mock-mail') {
  const [iv, tag, data] = body
    .split('.')
    .map((x) => Buffer.from(x, 'base64url'));
  const decipher = createDecipheriv(
    'aes-256-gcm',
    createHash('sha256')
      .update(context + ':' + secret)
      .digest(),
    iv,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}
