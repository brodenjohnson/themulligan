const SUPABASE_URL = 'https://qowhaosiuwcxlfyypqcx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvd2hhb3NpdXdjeGxmeXlwcWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMTcxNTcsImV4cCI6MjA5ODY5MzE1N30.k3P_wunsm834buQIS2pTVE39Q8ZgEDZ1-DhdNJ6PxUs';

let refreshPromise = null;

async function sbFetch(path, options = {}, isRetry = false) {
  const session = getSession();
  const headers = {
    'apikey': SUPABASE_KEY,
    'Content-Type': 'application/json',
    ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.message || err.error_description || err.msg || `HTTP ${res.status}`;
    const isExpired = res.status === 401 && /jwt expired|invalid jwt|jwt is expired/i.test(msg);
    if (isExpired && !isRetry && session?.refresh_token) {
      const refreshed = await refreshSession();
      if (refreshed) return sbFetch(path, options, true);
      setSession(null);
      window.location.href = '/login';
      throw new Error('Session expired. Redirecting to sign in.');
    }
    throw new Error(msg);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  const session = getSession();
  if (!session?.refresh_token) return false;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.access_token) return false;
      setSession(data);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function getSession() {
  try {
    const raw = localStorage.getItem('mulligan_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setSession(session) {
  if (session) localStorage.setItem('mulligan_session', JSON.stringify(session));
  else localStorage.removeItem('mulligan_session');
}

async function signIn(email, password) {
  const data = await sbFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setSession(data);
  return data;
}

async function signUp(email, password) {
  const data = await sbFetch('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (data.session) setSession(data.session);
  return data;
}

async function signOut() {
  const session = getSession();
  if (session) {
    await sbFetch('/auth/v1/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    }).catch(() => {});
  }
  setSession(null);
  window.location.href = '/login';
}

function requireAuth() {
  const session = getSession();
  if (!session) { window.location.href = '/login'; return null; }
  const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
  if (expiresAt && expiresAt < Date.now() + 60000) {
    refreshSession().then(ok => { if (!ok) { setSession(null); window.location.href = '/login'; } });
  }
  return session;
}

async function getDecks() {
  return sbFetch('/rest/v1/decks?select=*&order=updated_at.desc');
}

async function getDeck(id) {
  const rows = await sbFetch(`/rest/v1/decks?id=eq.${id}&select=*`);
  return rows?.[0] || null;
}

async function saveDeck(deck) {
  const session = getSession();
  if (!session) throw new Error('Not logged in');
  const payload = { ...deck, user_id: session.user.id, updated_at: new Date().toISOString() };
  if (deck.id) {
    await sbFetch(`/rest/v1/decks?id=eq.${deck.id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify(payload),
    });
    return deck.id;
  } else {
    const rows = await sbFetch('/rest/v1/decks', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    });
    return rows?.[0]?.id;
  }
}

async function deleteDeck(id) {
  return sbFetch(`/rest/v1/decks?id=eq.${id}`, { method: 'DELETE' });
}

async function getCollection() {
  const rows = await sbFetch('/rest/v1/collections?select=cards');
  return rows?.[0]?.cards || [];
}

async function saveCollection(cards) {
  const session = getSession();
  if (!session) return;
  // cards can be array of strings (legacy) or array of {name, quantity, set, listedIn}
  const normalized = cards.map(c => typeof c === 'string' ? { name: c, quantity: 1, set: '', listedIn: 'Bulk' } : c);
  await sbFetch('/rest/v1/collections?on_conflict=user_id', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: session.user.id, cards: normalized, updated_at: new Date().toISOString() }),
  });
}

async function fetchScryfallBulk(cardNames) {
  const results = {};
  const unique = [...new Set(cardNames.map(c => c.trim()).filter(Boolean))];
  // Scryfall's bulk /cards/collection endpoint does not match "Front // Back" format —
  // it needs the front face name only. Build a map from front-face name back to original names.
  const frontFaceMap = {};
  unique.forEach(name => {
    const front = name.split(' // ')[0].trim();
    if (!frontFaceMap[front]) frontFaceMap[front] = [];
    frontFaceMap[front].push(name);
  });
  const frontFaceNames = Object.keys(frontFaceMap);
  for (let i = 0; i < frontFaceNames.length; i += 75) {
    const batch = frontFaceNames.slice(i, i + 75);
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
      });
      if (res.ok) {
        const data = await res.json();
        (data.data || []).forEach(card => {
          const oracleText = card.card_faces
            ? card.card_faces.map(f => `${f.name}${f.mana_cost ? ` [${f.mana_cost}]` : ''} ${f.type_line || ''}: ${f.oracle_text || ''}`).join(' // ')
            : card.oracle_text || '';
          const manaCost = card.mana_cost || card.card_faces?.[0]?.mana_cost || '';
          const typeLine = card.type_line || card.card_faces?.[0]?.type_line || '';
          const cardData = {
            name: card.name,
            mana_cost: manaCost,
            cmc: card.cmc || 0,
            type_line: typeLine,
            oracle_text: oracleText,
            colors: card.colors || card.card_faces?.[0]?.colors || [],
            color_identity: card.color_identity || [],
            power: card.power || card.card_faces?.[0]?.power || null,
            toughness: card.toughness || card.card_faces?.[0]?.toughness || null,
            image_uris: card.image_uris || card.card_faces?.[0]?.image_uris || null,
            prices: card.prices || {},
            set_name: card.set_name || '',
          };
          // Store under: full returned name, front face of returned name,
          // and every original requested name that maps to this front face (handles
          // cases where our deck list stores "Front // Back" but Scryfall was only
          // queried with "Front").
          const key = card.name.toLowerCase();
          const simpleKey = card.name.split(' // ')[0].toLowerCase().trim();
          results[key] = cardData;
          results[simpleKey] = cardData;
          const originalNames = frontFaceMap[simpleKey] || frontFaceMap[card.name] || [];
          originalNames.forEach(origName => {
            results[origName.toLowerCase()] = cardData;
          });
        });
      }
    } catch (e) { console.warn('Scryfall batch failed', e); }
    if (i + 75 < frontFaceNames.length) await new Promise(r => setTimeout(r, 150));
  }
  return results;
}

// Extracts { nameLower: { set, collectorNumber } } from a raw decklist paste, so we can
// later fetch the EXACT printing the person owns (correct artwork) rather than whatever
// default printing Scryfall's name-only lookup happens to return.
// Handles lines like: "1x Krenko, Mob Boss (SLD) 2407 *F*" or "Arena of Glory (PLST) MH3-215"
function extractPrintingHints(rawText) {
  const hints = {};
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('//') || line.startsWith('#')) continue;
    let rest = line.replace(/^(\d+)x?\s+/, '');
    // Match: <name> (SET) <collector-number-ish>  [optional *F*]
    const m = rest.match(/^(.+?)\s+\(([A-Za-z0-9]{2,6})\)\s+([\w★-]+)\s*(\*F\*)?\s*$/);
    if (!m) continue;
    const name = m[1].trim().split(' // ')[0].toLowerCase();
    const set = m[2].toLowerCase();
    // Collector number can be a plain number, have a letter suffix (39s), a star (129★), or
    // be a "SET-NUMBER" style reference for The List reprints (MH3-215) — Scryfall wants just
    // the plain collector number as it appears on the card, so strip trailing letters/stars
    // and take the numeric part after any hyphenated set prefix.
    let collectorNumber = m[3].replace(/[★]/g, '').replace(/^[A-Za-z0-9]+-/, '');
    hints[name] = { set, collectorNumber };
  }
  return hints;
}

// Fetches exact printings (correct artwork) for cards where we know set + collector number.
// Returns the same shape as fetchScryfallBulk's result map, keyed by card name (lowercase).
async function fetchExactPrintings(hints) {
  const results = {};
  const entries = Object.entries(hints);
  for (let i = 0; i < entries.length; i += 75) {
    const batch = entries.slice(i, i + 75);
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(([, h]) => ({ set: h.set, collector_number: h.collectorNumber })) }),
      });
      if (res.ok) {
        const data = await res.json();
        (data.data || []).forEach(card => {
          const oracleText = card.card_faces
            ? card.card_faces.map(f => `${f.name}${f.mana_cost ? ` [${f.mana_cost}]` : ''} ${f.type_line || ''}: ${f.oracle_text || ''}`).join(' // ')
            : card.oracle_text || '';
          const cardData = {
            name: card.name,
            mana_cost: card.mana_cost || card.card_faces?.[0]?.mana_cost || '',
            cmc: card.cmc || 0,
            type_line: card.type_line || card.card_faces?.[0]?.type_line || '',
            oracle_text: oracleText,
            colors: card.colors || card.card_faces?.[0]?.colors || [],
            color_identity: card.color_identity || [],
            power: card.power || card.card_faces?.[0]?.power || null,
            toughness: card.toughness || card.card_faces?.[0]?.toughness || null,
            image_uris: card.image_uris || card.card_faces?.[0]?.image_uris || null,
            prices: card.prices || {},
            set_name: card.set_name || '',
          };
          const key = card.name.split(' // ')[0].toLowerCase().trim();
          results[key] = cardData;
        });
      }
    } catch (e) { console.warn('Exact printing lookup batch failed', e); }
    if (i + 75 < entries.length) await new Promise(r => setTimeout(r, 100));
  }
  return results;
}

// Reconciles a deck's card list against the collection: cards newly added to the deck get
// pulled from Bulk (if available) and tagged with this deck's name; cards removed from the
// deck get moved back to Bulk. This is what makes the collection's "In decks" / "Decks
// tracked" stats actually reflect reality, and what puts a coloured deck tag on each card.
// Mutates and returns the same collectionRaw array (array of {name, quantity, set, listedIn}).
function reconcileDeckCollection(oldCardNames, newCardNames, deckName, collectionRaw) {
  const basics = ['swamp', 'island', 'mountain', 'forest', 'plains'];
  const normalize = n => (n || '').split(' // ')[0].toLowerCase().trim();
  const oldFreq = new Map();
  oldCardNames.forEach(n => { const k = normalize(n); oldFreq.set(k, (oldFreq.get(k) || 0) + 1); });
  const newFreq = new Map();
  newCardNames.forEach(n => { const k = normalize(n); newFreq.set(k, (newFreq.get(k) || 0) + 1); });
  const allKeys = new Set([...oldFreq.keys(), ...newFreq.keys()]);
  const deckNameLower = (deckName || '').toLowerCase();
  let pulledFromBulk = 0, returnedToBulk = 0;

  allKeys.forEach(key => {
    if (basics.includes(key)) return; // basics aren't worth tracking per-copy
    const oldCount = oldFreq.get(key) || 0;
    const newCount = newFreq.get(key) || 0;
    if (newCount > oldCount) {
      let toPull = newCount - oldCount;
      for (const item of collectionRaw) {
        if (toPull === 0) break;
        if (normalize(item.name) === key && (item.listedIn || 'Bulk').toLowerCase() === 'bulk') {
          item.listedIn = deckName;
          toPull--;
          pulledFromBulk++;
        }
      }
    } else if (oldCount > newCount) {
      let toReturn = oldCount - newCount;
      for (const item of collectionRaw) {
        if (toReturn === 0) break;
        if (normalize(item.name) === key && (item.listedIn || '').toLowerCase() === deckNameLower) {
          item.listedIn = 'Bulk';
          toReturn--;
          returnedToBulk++;
        }
      }
    }
  });

  return { collectionRaw, pulledFromBulk, returnedToBulk };
}

const COLOR_CACHE_KEY = 'mulligan_card_colors_v1';

function getColorCache() {
  try {
    const raw = localStorage.getItem(COLOR_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function setColorCache(cache) {
  try {
    localStorage.setItem(COLOR_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('Colour cache write failed — collection may be very large, cache skipped', e);
  }
}

// Returns { [nameLower]: { color_identity: string[], is_land: boolean } } for every
// requested name. Looks up a persistent local cache first (keyed by card name, shared
// across all decks and collection uploads) and only queries Scryfall for names not yet
// cached. This is what makes full-collection colour filtering fast after the first run.
async function getColorIdentities(names, onProgress) {
  const cache = getColorCache();
  const unique = [...new Set(names.map(n => n.split(' // ')[0].trim().toLowerCase()).filter(Boolean))];
  const missing = unique.filter(n => !cache[n]);
  if (missing.length > 0) {
    const total = missing.length;
    let done = 0;
    for (let i = 0; i < missing.length; i += 75) {
      const batch = missing.slice(i, i + 75);
      try {
        const res = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
        });
        if (res.ok) {
          const data = await res.json();
          (data.data || []).forEach(card => {
            const key = card.name.split(' // ')[0].toLowerCase().trim();
            const typeLine = card.type_line || card.card_faces?.[0]?.type_line || '';
            cache[key] = {
              color_identity: card.color_identity || [],
              is_land: typeLine.includes('Land'),
            };
          });
          // Anything Scryfall didn't recognise — mark as unknown so we don't keep re-querying it forever.
          (data.not_found || []).forEach(nf => {
            const key = (nf.name || '').toLowerCase();
            if (key) cache[key] = { color_identity: null, is_land: false };
          });
        }
      } catch (e) { console.warn('Colour lookup batch failed', e); }
      done += batch.length;
      if (onProgress) onProgress(Math.min(done, total), total);
      if (i + 75 < missing.length) await new Promise(r => setTimeout(r, 100));
    }
    setColorCache(cache);
  }
  const result = {};
  unique.forEach(n => { result[n] = cache[n] || { color_identity: null, is_land: false }; });
  return result;
}

// Filters a list of card names down to only those castable in the given commander
// colour identity (subset match), excluding basics/lands are kept as-is by caller.
function filterByColorIdentity(names, commanderColors, colorData) {
  const commanderSet = new Set(commanderColors || []);
  return names.filter(name => {
    const key = name.split(' // ')[0].trim().toLowerCase();
    const info = colorData[key];
    if (!info || info.color_identity === null) return false; // unknown card — exclude rather than risk an uncastable suggestion
    return info.color_identity.every(c => commanderSet.has(c));
  });
}

function parseDeckList(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const cards = [];
  for (const line of lines) {
    if (line.startsWith('//') || line.startsWith('#')) continue;
    let name = line;
    // Strip leading quantity: "1x " or "1 "
    const qtyMatch = name.match(/^(\d+)x?\s+(.+)$/);
    let count = 1;
    if (qtyMatch) { count = parseInt(qtyMatch[1]); name = qtyMatch[2].trim(); }
    // Strip foil flag: *F*
    name = name.replace(/\s*\*F\*\s*$/, '').trim();
    // Strip set code + collector number: " (SET) 123" or " (SET) 123s" at end
    name = name.replace(/\s+\([A-Z0-9]+\)\s+[\w★-]+\s*$/, '').trim();
    // Strip trailing set code only: " (SET)"
    name = name.replace(/\s+\([A-Z0-9]{2,5}\)\s*$/, '').trim();
    // Handle Japanese/non-latin cards — skip if name has no latin chars
    if (!/[a-zA-Z]/.test(name)) continue;
    // Strip duplicate DFC names like "Card // Card" → keep full name
    // (leave // in place, Scryfall handles it)
    name = name.trim();
    if (name && name.length > 1) {
      for (let i = 0; i < count; i++) cards.push(name);
    }
  }
  return cards;
}

async function validateDeckList(cards) {
  if (cards.length === 0) return { ok: false, error: 'No cards detected. Check your format.' };
  const sample = [...new Set(cards)].slice(0, 10);
  try {
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: sample.map(name => ({ name })) }),
    });
    if (!res.ok) return { ok: true, warnings: [] };
    const data = await res.json();
    const found = (data.data || []).length;
    const notFound = (data.not_found || []).map(n => n.name || JSON.stringify(n));
    const resolveRate = found / sample.length;
    if (resolveRate < 0.4) {
      return {
        ok: false,
        error: `Only ${found} of ${sample.length} sampled cards were recognised. Your list may be in an unsupported format.\n\nExpected formats:\n• One card name per line: "Syr Konrad, the Grim"\n• With quantity: "1x Syr Konrad, the Grim"\n• Mythic Tools export: "1x Syr Konrad, the Grim (FCA) 10"\n\nUnrecognised sample: ${sample.slice(0, 3).join(', ')}`,
      };
    }
    const warnings = notFound.length > 0
      ? [`${notFound.length} card${notFound.length !== 1 ? 's' : ''} not found in Scryfall and will be skipped: ${notFound.slice(0, 5).join(', ')}${notFound.length > 5 ? ` +${notFound.length - 5} more` : ''}`]
      : [];
    return { ok: true, warnings };
  } catch (e) {
    return { ok: true, warnings: ['Could not validate against Scryfall — saved anyway.'] };
  }
}

async function validateCollection(cards) {
  if (cards.length === 0) return { ok: false, error: 'No cards detected. Check your format.' };
  const sample = cards.slice(0, 15);
  try {
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: sample.map(name => ({ name })) }),
    });
    if (!res.ok) return { ok: true, warnings: [] };
    const data = await res.json();
    const found = (data.data || []).length;
    const resolveRate = found / sample.length;
    if (resolveRate < 0.3) {
      return {
        ok: false,
        error: `Only ${found} of ${sample.length} sampled cards were recognised. Your export may be in an unsupported format.\n\nSupported formats:\n• CSV with a "Name" column (Mythic Tools, Moxfield, Archidekt)\n• Plain text, one card name per line\n\nFirst few entries detected: ${sample.slice(0, 3).join(', ')}`,
      };
    }
    return { ok: true, warnings: [], count: cards.length };
  } catch (e) {
    return { ok: true, warnings: ['Could not validate — saved anyway.'], count: cards.length };
  }
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { result.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  result.push(cur.trim());
  return result;
}

function parseCollection(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const isCSV = lines[0].includes(',');
  if (!isCSV) {
    // Plain text — one card per line, all bulk
    const cards = [];
    for (const line of lines) {
      const qtyMatch = line.match(/^(\d+)x?\s+(.+)$/);
      let qty = 1, name = line;
      if (qtyMatch) { qty = parseInt(qtyMatch[1]); name = qtyMatch[2]; }
      name = name.replace(/\s*\*F\*\s*$/, '').trim();
      name = name.replace(/\s+\([A-Z0-9]+\)\s+[\w★-]+\s*$/, '').trim();
      if (!name || /^\d+$/.test(name) || !/[a-zA-Z]/.test(name)) continue;
      cards.push({ name, quantity: qty, set: '', listedIn: 'Bulk' });
    }
    return cards;
  }
  // CSV — detect columns
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g,''));
  const col = (names) => names.map(n => headers.indexOf(n)).find(i => i >= 0) ?? -1;
  const qtyCol = col(['qty','quantity','count','copies']);
  const nameCol = col(['name','cardname','card']);
  const setCol = col(['set','setname','edition']);
  const listedInCol = col(['listedin','listed','location','deck','deckname']);
  if (nameCol === -1) return [];
  const cards = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCSVLine(lines[i]);
    if (parts.length < 2) continue;
    let name = (parts[nameCol] || '').trim();
    name = name.replace(/\s*\*F\*\s*$/, '').trim();
    name = name.replace(/\s+\([A-Z0-9]+\)\s+[\w★-]+\s*$/, '').trim();
    if (!name || !/[a-zA-Z]/.test(name)) continue;
    const qty = qtyCol >= 0 ? (parseInt(parts[qtyCol]) || 1) : 1;
    const setName = setCol >= 0 ? (parts[setCol] || '').trim() : '';
    const listedIn = listedInCol >= 0 ? (parts[listedInCol] || 'Bulk').trim() : 'Bulk';
    for (let q = 0; q < qty; q++) {
      cards.push({ name, quantity: 1, set: setName, listedIn });
    }
  }
  return cards;
}

function collectionToLookup(collectionItems) {
  // Returns { cardNameLower: { total, bulk, decks: {deckName: count} } }
  const lookup = {};
  for (const item of collectionItems) {
    const key = item.name.toLowerCase().replace(/\s*\/\/.*$/, '').trim();
    if (!lookup[key]) lookup[key] = { name: item.name, total: 0, bulk: 0, decks: {} };
    lookup[key].total += item.quantity || 1;
    const loc = item.listedIn || 'Bulk';
    if (loc.toLowerCase() === 'bulk') {
      lookup[key].bulk += item.quantity || 1;
    } else {
      lookup[key].decks[loc] = (lookup[key].decks[loc] || 0) + (item.quantity || 1);
    }
  }
  return lookup;
}

function countPips(cards, cardData) {
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const pipRegex = /\{([WUBRG])\}/g;
  cards.forEach(name => {
    const d = cardData[name.toLowerCase()];
    if (!d || !d.mana_cost) return;
    let m;
    while ((m = pipRegex.exec(d.mana_cost)) !== null) {
      pips[m[1]] = (pips[m[1]] || 0) + 1;
    }
    pipRegex.lastIndex = 0;
  });
  return pips;
}

function recommendedSources(pips, totalNonLands) {
  const total = Object.values(pips).reduce((a, b) => a + b, 0);
  if (total === 0) return {};
  const sources = {};
  Object.entries(pips).forEach(([color, count]) => {
    if (count > 0) {
      sources[color] = Math.max(8, Math.round((count / total) * 38));
    }
  });
  return sources;
}

const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
const COLOR_HEX = { W: '#c8b560', U: '#4a90d9', B: '#8b5cf6', R: '#ef4444', G: '#22c55e' };
const GUILD_NAMES = {
  'BU':'Dimir','BR':'Rakdos','BG':'Golgari','RW':'Boros','GW':'Selesnya',
  'UW':'Azorius','GU':'Simic','RU':'Izzet','BW':'Orzhov','GR':'Gruul',
  'BRU':'Grixis','BGU':'Sultai','BGR':'Jund','BRW':'Mardu','BGW':'Abzan',
  'GRU':'Temur','RUW':'Jeskai','GUW':'Bant','GRW':'Naya','BUW':'Esper',
  'BGRUW':'Five-colour',
};

function getGuildName(colors) {
  const sorted = [...colors].sort().join('');
  return GUILD_NAMES[sorted] || '';
}

function isLand(card, cardData) {
  const d = cardData[card.toLowerCase()];
  if (d) return d.type_line?.includes('Land');
  const basics = ['swamp','island','mountain','forest','plains'];
  const landWords = ['tower','vents','falls','cavern','hideout','bluff','moor','lighthouse','cliffs','quarry','sanitarium','command tower','reliquary','desolate','bugle','industries','market','passage','lazotep'];
  return basics.some(b => card.toLowerCase() === b) || landWords.some(k => card.toLowerCase().includes(k));
}

function isTappedLand(name) {
  const tapped = ['cliffs','caves','bluff','moor','isle','bloodfell','swiftwater','thriving','refuge','guildgate','panorama','bounty','gain lands'];
  return tapped.some(k => name.toLowerCase().includes(k));
}

window.TM = {
  SUPABASE_URL, SUPABASE_KEY,
  sbFetch, getSession, setSession, signIn, signUp, signOut, requireAuth, refreshSession,
  getDecks, getDeck, saveDeck, deleteDeck, getCollection, saveCollection,
  fetchScryfallBulk, parseDeckList, parseCollection,
  countPips, recommendedSources,
  COLOR_NAMES, COLOR_HEX, GUILD_NAMES, getGuildName,
  isLand, isTappedLand,
  validateDeckList, validateCollection,
  parseCSVLine, collectionToLookup,
  getColorIdentities, filterByColorIdentity,
  extractPrintingHints, fetchExactPrintings,
  reconcileDeckCollection,
};
