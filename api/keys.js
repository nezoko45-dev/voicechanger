export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { openrouterKey, deepgramKey } = req.body || {};
    if (!openrouterKey && !deepgramKey) return res.status(400).json({ error: 'No API key supplied' });
    // Browser-provided keys cannot be persisted securely by a stateless serverless function.
    // This endpoint intentionally does not echo or log secrets.
    return res.status(501).json({ error: 'Secure key storage is not configured yet. A persistent encrypted secret store is required.' });
  }
  if (req.method === 'GET') return res.status(200).json({ openrouter: false, deepgram: false });
  return res.status(405).json({ error: 'GET or POST only' });
}
