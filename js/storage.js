// storage.js — persistence + the Dewey-inspired location code system
// Data is synced to Supabase (one row per logged-in user), with a
// localStorage copy kept per-user as an instant-load / offline cache.
// Every Storage method below stays synchronous against the in-memory `db`
// object — see initForUser() for how that object gets populated after login,
// and save() for how edits get pushed to the cloud in the background.

import { supabase } from "./supabaseClient.js";

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

function mergeWithDefaults(parsed) {
  return { ...defaultDB(), ...parsed, settings: { ...defaultDB().settings, ...(parsed.settings || {}) } };
}

let db = defaultDB();
let currentUserId = null; // the logged-in person
let currentUserEmail = null;
let activeOwnerId = null; // whose codex_data row is currently loaded — equals currentUserId unless viewing a shared collection
let activePermission = "owner"; // "owner" | "edit" | "view"
let cloudSaveTimer = null;
let onSyncStatus = () => {}; // optional callback: (status) => void, "saved" | "saving" | "error" | "readonly-blocked"

function cacheKeyFor(userId) {
  return `codex.db.v1.${userId}`;
}

function writeLocalCache() {
  if (!currentUserId || activeOwnerId !== currentUserId) return; // only cache your own collection locally
  try {
    localStorage.setItem(cacheKeyFor(currentUserId), JSON.stringify(db));
  } catch (e) {
    console.warn("Local cache write failed", e);
  }
}

async function pushToCloud() {
  if (!activeOwnerId) return;
  onSyncStatus("saving");
  const { error } = await supabase
    .from("codex_data")
    .upsert({ user_id: activeOwnerId, data: db, updated_at: new Date().toISOString() });
  onSyncStatus(error ? "error" : "saved");
  if (error) console.error("Supabase save failed", error);
}

function save(db_) {
  writeLocalCache();
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(pushToCloud, 800); // debounce rapid edits into one write
}

