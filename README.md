# Codex — a card catalog for your Magic collection

A free, no-backend web app for cataloging real Magic: The Gathering cards,
building decks, getting rules-based deck suggestions from *your own*
collection, and organizing your physical bulk storage with a Dewey-inspired
location code.

No build step, no server, no API keys. It's plain HTML/CSS/JS plus one free
public API (Scryfall, for card data and images).

## Running it locally

Just open `index.html` in a browser — or, better, serve the folder so
`fetch()` calls behave normally:

```
cd codex
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying for free

### Option A: GitHub Pages
1. Create a new GitHub repository and push this `codex` folder's contents
   to it (the repo root should contain `index.html`, `css/`, `js/`).
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment", set Source to **Deploy from a branch**,
   pick your default branch (e.g. `main`) and `/ (root)`, then save.
4. GitHub gives you a URL like `https://yourname.github.io/reponame/`
   within a minute or two.

### Option B: Netlify
1. Go to [netlify.com](https://www.netlify.com) and sign up (free tier).
2. Drag the `codex` folder onto the "Sites" dashboard (Netlify's manual
   deploy drop zone), or connect it to a GitHub repo for automatic
   redeploys on every push.
3. Netlify gives you a free `*.netlify.app` URL immediately.

Either option costs nothing and needs no server-side code.

## Where your data lives

Everything — your card collection, decks, tags, and storage assignments —
is saved in the browser's `localStorage`, scoped to whatever URL you're
using. That means:

- Data stays on the one device/browser you used to enter it. It will
  **not** appear on your phone if you added it on your laptop.
- Clearing browser data/cache for the site wipes it.
- **Back up regularly** using Import·Export → "Export full backup (JSON)".
  Re-import that file (merge or replace) on another device or after
  clearing your browser to restore everything.

If you later want true cross-device sync, the natural upgrade is a free
tier of a hosted database (e.g. Firebase, Supabase) behind a login — that's
a bigger change to the storage layer (`js/storage.js`) than this version
needs, but the rest of the app (UI, assistant, location codes) would carry
over largely unchanged.

## The Dewey-inspired location system

Real Dewey Decimal Classification organizes books by subject, then by
shelf position within that subject. Codex borrows that same two-level idea,
using Magic's own color pie as the "subject" axis:

```
CLASS . BOX . SEQUENCE
 200  .  03 .  045
```

**Class** (hundreds digit, fixed):
| Code | Meaning |
|------|---------|
| 000 | Artifact / Colorless |
| 100 | White |
| 200 | Blue |
| 300 | Black |
| 400 | Red |
| 500 | Green |
| 600 | Multicolor (gold) |
| 700 | Land |
| 800 | Tokens & Emblems |
| 900 | Special / other |

**Box** — the physical bulk-storage box number you assign, e.g. `03`.

**Sequence** — automatically assigned, the next open slot in that
class+box combination, e.g. `045` means it's the 45th blue card filed into
Box 3.

In practice: decide how many physical boxes you have (Storage Map →
"Number of boxes"), then as you catalog a card, hit **File** and pick a
box. Codex works out the class from the card's color/type automatically
and hands you the next sequence number — so you just keep filing cards
into a box in the order Codex gives you the code, and the code tells you
exactly where to find it again later. The Storage Map tab also has a
"Find a card" search and a printable label sheet.

## Tags: yours, plus Scryfall's automatically

Each card carries two kinds of tags, shown as different chip styles on its
index card:

- **Custom tags** (solid chip) — whatever you type in the Add/Edit form,
  e.g. `commander-piece`, `combo-a`.
- **Auto tags** (dashed chip) — pulled straight from Scryfall and
  recomputed every time the card's data is refreshed: keyword abilities
  (Flying, Trample, Deathtouch, ...) and creature/land subtypes (Elf,
  Goblin, Desert, ...) parsed from the back half of the type line.

Both kinds feed the Collection tag filter and the assistant's tag-synergy
suggestions, so tribal or keyword-based decks get useful suggestions even
before you've typed a single custom tag. Hit **Refresh** on a card to
re-pull its latest Scryfall data (in case you added it before this feature,
or Scryfall's data has since been corrected).

## The deck assistant — how it actually works

There's no external AI API call here — the assistant tab runs a small set
of deck-building heuristics against your own collection:

- Flags a shortage of removal, card draw, or ramp (using keyword patterns
  in the card text) and suggests owned cards that fill the gap.
- Checks your mana curve against a rough target shape and suggests cards
  at underrepresented costs.
- Checks land count against your deck size.
- Suggests board wipes if the deck already leans controlling.
- Surfaces other owned cards that share a tag with 2+ cards already in
  the deck (tag cards yourself when adding them, e.g. `elves`, `sacrifice`).

Every suggestion pulls only from cards already sitting in your Codex, per
your requirement — nothing is invented and nothing is fetched from a
general card database for this part.

If you ever want a true LLM-powered assistant instead (broader strategy
advice, not just your own cards), that requires a server-side piece to
hold an API key safely — a Netlify Function or similar — since a static
site can't keep a secret key hidden from visitors. Ask me and I can build
that layer as a separate upgrade.
