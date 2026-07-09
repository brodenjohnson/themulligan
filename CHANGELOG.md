# Changelog

All notable changes to The Mulligan are documented here.

## 2026-07-09 — Partner / co-commander support

Decks with two commanders in the command zone are now supported end-to-end.

### Added

- **Partner commanders (and friends).** The app auto-detects a second commander from the top
  of the decklist and treats the whole command zone as a pair. Covers **Partner**, **Partner
  with [name]** (name-matched), **Choose a Background** + **Background**, **Friends forever**,
  and **Doctor's companion** + **Time Lord Doctor**. Detection reads real Scryfall oracle
  text/type lines and only pairs cards 0 and 1 when they form a *legal* pairing, so a normal
  legendary in the second slot can't be misread as a commander. (Companion is excluded — it's
  a sideboard mechanic, not a co-commander.)

### Fixed / Changed

- **Colour identity is now the union of both commanders.** This is the key fix — off-colour
  recommendations, the collection filter, and mana analysis all derive from it, so a partner
  deck no longer treats half its legal cards as off-colour.
- **Combos** send both commanders to Commander Spellbook, and the deck list passed alongside
  starts after the commander slot(s) so a co-commander isn't double-counted.
- **Recommender** now sends the second commander in its `partner` field (was hardcoded null).
- **Urza chat, recommendations, and mana prompts** name both commanders, describe the colour
  constraint as the combined identity, and protect *both* commanders from "swap out" cuts.
- **Banner** shows the union colour pips and a "⚔ Commander A + Commander B" label.

### Not covered

- Build Mode (the build-from-scratch drafting flow) remains single-commander for now.

## 2026-07-09

A batch of Combos-tab features, a Moxfield deck importer, and two correctness fixes to
the AI-assisted tabs. All changes verified with a headless test harness that runs the real
functions against real card data (Scryfall / Commander Spellbook / a captured Moxfield deck).

### Added

- **Combos tab — load more.** Each section (Complete, One card away, Two cards away, Ready
  from collection) now shows 15 combos at a time with a "Show N more" control, instead of
  hard-truncating at 15.
- **Combos tab — filtering.** A filter bar to narrow the combo list by:
  - **Include cards** — show only combos using *any* of the chosen cards.
  - **Exclude cards** — hide combos using *any* of the chosen cards.
  - **Combo size** — 2 / 3 / 4 / 5+ card combos.
  Includes card-name autocomplete, removable chips, a live "N of M combos match" count, and
  a Clear filters action. Sections auto-expand/collapse based on matches while filtering.
- **Combos tab — per-card combo count + quick filter.** Every card thumbnail inside a combo
  shows how many of the deck's combos that card appears in (e.g. "6 combos"). Clicking it
  filters the whole list to that card's combos.
- **Combos tab — sort by most/least used.** A "Sort by" control orders combos by Commander
  Spellbook popularity (the "In N decks" figure): Default / Most used / Least used.
- **Combos tab — collapsible Complete section.** The "Complete" (in-deck) combos section is
  now a collapsible accordion, consistent with the other sections.
- **Import a deck from a Moxfield URL.** The New Deck dialog now accepts a Moxfield deck link
  and imports the full decklist (commander first, with exact printings for correct art),
  ready to review and save. Backed by a new serverless proxy (`api/moxfield.js`) that parses
  Moxfield's deck data server-side.
  - **Requires setup to go live:** Moxfield's API is behind Cloudflare and rejects
    server-side requests unless they carry an approved User-Agent. Register with Moxfield
    (api@moxfield.com) and set the `MOXFIELD_USER_AGENT` environment variable to the approved
    string. Until then the importer is dormant and returns a clear message telling the user
    to paste the exported decklist text instead.

### Changed

- **Combos tab is now data-driven.** It renders from cached combo *data* (a trimmed,
  render-ready payload) rather than cached HTML, which is what makes on-the-fly filtering and
  sorting possible and keeps behaviour identical on fresh load and cache restore. The full
  combo list is now reachable via pagination (the previous 105-combo display cap is gone).
- **Recommendations prompt includes the commander's colour identity**, so the AI is told the
  legal colour constraint up front.
- **Urza (chat) is given real card text.** The chat context now includes the full, untruncated
  Scryfall oracle text for every card in the deck (plus recommended cards it may discuss),
  deduplicated — replacing the previous context that covered only ~20–30 cards with each
  card's text clipped to 100 characters. The context is now passed via the API `system`
  parameter instead of being embedded in (and persisted to) the chat history.

### Fixed

- **Recommendations could suggest off-colour cards.** The AI's "Best cards" and "Themed
  alternatives" columns are now hard-filtered against the commander's colour identity using
  real Scryfall data (the "From your collection" column was already filtered). The filter is
  skipped only when the commander's colour identity is genuinely unknown, so it never wrongly
  empties the columns.
- **Urza hallucinated what cards do.** Because it lacked real oracle text (see Changed), Urza
  described cards from memory. It is now instructed to reason strictly from the provided
  oracle text and to say so when a card's text isn't available, rather than guessing.
- **Double-faced/split combo pieces were mislabelled.** A DFC or split card already in the
  deck (e.g. "Agadeem's Awakening // Agadeem, the Undercrypt") was being counted as "missing",
  which put combos in the wrong "cards away" bucket and produced a false "ready from
  collection" claim. Combo piece names are now front-face-normalized before matching.

### Notes

- A local, zero-dependency dev server (`dev-server.mjs`) that mirrors the Vercel runtime
  (static files + rewrites + the `api/*` functions) was added for local development. It is
  git-ignored, along with `.env`, so it is not part of the deployment.
