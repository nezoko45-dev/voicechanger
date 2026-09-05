export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server is not configured. Set OPENROUTER_API_KEY in Vercel.' });

  try {
    const { text, voice } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'Missing text' });

    // Keep Fish Audio responsible for the expressive female delivery.
    // Deepgram is used only for the live/interim speech recognition side.
    const body = {
      model: 'fish-audio/s2.1-pro-free:free',
      input: text.trim(),
      response_format: 'mp3',
      voice: voice?.trim() || '5161d41404314212af1254556477c17d'
    };

    const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://voicechanger.vercel.app',
        'X-Title': 'Low Latency Deepgram + Fish Female Voice Changer'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const textBody = await response.text();
      let data;
      try { data = JSON.parse(textBody); } catch { data = null; }
      return res.status(response.status).json({ error: data?.error?.message || data?.error || textBody || 'OpenRouter request failed' });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return res.status(200).json({ audio: buffer.toString('base64'), format: 'mp3' });
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'OpenRouter request failed' });
  }
}
