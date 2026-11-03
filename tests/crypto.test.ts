import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  seal,
  unseal,
  digest,
  opaqueToken,
} from '../api/src/security/crypto';
test('Argon2id verifies the password and rejects an incorrect password', async () => {
  const p = opaqueToken(),
    hash = await hashPassword(p);
  assert.match(hash, /^\u0024argon2id\u0024/);
  assert.ok(await verifyPassword(hash, p));
  assert.equal(await verifyPassword(hash, p + 'bad'), false);
  assert.notEqual(hash, p);
});
test('encrypted mock mail detects tampering and wrong keys', () => {
  const body = 'sensitive verification link',
    key = opaqueToken(),
    cipher = seal(body, key);
  assert.ok(!cipher.includes(body));
  assert.equal(unseal(cipher, key), body);
  assert.throws(() => unseal(cipher, opaqueToken()));
  assert.throws(() =>
    unseal((cipher[0] === 'A' ? 'B' : 'A') + cipher.slice(1), key),
  );
  assert.notEqual(digest(opaqueToken()), digest(opaqueToken()));
});
