const ALLOWED_ORIGIN = "https://nezoko45-dev.github.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed." }, 405);
    }

    const origin = request.headers.get("Origin");
    if (origin && origin !== ALLOWED_ORIGIN) {
      return json({ error: "Origin not allowed." }, 403);
    }

    const url = new URL(request.url);
    if (url.pathname !== "/assembly-token" && url.pathname !== "/") {
      return json({ error: "Not found." }, 404);
    }

    const apiKey = env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      return json({ error: "ASSEMBLYAI_API_KEY is not configured on the Cloudflare Worker." }, 500);
    }

    try {
      const response = await fetch(
        "https://streaming.assemblyai.com/v3/token?expires_in_seconds=300",
        { headers: { authorization: apiKey } },
      );

      const body = await response.text();
      if (!response.ok) {
        return json({
          error: `AssemblyAI token request failed (${response.status}).`,
          details: body,
        }, response.status);
      }

      const data = JSON.parse(body);
      if (!data.token) {
        return json({ error: "AssemblyAI returned no temporary token." }, 502);
      }

      return json({ token: data.token });
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : "Token request failed.",
      }, 502);
    }
  },
};
