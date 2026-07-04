export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Upstream didn't return JSON at all — surface a clean error instead of
      // letting an unparseable body crash the client.
      return res.status(502).json({ error: `Anthropic API returned a non-JSON response (status ${response.status}).` });
    }
    return res.status(response.status).json(data);
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Request to Anthropic API timed out after 55 seconds.' });
    }
    return res.status(500).json({ error: error.message });
  }
}
