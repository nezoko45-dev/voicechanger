exports.handler = async (event) => {
  try {
    const deepgramKey = process.env.DEEPGRAM_API_KEY;
    const fishKey = process.env.FISH_API_KEY;
    const fishReferenceId = process.env.FISH_REFERENCE_ID || '';
    const fishModel = process.env.FISH_MODEL || 's2.1-pro-free';
    const deepgramModel = process.env.DEEPGRAM_MODEL || 'nova-3';

    if (!deepgramKey || !fishKey) {
      return json(500, { error: 'Set DEEPGRAM_API_KEY and FISH_API_KEY in Netlify environment variables.' });
    }

    if (!event.body) return json(400, { error: 'No audio received.' });

    const audio = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
    if (!audio.length || audio.length > 25 * 1024 * 1024) {
      return json(400, { error: 'Invalid audio upload size.' });
    }

    const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || 'audio/webm';
    const deepgramUrl = new URL('https://api.deepgram.com/v1/listen');
    deepgramUrl.searchParams.set('model', deepgramModel);
    deepgramUrl.searchParams.set('smart_format', 'true');
    deepgramUrl.searchParams.set('punctuate', 'true');

    const dg = await fetch(deepgramUrl, {
      method: 'POST',
      headers: {
        Authorization: `Token ${deepgramKey}`,
        'Content-Type': contentType
      },
      body: audio
    });

    if (!dg.ok) {
      const detail = await dg.text();
      return json(dg.status, { error: `Deepgram error: ${detail.slice(0, 500)}` });
    }

    const dgData = await dg.json();
    const transcript = dgData?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || '';
    if (!transcript) return json(200, { transcript: '', audio: '' });

    const fishBody = {
      text: transcript,
      format: 'mp3',
      model: fishModel
    };
    if (fishReferenceId) fishBody.reference_id = fishReferenceId;

    const fish = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fishKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(fishBody)
    });

    if (!fish.ok) {
      const detail = await fish.text();
      return json(fish.status, { error: `Fish Audio error: ${detail.slice(0, 500)}` });
    }

    const output = Buffer.from(await fish.arrayBuffer()).toString('base64');
    return json(200, { transcript, audio: output });
  } catch (error) {
    return json(500, { error: error?.message || 'Conversion failed.' });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
