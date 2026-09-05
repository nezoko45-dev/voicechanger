export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured. Set OPENROUTER_API_KEY in Vercel.' });
  }

  try {
    const { text, voice } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'Missing text' });

    // Keep compatibility with the existing browser UI while switching providers.
    // The old Cartesia voice IDs are mapped to valid Gemini TTS voices.
    const voiceMap = {
      'f786b574-daa5-4673-aa0c-cbe3e8534c02': 'Kore',
      'a5136bf9-224c-4d76-b823-52bd5efcffcc': 'Aoede'
    };
    const selectedVoice = voiceMap[voice?.trim()] || voice?.trim() || 'Kore';

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
      let data;
      try { data = JSON.parse(body); } catch { data = null; }
      const message = data?.error?.message || data?.message || body || 'OpenRouter TTS request failed';
      return res.status(response.status).json({ error: message });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return res.status(200).json({
      audio: buffer.toString('base64'),
      format: 'mp3'
    });
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'OpenRouter TTS request failed' });
  }
}
