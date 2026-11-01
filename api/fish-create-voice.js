export const config = { api: { bodyParser: false } };

const ORIGIN = "https://nezoko45-dev.github.io";
function headers(res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
async function readBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Reference WAV is too large. Keep it under 4 MB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export default async function handler(req, res) {
  headers(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.FISH_AUDIO_API_KEY) return res.status(503).json({ error: "Add FISH_AUDIO_API_KEY to your Vercel environment variables." });
  const contentType = req.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) return res.status(415).json({ error: "Upload the WAV as multipart/form-data." });
  try {
    const body = await readBody(req, 4 * 1024 * 1024);
    const upstream = await fetch("https://api.fish.audio/model", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.FISH_AUDIO_API_KEY,
        "Content-Type": contentType
      },
      body
    });
    const result = await upstream.text();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    return res.status(upstream.status).send(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Could not upload the reference voice." });
  }
}
