# 🎙️ VoiceChanger

A static GitHub Pages VoiceChanger using AssemblyAI Universal-3.5 Pro Streaming.

## Pipeline

**🎤 Microphone → Cloudflare Worker temporary-token endpoint → AssemblyAI WebSocket → 📝 transcript → 🔊 browser speech**

## Cloudflare Worker setup

The repository includes `cloudflare-worker.js` and `wrangler.jsonc` for the secure AssemblyAI token endpoint.

1. In Cloudflare Workers & Pages, create/deploy the Worker from this repository.
2. Use the Worker name `voicechanger-token` (the included `wrangler.jsonc` already sets this name).
3. Add an encrypted Worker secret named `ASSEMBLYAI_API_KEY` containing your AssemblyAI API key.
4. Deploy the Worker.
5. Copy its `workers.dev` URL and replace `TOKEN_ENDPOINT` near the top of `index.html` with that URL followed by `/assembly-token`.
6. Commit the `index.html` change and open the GitHub Pages site.

Cloudflare Worker secrets keep the permanent AssemblyAI key server-side; it is never placed in the frontend. The Worker only returns a short-lived AssemblyAI token.

## Frontend

The frontend is a single static `index.html` and can be hosted on GitHub Pages. It does not require Netlify.

## Important

The old Netlify AssemblyAI function has been removed. No permanent AssemblyAI API key should be committed to this repository.

## Troubleshooting

The app shows the WebSocket state, AssemblyAI errors, close code, and token-service errors in its diagnostics area so connection problems are visible instead of hidden behind an endless reconnect loop.
