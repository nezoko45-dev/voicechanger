export default async () => {
  const apiKey = Netlify.env.get("ASSEMBLYAI_API_KEY");

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ASSEMBLYAI_API_KEY is not configured on Netlify." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const response = await fetch("https://streaming.assemblyai.com/v3/token?expires_in_seconds=300", {
      headers: { authorization: apiKey },
    });

    const body = await response.text();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: `AssemblyAI token request failed (${response.status}).`, details: body }), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }

    const data = JSON.parse(body);
    return new Response(JSON.stringify({ token: data.token }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Token request failed." }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = {
  path: "/.netlify/functions/assembly-token",
};
