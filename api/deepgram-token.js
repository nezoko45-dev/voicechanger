export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured. Set DEEPGRAM_API_KEY in Vercel.' });
  }

  try {
    const response = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
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

    return res.status(200).json({ token: data.access_token });
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'Deepgram token request failed' });
  }
}
