# Development Principles — The Mulligan

This file exists because of two real mistakes made during development, documented here
on purpose so they don't get quietly repeated.

## The rule

**Every piece of data shown to the user must trace back to something real, or be clearly
labeled as a judgement call — never presented as fact when it's actually a guess.**

If a feature needs to reason about a Magic card, a commander, or anything factual, it
must be given the *actual data* (oracle text, real prices, real community stats) to
reason from — not just a name, left to fill in the rest from training memory.

## What went wrong, concretely

**1. The "What's the plan?" commander archetype picker.** The prompt sent Claude only
the commander's *name* and asked it to suggest deck plans "based on its real abilities."
Claude had zero actual card text to work from. For King T'Challa // Black Panther, it
invented "Treasure Engine" and "Aristocrats Sacrifice" archetypes that have nothing to do
with the card's real text (Flash, double strike, damage prevention, card draw off combat
damage). It wasn't reasoning about the card — it was pattern-matching on the character
name. Fixed by fetching and passing the real oracle text into the prompt.

**2. The pack "score" field.** Every card suggested in a Build Mode pack showed a score
like "82" with no explanation of where it came from. It turned out to be a number Claude
was simply asked to invent — no real data behind it at all, dressed up to look like a
statistic. Fixed by wiring in real Recommander community data (the same source already
used on the Recommendations tab) and rewriting the scoring instruction so 90+ specifically
requires real community confirmation, not just AI confidence.

## The standing check, going forward

Before shipping anything that presents information as fact — a stat, a score, a
recommendation, a claim about what a card does — ask:

- Where does this number or claim actually come from?
- If it's AI-generated, what real data was it grounded in? If the honest answer is
  "nothing, it's just asked to produce a plausible-sounding value," that's not good
  enough to ship.
- If verifying properly isn't possible in the current design, say so plainly instead of
  quietly shipping the ungrounded version.

If a genuine trade-off is needed — real data isn't available, verifying it is expensive,
or there's no clean way to fetch it — that's a real conversation to have with Broden
before building around a guess, not a decision to make silently.
