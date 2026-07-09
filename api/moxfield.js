// Imports a full deck from a Moxfield share link.
//
// Why this is a "smart" proxy rather than a passthrough like chat/combos/recommander:
//   1. Moxfield's API sits behind Cloudflare, which fingerprints the TLS handshake (not just
//      headers) and returns 403 to server-side clients (Node/undici) even with a browser
//      User-Agent. The supported way through is Moxfield's API-access program: register at
//      api@moxfield.com, get an approved User-Agent, and set it as MOXFIELD_USER_AGENT in the
//      deploy environment. Until that's set, this returns a clear "paste the export" message.
//   2. The v3 deck payload embeds full card objects (~1.4 MB for a Commander deck). We only
//      need names + printings, so we parse here and return a few KB of decklist text in the
//      exact format The Mulligan's parseDeckList / extractPrintingHints read.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const input = ((req.body && (req.body.url || req.body.id)) || '').toString().trim();
  if (!input) return res.status(400).json({ error: 'Provide a Moxfield deck link.' });

  // Accept a full URL (any moxfield.com host) or a bare public id.
  let publicId = null;
  const m = input.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i);
  if (m) publicId = m[1];
  else if (/^[A-Za-z0-9_-]{3,}$/.test(input)) publicId = input;
  if (!publicId) return res.status(400).json({ error: "That doesn't look like a Moxfield deck link. It should look like https://moxfield.com/decks/..." });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const upstream = await fetch(`https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(publicId)}`, {
      headers: {
        // See header note above. MOXFIELD_USER_AGENT (an approved UA) is what gets past
        // Cloudflare; the browser string is only a fallback so the code path is exercised.
        'User-Agent': process.env.MOXFIELD_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (upstream.status === 404) {
      return res.status(404).json({ error: 'Deck not found. It may be private, unlisted, or the link is wrong.' });
    }
    if (upstream.status === 403) {
      // Either MOXFIELD_USER_AGENT isn't set yet, or the configured UA isn't approved.
      return res.status(502).json({
        error: "Moxfield URL import isn't available right now — their API blocked the request. Open the deck on Moxfield → More → Export, and paste the decklist text below instead.",
        code: 'moxfield_blocked',
      });
    }

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: `Moxfield returned an unexpected (non-JSON) response — status ${upstream.status}.` });
    }
    if (!upstream.ok) {
      return res.status(502).json({ error: data?.message || `Moxfield error (status ${upstream.status}).` });
    }

    const boards = data.boards || {};

    // One decklist line per card entry, in the format parseDeckList + extractPrintingHints
    // expect: "<qty> <name> (<SET>) <collectorNumber>". The set/collector number make The
    // Mulligan pull the exact printing's art; if a printing doesn't resolve on Scryfall it
    // falls back to name-based data, so including it is upside-only.
    const lineFor = (entry) => {
      const card = (entry && entry.card) || {};
      const name = card.name;
      if (!name) return null;
      const qty = entry.quantity || 1;
      const printing = (card.set && card.cn) ? ` (${String(card.set).toUpperCase()}) ${card.cn}` : '';
      return `${qty} ${name}${printing}`;
    };
    const boardLines = (key) => Object.values((boards[key] && boards[key].cards) || {}).map(lineFor).filter(Boolean);

    // Command zone first so The Mulligan treats the commander as card #1, then the deck.
    // signatureSpells (Oathbreaker) and companions are empty for normal Commander decks but
    // cost nothing to include and keep those formats importable.
    const commanderLines = [...boardLines('commanders'), ...boardLines('signatureSpells'), ...boardLines('companions')];
    const mainLines = boardLines('mainboard');
    const lines = [...commanderLines, ...mainLines];

    if (lines.length === 0) {
      return res.status(422).json({ error: 'That deck has no cards in its mainboard.' });
    }

    const commandersCards = Object.values((boards.commanders && boards.commanders.cards) || {});
    const mainboardCards = Object.values((boards.mainboard && boards.mainboard.cards) || {});
    const commanderName = (commandersCards[0] && commandersCards[0].card && commandersCards[0].card.name)
      || (mainboardCards[0] && mainboardCards[0].card && mainboardCards[0].card.name)
      || '';

    return res.status(200).json({
      name: data.name || '',
      format: data.format || '',
      commander: commanderName,
      hasCommander: commandersCards.length > 0,
      cardlist: lines.join('\n'),
      counts: {
        commanders: (boards.commanders && boards.commanders.count) || 0,
        mainboard: (boards.mainboard && boards.mainboard.count) || 0,
      },
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Moxfield took too long to respond. Try again in a moment.' });
    }
    return res.status(500).json({ error: error.message });
  }
}
