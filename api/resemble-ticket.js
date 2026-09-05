export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const apiKey = process.env.RESEMBLE_API_KEY;
  const host = process.env.RESEMBLE_LIVE_VC_HOST;

  if (!apiKey || !host) {
    return res.status(500).json({
      error: 'Server is not configured. Set RESEMBLE_API_KEY and RESEMBLE_LIVE_VC_HOST in Vercel environment variables.'
    });
  }

  try {
    const response = await fetch(`https://${host}/api/auth/ticket`, {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      }
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }

    if (!response.ok || !data.ticket) {
      return res.status(response.status || 502).json({
        error: data.error || data.message || 'Resemble ticket request failed'
      });
    }

    return res.status(200).json({ ticket: data.ticket, host });
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'Could not reach Resemble' });
  }
}