function uid() {
  return "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const StorageImpl = {
  // Called once after a successful login. Loads this user's data from
  // Supabase (falling back to a local cache for instant paint, and to a
  // fresh empty database for a brand-new account).
  async initForUser(userId, email, statusCallback) {
    currentUserId = userId;
    currentUserEmail = email;
    activeOwnerId = userId;
    activePermission = "owner";
    onSyncStatus = statusCallback || (() => {});
    try {
      const cached = localStorage.getItem(cacheKeyFor(userId));
      if (cached) db = mergeWithDefaults(JSON.parse(cached));
    } catch (e) { /* ignore bad cache */ }

    const { data, error } = await supabase.from("codex_data").select("data").eq("user_id", userId).maybeSingle();
    if (error) {
      console.error("Failed to load from Supabase, using local cache if any.", error);
      onSyncStatus("error");
      return;
    }
    if (data && data.data) {
      db = mergeWithDefaults(data.data);
      writeLocalCache();
    } else {
      // Brand-new account — create their row.
      db = defaultDB();
      await pushToCloud();
    }
    onSyncStatus("saved");
  },

  signOut() {
    currentUserId = null;
    currentUserEmail = null;
    activeOwnerId = null;
    activePermission = "owner";
    db = defaultDB();
  },

  getMyUserId() {
    return currentUserId;
  },

  getActiveOwnerId() {
    return activeOwnerId;
  },

  isViewingOwnCollection() {
    return activeOwnerId === currentUserId;
  },

  isReadOnly() {
    return activePermission === "view";
  },

  getActivePermission() {
    return activePermission;
  },

  // ---- Sharing ----
  // People you've shared your OWN collection with.
  async listMyCollaborators() {
    const { data, error } = await supabase.from("collaborators").select("*").eq("owner_id", currentUserId).order("collaborator_email");
    if (error) throw error;
    return data || [];
  },

  // Collections other people have shared with you.
  async listSharedWithMe() {
    const { data, error } = await supabase.from("collaborators").select("*").eq("collaborator_id", currentUserId).order("owner_email");
    if (error) throw error;
    return data || [];
  },

  async inviteCollaborator(email, accessLevel) {
    const { error } = await supabase.rpc("invite_collaborator", { collaborator_email: email.trim(), access_level: accessLevel });
    if (error) throw error;
  },

  async updateCollaboratorPermission(rowId, accessLevel) {
    const { error } = await supabase.from("collaborators").update({ permission: accessLevel }).eq("id", rowId);
    if (error) throw error;
  },

  async revokeCollaborator(rowId) {
    const { error } = await supabase.from("collaborators").delete().eq("id", rowId);
    if (error) throw error;
  },

  // Switch which collection is currently loaded — your own, or one shared with you.
  async switchToOwner(ownerId, permission, statusCallback) {
    if (statusCallback) onSyncStatus = statusCallback;
    activeOwnerId = ownerId;
    activePermission = ownerId === currentUserId ? "owner" : permission;
    const { data, error } = await supabase.from("codex_data").select("data").eq("user_id", ownerId).maybeSingle();
    if (error) {
      console.error("Failed to load that shared collection.", error);
      onSyncStatus("error");
      db = defaultDB();
      return;
    }
    db = data && data.data ? mergeWithDefaults(data.data) : defaultDB();
    writeLocalCache();
    onSyncStatus("saved");
  },

  async switchToMine(statusCallback) {
    return this.switchToOwner(currentUserId, "owner", statusCallback);
  },

  getDB() {
    return db;
  },

  replaceDB(newDB) {
    db = mergeWithDefaults(newDB);
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
    const record = { id: uid(), cards: [], extraCards: [], notes: "", dateCreated: new Date().toISOString(), ...deck };
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

  // "Extra" cards: cards added straight to a deck from a general Scryfall
  // search, whether or not you own a physical copy. Each carries its own
  // snapshot of Scryfall data (name, price, colors, etc.) since it may not
  // exist anywhere in the Collection.
  addExtraCard(deckId, cardData, quantity = 1) {
    const deck = this.findDeck(deckId);
    if (!deck) return;
    if (!deck.extraCards) deck.extraCards = [];
    const existing = deck.extraCards.find((c) => c.scryfallId === cardData.scryfallId);
    if (existing) existing.quantity += quantity;
    else deck.extraCards.push({ ...cardData, quantity });
    save(db);
  },

  setExtraCardQty(deckId, scryfallId, quantity) {
    const deck = this.findDeck(deckId);
    if (!deck || !deck.extraCards) return;
    if (quantity <= 0) {
      deck.extraCards = deck.extraCards.filter((c) => c.scryfallId !== scryfallId);
    } else {
      const entry = deck.extraCards.find((c) => c.scryfallId === scryfallId);
      if (entry) entry.quantity = quantity;
    }
    save(db);
  },

  // ---- Value ----
  collectionValue() {
    return db.cards.reduce((sum, c) => sum + (Number(c.price) || 0) * (c.quantity || 0), 0);
  },

  deckValue(deck) {
    const owned = deck.cards.reduce((sum, dc) => {
      const c = this.findCard(dc.cardId);
      return sum + (c ? (Number(c.price) || 0) * dc.quantity : 0);
    }, 0);
    const extra = (deck.extraCards || []).reduce((sum, c) => sum + (Number(c.price) || 0) * c.quantity, 0);
    return owned + extra;
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

// Every method below is a real database write. When the active collection
// is someone else's and you only have "view" access, these are blocked here
// — as a safety net for the UI — on top of the database's own Row Level
// Security policies, which are the actual enforcement boundary.
const MUTATING_METHODS = new Set([
  "replaceDB", "mergeDB", "addCard", "updateCard", "deleteCard",
  "addDeck", "updateDeck", "deleteDeck", "setDeckCardQty",
  "addExtraCard", "setExtraCardQty", "updateSettings",
  "assignLocation", "clearLocation",
]);

export const Storage = new Proxy(StorageImpl, {
  get(target, prop) {
    const value = target[prop];
    if (typeof value !== "function") return value;
    if (!MUTATING_METHODS.has(prop)) return value.bind(target);
    return (...args) => {
      if (activePermission === "view") {
        console.warn(`Blocked "${String(prop)}" — you have view-only access to this collection.`);
        onSyncStatus("readonly-blocked");
        return null;
      }
      return value.apply(target, args);
    };
  },
});
