export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { text, voice, openrouterKey } = req.body || {};
    const apiKey = typeof openrouterKey === 'string' ? openrouterKey.trim() : '';
    if (!apiKey) return res.status(401).json({ error: 'Enter your OpenRouter API key in API Integrations first.' });
    if (!text?.trim()) return res.status(400).json({ error: 'Missing text' });

    const validVoices = new Set(['Kore', 'Aoede', 'Leda', 'Zephyr']);
    const selectedVoice = validVoices.has(String(voice || '').trim()) ? String(voice).trim() : 'Kore';

    const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://voicechanger-f7kui1owf-nezoko45-8506s-projects.vercel.app/',
        'X-Title': 'Low-Latency Female Voice Changer'
      },
      body: JSON.stringify({
        model: 'google/gemini-3.1-flash-tts-preview',
        input: text.trim(),
        voice: selectedVoice,
        response_format: 'mp3'
      })
    });

    if (!response.ok) {
      const body = await response.text();
      let data = null;
      try { data = JSON.parse(body); } catch {}
      return res.status(response.status).json({
        error: data?.error?.message || data?.message || body || 'OpenRouter TTS request failed'
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'OpenRouter TTS request failed' });
  }
}
