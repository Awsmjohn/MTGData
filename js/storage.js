// storage.js — persistence + the Dewey-inspired location code system
// Everything lives in the browser's localStorage. Export/Import (see app.js)
// is the backup mechanism since localStorage does not sync across devices.

const DB_KEY = "codex.db.v1";

const CLASS_TABLE = [
  { code: "000", label: "Artifact / Colorless", test: (c) => c.colors.length === 0 && !c.isLand && !c.isToken },
  { code: "100", label: "White", test: (c) => c.colors.length === 1 && c.colors[0] === "W" },
  { code: "200", label: "Blue", test: (c) => c.colors.length === 1 && c.colors[0] === "U" },
  { code: "300", label: "Black", test: (c) => c.colors.length === 1 && c.colors[0] === "B" },
  { code: "400", label: "Red", test: (c) => c.colors.length === 1 && c.colors[0] === "R" },
  { code: "500", label: "Green", test: (c) => c.colors.length === 1 && c.colors[0] === "G" },
  { code: "600", label: "Multicolor", test: (c) => c.colors.length > 1 },
  { code: "700", label: "Land", test: (c) => c.isLand },
  { code: "800", label: "Tokens & Emblems", test: (c) => c.isToken },
  { code: "900", label: "Special / Other", test: () => true }, // fallback
];

function classFor(card) {
  const shaped = {
    colors: card.colors || [],
    isLand: (card.typeLine || "").includes("Land"),
    isToken: (card.typeLine || "").includes("Token") || (card.typeLine || "").includes("Emblem"),
  };
  // Land check takes priority over color (many lands have color identity but no colors[])
  if (shaped.isLand) return CLASS_TABLE.find((c) => c.code === "700");
  if (shaped.isToken) return CLASS_TABLE.find((c) => c.code === "800");
  for (const entry of CLASS_TABLE) {
    if (entry.test(shaped)) return entry;
  }
  return CLASS_TABLE[CLASS_TABLE.length - 1];
}

function pad(n, len) {
  return String(n).padStart(len, "0");
}

// Derives tags straight from Scryfall data: keyword abilities (Flying,
// Trample, ...) and creature/land subtypes (Elf, Goblin, Desert, ...) pulled
// from the back half of the type line. These are recomputed from the card's
// stored Scryfall data and kept separate from your own custom tags, so a
// refresh never wipes out tags you typed yourself.
function computeAutoTags(card) {
  const tags = new Set();
  (card.keywords || []).forEach((k) => tags.add(k));
  const typeLine = card.typeLine || "";
  const dashIdx = typeLine.indexOf("—");
  if (dashIdx !== -1) {
    typeLine.slice(dashIdx + 1).trim().split(/\s+/).filter(Boolean).forEach((st) => tags.add(st));
  }
  return Array.from(tags);
}

function defaultDB() {
  return {
    cards: [], // {id, name, set, setCode, collectorNumber, manaCost, cmc, colors, colorIdentity, typeLine, oracleText, power, toughness, loyalty, rarity, imageUrl, scryfallId, legalities, quantity, tags, locationCode, dateAdded}
    decks: [], // {id, name, format, cards:[{cardId, quantity}], notes, dateCreated}
    settings: {
      numberOfBoxes: 10,
      sequences: {}, // key `${classCode}-${box}` -> next sequence number
    },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return defaultDB();
    const parsed = JSON.parse(raw);
    return { ...defaultDB(), ...parsed, settings: { ...defaultDB().settings, ...(parsed.settings || {}) } };
  } catch (e) {
    console.error("Failed to load Codex database, starting fresh.", e);
    return defaultDB();
  }
}

