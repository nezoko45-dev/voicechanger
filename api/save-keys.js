import crypto from 'crypto';

const COOKIE_NAME = 'voicechanger_keys';
const MAX_AGE = 60 * 60 * 24 * 30;

function secret() {
  return process.env.KEY_COOKIE_SECRET?.trim() || process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || 'voicechanger-local-secret';
}

function encrypt(value) {
  const key = crypto.createHash('sha256').update(secret()).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64url')).join('.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { openrouterKey, deepgramKey } = req.body || {};
    const keys = {
      openrouterKey: typeof openrouterKey === 'string' ? openrouterKey.trim() : '',
      deepgramKey: typeof deepgramKey === 'string' ? deepgramKey.trim() : ''
    };

    if (!keys.openrouterKey && !keys.deepgramKey) {
      return res.status(400).json({ error: 'Enter at least one API key.' });
    }

    // Store only an encrypted, HttpOnly cookie. The key is never returned to JavaScript.
    const token = encrypt(keys);
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict`);
    return res.status(200).json({
      ok: true,
      openrouter: Boolean(keys.openrouterKey),
      deepgram: Boolean(keys.deepgramKey)
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Could not save API keys.' });
  }
}
