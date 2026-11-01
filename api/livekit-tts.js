import { inference } from "@livekit/agents";

function send(res, status, body, type = "application/json") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Access-Control-Allow-Origin", "https://nezoko45-dev.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

function wavFromPcm(frame) {
  const pcm = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
  const channels = frame.channels || 1;
  const sampleRate = frame.sampleRate || 24000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://nezoko45-dev.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return send(res, 503, { error: "LiveKit is not configured yet. Add LIVEKIT_API_KEY and LIVEKIT_API_SECRET to the Vercel project environment." });
  }

  try {
    const { text, voice } = req.body || {};
    if (typeof text !== "string" || !text.trim()) return send(res, 400, { error: "Enter text to read." });
    if (text.length > 3000) return send(res, 413, { error: "Please keep each request under 3,000 characters." });

    const tts = new inference.TTS({
      apiKey: process.env.LIVEKIT_API_KEY,
      apiSecret: process.env.LIVEKIT_API_SECRET,
      model: "fishaudio/s2.1-pro",
      voice: typeof voice === "string" && voice.length < 128 ? voice : "b347db033a6549378b48d00acb0d06cd",
      language: "en",
      sampleRate: 24000
    });
    try {
      const frame = await tts.synthesize(text.trim()).collect();
      const wav = wavFromPcm(frame);
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Content-Length", wav.length);
      res.setHeader("Cache-Control", "no-store");
      return res.end(wav);
    } finally {
      await tts.close?.();
    }
  } catch (error) {
    console.error("LiveKit TTS error:", error);
    return send(res, 502, { error: "LiveKit speech generation failed. Check the LiveKit credentials, project quota, and selected voice." });
  }
}
