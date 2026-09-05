export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured. Set CARTESIA_API_KEY in Vercel.' });
  }

  try {
    const { text, voice } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'Missing text' });

    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Cartesia-Version': '2026-03-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model_id: 'sonic-3.5',
        transcript: text.trim(),
        voice: {
          mode: 'id',
          id: voice?.trim() || 'f786b574-daa5-4673-aa0c-cbe3e8534c02'
        },
        output_format: {
          container: 'mp3',
          bit_rate: 128000
        },
        language: 'en',
        generation_config: {
          volume: 1,
          speed: 1
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      let data;
      try { data = JSON.parse(body); } catch { data = null; }
      return res.status(response.status).json({
        error: data?.message || data?.error || body || 'Cartesia request failed'
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return res.status(200).json({
      audio: buffer.toString('base64'),
      format: 'mp3'
    });
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'Cartesia request failed' });
  }
}
