export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch('https://api.recommander.cards/public-release/api/decks/recommend/top', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: `Recommander returned a non-JSON response (status ${response.status}).` });
    }
    return res.status(response.status).json(data);
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Recommander took too long to respond.' });
    }
    return res.status(500).json({ error: error.message });
  }
}
