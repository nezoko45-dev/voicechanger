import crypto from 'crypto';

export const COOKIE_NAME = 'voicechanger_keys';
export const MAX_AGE = 60 * 60 * 24 * 30;

function getSecret() {
  const value = process.env.KEY_COOKIE_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error('Server key storage is not configured. Set KEY_COOKIE_SECRET to a random secret of at least 32 characters.');
  }
  return value;
}

function encryptionKey() {
  return crypto.createHash('sha256').update(getSecret(), 'utf8').digest();
}

export function encryptKeys(keys) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(keys), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.');
}

export function decryptKeys(token) {
  if (!token) return { openrouterKey: '', deepgramKey: '' };
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid key cookie');
    const [iv, tag, encrypted] = parts.map(value => Buffer.from(value, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plaintext);
    return {
      openrouterKey: typeof parsed.openrouterKey === 'string' ? parsed.openrouterKey : '',
      deepgramKey: typeof parsed.deepgramKey === 'string' ? parsed.deepgramKey : ''
    };
  } catch {
    return { openrouterKey: '', deepgramKey: '' };
  }
}

export function readCookie(req) {
  const header = req.headers?.cookie || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

export function setKeysCookie(res, keys) {
  const token = encryptKeys(keys);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict`);
}
