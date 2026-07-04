const SUPABASE_URL = 'https://qowhaosiuwcxlfyypqcx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvd2hhb3NpdXdjeGxmeXlwcWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMTcxNTcsImV4cCI6MjA5ODY5MzE1N30.k3P_wunsm834buQIS2pTVE39Q8ZgEDZ1-DhdNJ6PxUs';

async function sbFetch(path, options = {}) {
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
    throw new Error(err.message || err.error_description || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
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
  await sbFetch('/rest/v1/collections', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: session.user.id, cards, updated_at: new Date().toISOString() }),
  });
}

async function fetchScryfallBulk(cardNames) {
  const results = {};
  const unique = [...new Set(cardNames.map(c => c.trim()).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 75) {
    const batch = unique.slice(i, i + 75);
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
          const key = card.name.toLowerCase();
          const simpleKey = card.name.split(' // ')[0].toLowerCase();
          results[key] = cardData;
          results[simpleKey] = cardData;
        });
      }
    } catch (e) { console.warn('Scryfall batch failed', e); }
    if (i + 75 < unique.length) await new Promise(r => setTimeout(r, 150));
  }
  return results;
}

function parseDeckList(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const cards = [];
  for (const line of lines) {
    if (line.startsWith('//') || line.startsWith('#')) continue;
    const match = line.match(/^(\d+)x?\s+(.+)$/);
    if (match) {
      const count = parseInt(match[1]);
      const name = match[2].trim();
      for (let i = 0; i < count; i++) cards.push(name);
    } else {
      const clean = line.replace(/^\d+\s+/, '').trim();
      if (clean) cards.push(clean);
    }
  }
  return cards;
}

function parseCollection(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const cards = new Set();
  const isCSV = lines[0]?.includes(',');
  let nameCol = 0;
  if (isCSV) {
    const headers = lines[0].toLowerCase().split(',').map(h => h.replace(/"/g, '').trim());
    const idx = headers.findIndex(h => ['name','card name','cardname','title'].includes(h));
    if (idx >= 0) nameCol = idx;
  }
  const start = isCSV && lines[0].toLowerCase().includes('name') ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    let name = '';
    if (isCSV) {
      const parts = lines[i].match(/(".*?"|[^,]+)(?=,|$)/g) || lines[i].split(',');
      name = (parts[nameCol] || parts[0] || '').replace(/"/g, '').trim();
    } else {
      name = lines[i].replace(/^\d+x?\s+/, '').trim();
    }
    name = name.replace(/\s*\/\/.*$/, '').trim().toLowerCase();
    if (name && name.length > 1 && !/^\d+$/.test(name)) cards.add(name);
  }
  return [...cards];
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
  sbFetch, getSession, setSession, signIn, signUp, signOut, requireAuth,
  getDecks, getDeck, saveDeck, deleteDeck, getCollection, saveCollection,
  fetchScryfallBulk, parseDeckList, parseCollection,
  countPips, recommendedSources,
  COLOR_NAMES, COLOR_HEX, GUILD_NAMES, getGuildName,
  isLand, isTappedLand,
};
