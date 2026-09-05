import { decryptKeys, readCookie } from './_key-store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const { deepgramKey } = decryptKeys(readCookie(req));
    if (!deepgramKey) {
      return res.status(401).json({ error: 'Deepgram is not connected. Open API Integrations and save your Deepgram key.' });
    }

    const response = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${deepgramKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ttl_seconds: 60 })
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.err_msg || data?.message || text || 'Deepgram token request failed'
      });
    }

    if (!data?.access_token) {
      return res.status(502).json({ error: 'Deepgram did not return a temporary access token.' });
    }

    return res.status(200).json({ token: data.access_token });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Deepgram token request failed' });
  }
}
