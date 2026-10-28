// Exchange a user-entered OpenAI API key for a short-lived Realtime client secret.
// The permanent key is not stored or logged by this function. Use HTTPS and a dedicated API key.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Use POST with { apiKey }." });
  }

  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey || !/^sk-[A-Za-z0-9_-]+$/.test(apiKey)) {
    return res.status(400).json({ error: "Missing or invalid OpenAI API key." });
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
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
        }
      })
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data?.error?.message || "OpenAI could not create a voice token. Check your API key and API billing."
      });
    }
    return res.status(200).json({ value: data.value, expires_at: data.expires_at });
  } catch (error) {
    console.error("Realtime token creation failed:", error?.message || "unknown error");
    return res.status(500).json({ error: "Failed to create a short-lived voice token." });
  }
}