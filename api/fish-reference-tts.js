function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://nezoko45-dev.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.FISH_READER_ACCESS_CODE) return res.status(503).json({ error: "Add FISH_READER_ACCESS_CODE to your Vercel environment variables." });
  if (req.headers["x-reader-access-code"] !== process.env.FISH_READER_ACCESS_CODE) return res.status(401).json({ error: "Reader access code is incorrect." });
  if (!process.env.FISH_AUDIO_API_KEY) return res.status(503).json({ error: "Add FISH_AUDIO_API_KEY to your Vercel environment variables." });
  try {
    const { text, reference_id, speed } = req.body || {};
    if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "Enter text to read aloud." });
    if (text.length > 3000) return res.status(413).json({ error: "Keep each reading under 3,000 characters." });
    if (typeof reference_id !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(reference_id)) return res.status(400).json({ error: "Upload your reference WAV first and select its saved voice ID." });
    const rate = Number(speed);
    const response = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.FISH_AUDIO_API_KEY,
        "Content-Type": "application/json",
        model: "s2.1-pro"
      },
      body: JSON.stringify({
        text: text.trim(),
        reference_id,
        format: "mp3",
        normalize: true,
        prosody: { speed: Number.isFinite(rate) ? Math.min(1.5, Math.max(0.5, rate)) : 1 }
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error("Fish Audio TTS:", response.status, detail);
      return res.status(response.status).json({ error: "Fish Audio could not synthesize this text. Check the API key, voice ID, and account credits." });
    }
    const audio = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Content-Length", audio.length);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(audio);
  } catch (error) {
    console.error("Fish Audio TTS error:", error);
    return res.status(502).json({ error: "Fish Audio speech generation failed." });
  }
}