function save(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

let db = load();

function uid() {
  return "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const Storage = {
  getDB() {
    return db;
  },

  replaceDB(newDB) {
    db = { ...defaultDB(), ...newDB, settings: { ...defaultDB().settings, ...(newDB.settings || {}) } };
    save(db);
  },

  mergeDB(incoming) {
    // Merge cards by scryfallId+set (or name if no id), decks by name.
    const existingKey = (c) => (c.scryfallId ? c.scryfallId : c.name.toLowerCase());
    const existingKeys = new Set(db.cards.map(existingKey));
    (incoming.cards || []).forEach((c) => {
      if (!existingKeys.has(existingKey(c))) {
        db.cards.push({ ...c, id: uid() });
        existingKeys.add(existingKey(c));
      }
    });
    const deckNames = new Set(db.decks.map((d) => d.name.toLowerCase()));
    (incoming.decks || []).forEach((d) => {
      if (!deckNames.has(d.name.toLowerCase())) {
        db.decks.push({ ...d, id: uid() });
        deckNames.add(d.name.toLowerCase());
      }
    });
    save(db);
  },

  // ---- Cards ----
  addCard(card) {
    const record = {
      id: uid(),
      quantity: 1,
      tags: [], // your own custom tags
      autoTags: [], // derived from Scryfall keywords/subtypes, recomputed on save
      locationCode: null,
      dateAdded: new Date().toISOString(),
      ...card,
    };
    record.autoTags = computeAutoTags(record);
    db.cards.push(record);
    save(db);
    return record;
  },

  updateCard(id, patch) {
    const c = db.cards.find((c) => c.id === id);
    if (!c) return null;
    Object.assign(c, patch);
    c.autoTags = computeAutoTags(c);
    save(db);
    return c;
  },

  allTagsFor(card) {
    return Array.from(new Set([...(card.tags || []), ...(card.autoTags || [])]));
  },

  deleteCard(id) {
    db.cards = db.cards.filter((c) => c.id !== id);
    db.decks.forEach((d) => (d.cards = d.cards.filter((dc) => dc.cardId !== id)));
    save(db);
  },

  allCards() {
    return db.cards;
  },

  findCard(id) {
    return db.cards.find((c) => c.id === id) || null;
  },

  // ---- Decks ----
  addDeck(deck) {
    const record = { id: uid(), cards: [], notes: "", dateCreated: new Date().toISOString(), ...deck };
    db.decks.push(record);
    save(db);
    return record;
  },

  updateDeck(id, patch) {
    const d = db.decks.find((d) => d.id === id);
    if (!d) return null;
    Object.assign(d, patch);
    save(db);
    return d;
  },

  deleteDeck(id) {
    db.decks = db.decks.filter((d) => d.id !== id);
    save(db);
  },

  allDecks() {
    return db.decks;
  },

  findDeck(id) {
    return db.decks.find((d) => d.id === id) || null;
  },

  setDeckCardQty(deckId, cardId, quantity) {
    const deck = this.findDeck(deckId);
    if (!deck) return;
    const entry = deck.cards.find((c) => c.cardId === cardId);
    if (quantity <= 0) {
      deck.cards = deck.cards.filter((c) => c.cardId !== cardId);
    } else if (entry) {
      entry.quantity = quantity;
    } else {
      deck.cards.push({ cardId, quantity });
    }
    save(db);
  },

  // ---- Settings ----
  getSettings() {
    return db.settings;
  },

  updateSettings(patch) {
    Object.assign(db.settings, patch);
    save(db);
  },

  // ---- Location codes (Dewey-inspired) ----
  classFor,
  CLASS_TABLE,

  assignLocation(cardId, box) {
    const card = this.findCard(cardId);
    if (!card) return null;
    const cls = classFor(card);
    const boxNum = pad(box, 2);
    const seqKey = `${cls.code}-${boxNum}`;
    const next = (db.settings.sequences[seqKey] || 0) + 1;
    db.settings.sequences[seqKey] = next;
    const code = `${cls.code}.${boxNum}.${pad(next, 3)}`;
    card.locationCode = code;
    card.box = Number(box);
    save(db);
    return code;
  },

  clearLocation(cardId) {
    const card = this.findCard(cardId);
    if (!card) return;
    card.locationCode = null;
    card.box = null;
    save(db);
  },

  cardsInBox(box) {
    return db.cards
      .filter((c) => c.locationCode && Number(c.box) === Number(box))
      .sort((a, b) => a.locationCode.localeCompare(b.locationCode));
  },

  classCounts() {
    const counts = {};
    CLASS_TABLE.forEach((c) => (counts[c.code] = { label: c.label, total: 0, filed: 0 }));
    db.cards.forEach((card) => {
      const cls = classFor(card);
      counts[cls.code].total += 1;
      if (card.locationCode) counts[cls.code].filed += 1;
    });
    return counts;
  },
};
