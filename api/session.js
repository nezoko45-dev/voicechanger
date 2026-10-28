// Vercel serverless endpoint for the OpenAI Realtime API.
// Set OPENAI_API_KEY in the Vercel project's Environment Variables.
// Never put the permanent API key in the browser or in this repository.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).send("Use POST with an SDP offer.");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).send("Server is missing OPENAI_API_KEY.");

  let sdp = "";
  try {
    if (typeof req.body === "string") sdp = req.body;
    else if (Buffer.isBuffer(req.body)) sdp = req.body.toString("utf8");
    else if (req.body && typeof req.body.sdp === "string") sdp = req.body.sdp;
    if (!sdp || !sdp.includes("v=0")) return res.status(400).send("Missing or invalid SDP offer.");
    const session = {
      type: "realtime",
      model: "gpt-realtime-2.1",
      instructions: "You are ChatGPT, a friendly, helpful conversational voice assistant. Reply naturally and concisely. Speak your answer aloud. Let the user finish speaking before responding.",
      audio: {
        input: {
          transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
          turn_detection: { type: "server_vad", create_response: true, interrupt_response: true }
        },
        output: { voice: "marin" }
      }
    };
    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(session));
    const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey },
      body: form
    });
    const body = await upstream.text();
    res.setHeader("Content-Type", "application/sdp");
    return res.status(upstream.status).send(body);
  } catch (error) {
    console.error("Realtime session setup failed:", error?.message || error);
    return res.status(500).send("Failed to create a voice session.");
  }
}