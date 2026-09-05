import { decryptKeys, readCookie } from './_key-store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { openrouterKey } = decryptKeys(readCookie(req));
    if (!openrouterKey) {
      return res.status(401).json({ error: 'OpenRouter is not connected. Open API Integrations and save your OpenRouter key.' });
    }

    const { text, voice } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'Missing text' });

    const validVoices = new Set(['Kore', 'Aoede', 'Leda', 'Zephyr']);
    const selectedVoice = validVoices.has(voice?.trim()) ? voice.trim() : 'Kore';

    const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
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
    return res.status(200).json({ audio: buffer.toString('base64'), format: 'mp3' });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'OpenRouter TTS request failed' });
  }
}
