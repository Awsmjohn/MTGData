// scryfall.js — thin wrapper around the free, keyless Scryfall API.
// https://scryfall.com/docs/api — please keep requests light (we debounce
// autocomplete and only fetch full card data on explicit selection).

const BASE = "https://api.scryfall.com";

async function autocomplete(query) {
  if (!query || query.length < 2) return [];
  const res = await fetch(`${BASE}/cards/autocomplete?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

function shapeCard(raw) {
  const face = raw.card_faces && raw.card_faces[0];
  const image =
    (raw.image_uris && raw.image_uris.normal) ||
    (face && face.image_uris && face.image_uris.normal) ||
    null;
  return {
    scryfallId: raw.id,
    name: raw.name,
    set: raw.set_name,
    setCode: (raw.set || "").toUpperCase(),
    collectorNumber: raw.collector_number,
    manaCost: raw.mana_cost || (face && face.mana_cost) || "",
    cmc: raw.cmc ?? 0,
    colors: raw.colors || (face && face.colors) || [],
    colorIdentity: raw.color_identity || [],
    typeLine: raw.type_line || (face && face.type_line) || "",
    oracleText: raw.oracle_text || (face && face.oracle_text) || "",
    power: raw.power ?? (face && face.power) ?? null,
    toughness: raw.toughness ?? (face && face.toughness) ?? null,
    loyalty: raw.loyalty ?? null,
    rarity: raw.rarity || "",
    imageUrl: image,
    legalities: raw.legalities || {},
    keywords: raw.keywords || [],
  };
}

async function getByExactName(name) {
  const res = await fetch(`${BASE}/cards/named?exact=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error("Card not found on Scryfall");
  const raw = await res.json();
  return shapeCard(raw);
}

async function getByFuzzyName(name) {
  const res = await fetch(`${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error("Card not found on Scryfall");
  const raw = await res.json();
  return shapeCard(raw);
}

export const Scryfall = { autocomplete, getByExactName, getByFuzzyName, shapeCard };
