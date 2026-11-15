// Authentication primitives for ContactHub.
//
// Extracted from server/index.js so they can be unit-tested in isolation
// (no database, no HTTP server required).
//
// Password hashing uses PBKDF2-HMAC-SHA256 with a per-user random salt.
// A per-user salt means two users with the same password get different
// hashes, which defeats precomputation attacks against the stored hashes.
//
// Session tokens are stateless HMAC-signed payloads:
//     base64url(JSON payload).base64url(HMAC-SHA256 signature)
// The payload is signed, NOT encrypted — it must never contain secrets.

import crypto from 'node:crypto';

const PBKDF2_ITERATIONS = 120_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

// The salt the original file-backed implementation prefixed onto passwords
// before hashing. Rows imported from `server/data.json` still carry digests
// computed with it, so it is needed to verify (and then rehash) them.
const LEGACY_STATIC_SALT = 'contacthub-static-salt';

/**
 * Hash a password with a fresh random salt.
 * @returns {string} `pbkdf2$<iterations>$<salt-hex>$<hash-hex>`
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(
    String(password),
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * Verify a password against a stored hash, in constant time.
 *
 * Supports the legacy `sha256$<salt>$<hash>` format so existing rows
 * continue to authenticate; they are transparently upgraded on next login.
 *
 * Also supports the original ContactHub format: a bare SHA-256 hex digest of
 * `<static-salt><password>` with no prefix at all. Rows imported from the
 * legacy `data.json` file were written that way, and rejecting them locked
 * those accounts out entirely.
 */
export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;

  try {
    if (stored.startsWith('pbkdf2$')) {
      const [, iterations, saltHex, hashHex] = stored.split('$');
      const expected = Buffer.from(hashHex, 'hex');
      const actual = crypto.pbkdf2Sync(
        String(password),
        Buffer.from(saltHex, 'hex'),
        Number(iterations),
        expected.length,
        PBKDF2_DIGEST,
      );
      return crypto.timingSafeEqual(expected, actual);
    }

    if (stored.startsWith('sha256$')) {
      const [, salt, hashHex] = stored.split('$');
      const expected = Buffer.from(hashHex, 'hex');
      const actual = crypto.createHash('sha256').update(salt + password).digest();
      return crypto.timingSafeEqual(expected, actual);
    }

    // Legacy bare digest: 64 hex chars, no prefix. The original app hashed
    // `<static-salt><password>` and stored the raw hex, so we recompute that
    // exact form. Weak by modern standards, but it is the only way to verify
    // rows imported from the legacy `data.json` — the caller rehashes them
    // to PBKDF2 on first successful login.
    if (/^[0-9a-f]{64}$/i.test(stored)) {
      const expected = Buffer.from(stored, 'hex');
      const actual = crypto
        .createHash('sha256')
        .update(LEGACY_STATIC_SALT + String(password))
        .digest();
      return crypto.timingSafeEqual(expected, actual);
    }

    // Unknown format -> refuse rather than fall back to something weak.
    return false;
  } catch {
    return false;
  }
}

/**
 * True when a stored hash uses the legacy scheme and should be re-hashed.
 */
export function needsRehash(stored) {
  return typeof stored === 'string' && !stored.startsWith('pbkdf2$');
}

/** Sign a session payload with HMAC-SHA256. */
export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verify and decode a session token.
 * @returns {object|null} the payload, or null if the token is invalid.
 */
export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
