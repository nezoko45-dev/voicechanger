# OpenAI Realtime Voice Reader

This GitHub Pages app uses OpenAI's Realtime API for speech-to-speech conversation, without detecting buttons on the ChatGPT website or using browser text-to-speech.

## Setup

GitHub Pages is static hosting, so it cannot run the token endpoint itself. Deploy `api/session.js` to Vercel (or another compatible serverless host) once.

1. Create a Vercel project from this repository, with the repository root as the project root, then deploy.
2. Open the deployed function URL, `https://YOUR-VERCEL-DOMAIN/api/session`.
3. Open the GitHub Pages reader. Paste the function URL into **Secure token endpoint URL** and paste your OpenAI API key into **OpenAI API key**.
4. The API-key field saves the key automatically in this browser's local storage. It is not written into the GitHub JavaScript file.
5. Click **Start voice conversation** and allow microphone access.

The serverless function exchanges the entered key for a short-lived Realtime client secret. The browser uses that short-lived token to establish WebRTC with OpenAI. The permanent key is sent over HTTPS to the token endpoint each time a voice session starts; the endpoint does not intentionally store or log it. Only use a backend you trust and a dedicated OpenAI API key with usage limits. Anyone with access to this browser profile can read the locally saved key, so clear the key field/local storage before sharing the browser profile.

## Voice and billing

The API is configured with the OpenAI Realtime model and the `marin` voice. OpenAI API voices are not guaranteed to be identical to the voice selected in ChatGPT Voice Mode. API usage is billed separately from a ChatGPT subscription.
