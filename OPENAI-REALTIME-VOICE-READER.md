# OpenAI Realtime Voice Reader

This folder is the browser UI for the GitHub Pages voice reader. It uses OpenAI's Realtime API for speech-to-speech conversation, rather than trying to click ChatGPT webpage buttons or relying on browser text-to-speech.

## Important architecture note

GitHub Pages is static hosting and cannot run the API-key-protected session endpoint. Deploy `api/session.js` to Vercel (or adapt it to another serverless host), then set `OPENAI_API_KEY` as a server-side environment variable. Never put the permanent API key in this repository or in the webpage.

1. Create a Vercel project from this repository and set the project root directory to the repository root.
2. Add `OPENAI_API_KEY` in Vercel → Project Settings → Environment Variables, for Preview and Production.
3. Deploy the project. The function is available at `https://YOUR-VERCEL-DOMAIN/api/session`.
4. Open the GitHub Pages reader and paste that full HTTPS endpoint into “Secure voice backend URL”.
5. Click Start voice conversation and allow microphone access.

The browser sends the WebRTC SDP offer to the function. The function forwards it to OpenAI using the secret environment variable and returns the SDP answer. The API key is never sent to the browser.

## Voice

The API is configured with the OpenAI Realtime model and the `marin` voice. OpenAI API voices are not guaranteed to be identical to the voice selected in ChatGPT Voice Mode. API usage is billed separately from a ChatGPT subscription.
