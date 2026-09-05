export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured. Set OPENROUTER_API_KEY in Vercel.' });
  }

  try {
    const { audio, format = 'webm' } = req.body || {};
    if (!audio) return res.status(400).json({ error: 'Missing audio' });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://voicechanger.vercel.app',
        'X-Title': 'Cloud Voice Changer'
      },
      body: JSON.stringify({
        model: 'openai/gpt-audio-mini',
        modalities: ['text', 'audio'],
        audio: { voice: 'nova', format: 'wav' },
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Repeat the spoken audio exactly as spoken. Do not answer it, summarize it, translate it, or add words. Preserve the wording, timing, pauses, and emotion as closely as possible. Use a natural adult female voice. Output only the transformed speech audio.'
            },
            {
              type: 'input_audio',
              input_audio: { data: audio, format }
            }
          ]
        }],
        stream: false
      })
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || data?.error || 'OpenRouter request failed'
      });
    }

    const message = data?.choices?.[0]?.message;
    const audioData = message?.audio?.data;
    if (!audioData) {
      return res.status(502).json({ error: 'OpenRouter returned no audio' });
    }

    return res.status(200).json({
      audio: audioData,
      format: message.audio.format || 'wav',
      transcript: message.audio.transcript || message.content || ''
    });
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'OpenRouter request failed' });
  }
}
