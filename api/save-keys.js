import { decryptKeys, encryptKeys, readCookie, setKeysCookie } from './_key-store.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const keys = decryptKeys(readCookie(req));
      return res.status(200).json({
        openrouter: Boolean(keys.openrouterKey),
        deepgram: Boolean(keys.deepgramKey)
      });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'Key storage is not configured.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  try {
    const body = req.body || {};
    const existing = decryptKeys(readCookie(req));
    const openrouterKey = typeof body.openrouterKey === 'string' ? body.openrouterKey.trim() : '';
    const deepgramKey = typeof body.deepgramKey === 'string' ? body.deepgramKey.trim() : '';

    if (!openrouterKey && !deepgramKey) {
      return res.status(400).json({ error: 'Enter at least one API key.' });
    }

    // Only replace the provider being saved. The other provider remains encrypted.
    const keys = {
      openrouterKey: openrouterKey || existing.openrouterKey,
      deepgramKey: deepgramKey || existing.deepgramKey
    };

    setKeysCookie(res, keys);
    return res.status(200).json({
      ok: true,
      openrouter: Boolean(keys.openrouterKey),
      deepgram: Boolean(keys.deepgramKey)
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Could not save API keys.' });
  }
}
